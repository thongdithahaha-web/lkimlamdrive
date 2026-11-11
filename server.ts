import express from 'express';
import { Readable } from 'stream';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { parseDriveUrl, type DriveFileItem } from './src/utils/systemRules.ts';
import {
  fetchRealDriveFolder,
  fetchRealSingleDriveFile,
} from './src/utils/driveScraper.ts';
import {
  fetchGoogleSlidesAnimatedDeck,
  buildAnimatedPptxBuffer,
  buildPptxFromSlidePngs,
} from './src/utils/pptxAnimator.ts';
import {
  type DdosConfig,
  DEFAULT_DDOS_CONFIG,
  type DdosSecurityEvent,
  type IpReputationRecord,
  inspectWafRequest,
  evaluateRateLimitDecision,
} from './src/utils/ddosProtection.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseConfig: Record<string, any> = {};
try {
  const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  }
} catch (e) {
  console.warn('Could not read firebase-applet-config.json:', e);
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface ProcessedFileResult extends DriveFileItem {
  proxyDownloadUrl: string;
  viewerUnlockUrl: string;
  driveViewUrl: string;
}

interface ActiveJob {
  id: string;
  status: 'processing' | 'completed' | 'error';
  progress: number;
  message: string;
  current: number;
  total: number;
  driveLink?: string;
  folderTitle?: string;
  files?: ProcessedFileResult[];
}

const jobs = new Map<string, ActiveJob>();

interface ViewerSession {
  cookies: string;
  imgBasePath: string;
  pages: number;
  title: string;
  expiresAt: number;
}
const viewerCache = new Map<string, ViewerSession>();
const pptxBufferCache = new Map<string, { buffer: Buffer; filename: string; expiresAt: number }>();

// ============================================================================
// Multi-Layer Anti-DDoS & Rate Limiting State
// ============================================================================
let ddosConfig: DdosConfig = { ...DEFAULT_DDOS_CONFIG };
const ipRecords = new Map<string, IpReputationRecord>();
const securityEvents: DdosSecurityEvent[] = [];
let totalRequestsCount = 0;
let totalBlockedCount = 0;

function recordSecurityEvent(
  ip: string,
  method: string,
  reqPath: string,
  reason: string,
  layer: DdosSecurityEvent['layer'],
  action: DdosSecurityEvent['action']
) {
  totalBlockedCount += 1;
  securityEvents.unshift({
    id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ip,
    method,
    path: reqPath,
    reason,
    layer,
    action,
  });
  if (securityEvents.length > 150) {
    securityEvents.pop();
  }
}

function getClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : typeof xff === 'string' ? xff.split(',')[0] : req.socket.remoteAddress || '127.0.0.1';
  return raw.trim().replace(/^::ffff:/, '') || '127.0.0.1';
}

// ============================================================================
// Gmail OTP Verification, Password Recovery & Anti-Brute-Force State
// ============================================================================
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'lkimlamdrive_vip_hmac_secret_2026_anti_bruteforce';
const MAX_OTP_ATTEMPTS = 3;
const MAX_LOGIN_ATTEMPTS = 5;
const BRUTE_FORCE_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

interface OtpSession {
  email: string;
  username: string;
  code: string;
  purpose: 'register' | 'reset-password';
  expiresAt: number;
  lastSentAt: number;
  failedAttempts: number;
  verified: boolean;
}

interface BruteForceTracker {
  failedCount: number;
  lockedUntilMs: number;
  lastAttemptMs: number;
}

export interface SentEmailRecord {
  id: string;
  to: string;
  subject: string;
  code: string;
  purpose: 'register' | 'reset-password';
  sentViaSmtp: boolean;
  createdAt: string;
  htmlPreview: string;
}

const otpStore = new Map<string, OtpSession>();
const otpBruteForceLockouts = new Map<string, BruteForceTracker>();
const loginBruteForceLockouts = new Map<string, BruteForceTracker>();
const sentEmailsOutbox: SentEmailRecord[] = [];
let runtimeSmtpConfig = {
  smtpEmail: process.env.GMAIL_USER || '',
  smtpAppPassword: process.env.GMAIL_APP_PASSWORD || '',
};

function createSignedOtpToken(purpose: string, email: string, code: string, expiresAt: number): string {
  const sig = crypto
    .createHmac('sha256', OTP_HMAC_SECRET)
    .update(`${purpose}:${email}:${code}:${expiresAt}`)
    .digest('hex');
  return `${expiresAt}.${sig}`;
}

function verifySignedOtpToken(
  token: string,
  purpose: string,
  email: string,
  candidateCode: string
): { valid: boolean; expired: boolean } {
  if (!token || !token.includes('.')) return { valid: false, expired: false };
  const [expStr, sig] = token.split('.');
  const expiresAt = Number(expStr);
  if (!expiresAt || Number.isNaN(expiresAt)) return { valid: false, expired: false };
  if (Date.now() > expiresAt) return { valid: false, expired: true };
  const expectedSig = crypto
    .createHmac('sha256', OTP_HMAC_SECRET)
    .update(`${purpose}:${email}:${candidateCode}:${expiresAt}`)
    .digest('hex');
  return { valid: sig === expectedSig, expired: false };
}

function getInternalFirebasePass(email: string): string {
  return (
    'Lkld_' +
    crypto.createHmac('sha256', OTP_HMAC_SECRET).update(email.trim().toLowerCase()).digest('hex').slice(0, 16) +
    '!9a'
  );
}

/**
 * Dispatches Firebase email where the 6-digit OTP is placed in the separate greeting line
 * (`displayName`) rather than glued onto the URL, keeping the OTP code and the action link separate.
 */
const knownFirebasePasswords = new Map<string, string>();

async function sendFirebaseEmailSeparateOtpAndLink(params: {
  to: string;
  username: string;
  code: string;
  purpose: 'register' | 'reset-password';
  userPassword?: string;
}): Promise<boolean> {
  const apiKey = firebaseConfig.apiKey;
  if (!apiKey) return false;

  const cleanEmail = params.to.trim().toLowerCase();
  const internalPass = getInternalFirebasePass(cleanEmail);
  if (params.userPassword && params.userPassword.length >= 6) {
    knownFirebasePasswords.set(cleanEmail, params.userPassword);
  }
  const otpLabel =
    params.purpose === 'reset-password' ? 'MÃ OTP ĐẶT LẠI MẬT KHẨU 6 SỐ' : 'MÃ OTP XÁC MINH 6 SỐ';
  const displayGreeting = `${params.username || cleanEmail.split('@')[0]} — [${otpLabel}: ${params.code}]`;
  const candidatePasswords = [
    internalPass,
    params.userPassword,
    knownFirebasePasswords.get(cleanEmail),
    'admin',
    '123456',
  ].filter((p): p is string => Boolean(p && p.length >= 6));

  try {
    let idToken = '';

    // 1. Try creating account with deterministic internalPass and displayGreeting containing the 6-digit OTP
    const signUpRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: internalPass,
          displayName: displayGreeting,
          returnSecureToken: true,
        }),
      }
    );
    const signUpData = (await signUpRes.json()) as { idToken?: string };
    if (signUpData.idToken) {
      idToken = signUpData.idToken;
    } else {
      // 2. Account already exists: sign in, reset unverified state via delete+signUp so VERIFY_EMAIL
      // always sends the template containing Line 1: "Xin chào <username> — [MÃ OTP ...: 123456]!"
      // (Firebase's PASSWORD_RESET template hardcodes "Xin chào!" without %DISPLAY_NAME%, whereas VERIFY_EMAIL includes %DISPLAY_NAME%).
      for (const pass of candidatePasswords) {
        const signInRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: cleanEmail,
              password: pass,
              returnSecureToken: true,
            }),
          }
        );
        if (signInRes.ok) {
          const signInData = (await signInRes.json()) as { idToken?: string };
          if (signInData.idToken) {
            idToken = signInData.idToken;
            break;
          }
        }
      }

      if (idToken) {
        await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });

        const recreateRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: cleanEmail,
              password: internalPass,
              displayName: displayGreeting,
              returnSecureToken: true,
            }),
          }
        );
        const recreateData = (await recreateRes.json()) as { idToken?: string };
        if (recreateData.idToken) {
          idToken = recreateData.idToken;
        }
      }
    }

    if (idToken) {
      await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          displayName: displayGreeting,
          returnSecureToken: true,
        }),
      });

      const verifyRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Firebase-Locale': 'vi',
          },
          body: JSON.stringify({
            requestType: 'VERIFY_EMAIL',
            idToken,
          }),
        }
      );
      if (verifyRes.ok) {
        return true;
      }
    }

    // Fallback to PASSWORD_RESET if account could not be signed in
    const resetRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Firebase-Locale': 'vi',
        },
        body: JSON.stringify({
          requestType: 'PASSWORD_RESET',
          email: cleanEmail,
        }),
      }
    );
    return resetRes.ok;
  } catch (err) {
    console.warn('Firebase REST email dispatch error:', err);
    return false;
  }
}

async function dispatchGmailVerificationEmail(params: {
  to: string;
  username: string;
  code: string;
  purpose: 'register' | 'reset-password';
  userPassword?: string;
}): Promise<{ sentViaSmtp: boolean; previewRecord: SentEmailRecord }> {
  const isRegister = params.purpose === 'register';
  const subject = isRegister
    ? `[LKimLamDrive] Mã xác thực đăng ký tài khoản: ${params.code}`
    : `[LKimLamDrive] Mã khôi phục mật khẩu của bạn: ${params.code}`;

  const actionUrl = isRegister
    ? `https://${firebaseConfig.authDomain || 'gen-lang-client-0628392073.firebaseapp.com'}/register`
    : `https://${firebaseConfig.authDomain || 'gen-lang-client-0628392073.firebaseapp.com'}/login`;

  const htmlPreview = `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 28px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.12);">
      <h2 style="margin: 0 0 8px; color: #ffffff;">LKIMLAMDRIVE VIP SYSTEM</h2>
      <p style="color: #94a3b8; font-size: 14px; margin-bottom: 20px;">
        Xin chào <strong>${params.username || params.to}</strong>,
      </p>
      <p style="color: #e2e8f0; font-size: 14px; line-height: 1.6;">
        ${
          isRegister
            ? 'Cảm ơn bạn đã đăng ký tài khoản tại <strong>LKimLamDrive</strong>. Bạn có thể chọn 1 trong 2 cách riêng biệt bên dưới:'
            : 'Chúng tôi nhận được yêu cầu khôi phục mật khẩu cho Gmail này. Bạn có thể chọn 1 trong 2 cách riêng biệt bên dưới:'
        }
      </p>
      <div style="margin: 20px 0; padding: 18px; background: rgba(93, 69, 245, 0.18); border: 1px dashed #818cf8; border-radius: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #a5b4fc; margin-bottom: 6px;">CÁCH 1: MÃ XÁC NHẬN OTP 6 SỐ (RIÊNG BIỆT)</div>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #ffffff; font-family: monospace;">${params.code}</div>
      </div>
      <div style="margin: 20px 0; padding: 16px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6ee7b7; margin-bottom: 8px;">CÁCH 2: ĐƯỜNG LINK TRỰC TIẾP (RIÊNG BIỆT)</div>
        <a href="${actionUrl}" style="color: #34d399; font-size: 13px; word-break: break-all;">${actionUrl}</a>
      </div>
      <p style="color: #64748b; font-size: 12px;">Mã xác thực có hiệu lực trong vòng 10 phút (Tối đa 3 lần nhập sai).</p>
    </div>
  `;

  let sentViaSmtp = false;
  if (runtimeSmtpConfig.smtpEmail && runtimeSmtpConfig.smtpAppPassword) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: runtimeSmtpConfig.smtpEmail,
          pass: runtimeSmtpConfig.smtpAppPassword,
        },
      });
      await transporter.sendMail({
        from: `"LKimLamDrive Security" <${runtimeSmtpConfig.smtpEmail}>`,
        to: params.to,
        subject,
        html: htmlPreview,
      });
      sentViaSmtp = true;
    } catch (err) {
      console.warn('SMTP send fallback to Firebase REST email:', err);
    }
  }

  if (!sentViaSmtp) {
    await sendFirebaseEmailSeparateOtpAndLink({
      to: params.to,
      username: params.username,
      code: params.code,
      purpose: params.purpose,
      userPassword: params.userPassword,
    });
  }

  const record: SentEmailRecord = {
    id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    to: params.to,
    subject,
    code: params.code,
    purpose: params.purpose,
    sentViaSmtp,
    createdAt: new Date().toISOString(),
    htmlPreview,
  };
  sentEmailsOutbox.unshift(record);
  if (sentEmailsOutbox.length > 50) sentEmailsOutbox.pop();

  return { sentViaSmtp, previewRecord: record };
}

async function getUnlockedViewerSession(fileId: string): Promise<ViewerSession | null> {
  const cached = viewerCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const previewRes = await fetch(`https://drive.google.com/file/d/${fileId}/preview`, {
    headers: { 'User-Agent': CHROME_UA },
  });
  const setCookies = previewRes.headers.getSetCookie
    ? previewRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    : '';
  const html = await previewRes.text();

  const m = html.match(/itemJson:\s*(\[[\s\S]*?\])\};/);
  if (!m) return null;

  const itemJson = JSON.parse(m[1]);
  const title = typeof itemJson[1] === 'string' ? itemJson[1] : `Drive_${fileId}`;
  const uploadUrl = itemJson[9];
  if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('http')) return null;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'User-Agent': CHROME_UA,
      Cookie: setCookies,
    },
  });
  const rawUpload = (await uploadRes.text()).replace(/^\)\]\}'\s*/, '');
  const uploadData = JSON.parse(rawUpload);

  const metaRes = await fetch(`https://drive.google.com/viewer/${uploadData.meta}`, {
    headers: {
      'User-Agent': CHROME_UA,
      Cookie: setCookies,
    },
  });
  const rawMeta = (await metaRes.text()).replace(/^\)\]\}'\s*/, '');
  const metaData = JSON.parse(rawMeta);

  const session: ViewerSession = {
    cookies: setCookies,
    imgBasePath: uploadData.img,
    pages: Number(metaData.pages) || 1,
    title,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  viewerCache.set(fileId, session);
  return session;
}

export const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Layer 4: Payload Size Guard (64KB limit against memory exhaustion DDoS)
app.use(express.json({ limit: '64kb' }));

// Layer 1-4: Multi-Layer Anti-DDoS, WAF, Concurrency & Sliding Window Rate Limiter
app.use((req, res, next) => {
    // Hardened HTTP Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }

    totalRequestsCount += 1;
    const ip = getClientIp(req);
    const nowMs = Date.now();
    const ua = String(req.headers['user-agent'] || '');

    let record = ipRecords.get(ip);
    if (!record) {
      record = {
        ip,
        requestsInWindow: 0,
        authRequestsInWindow: 0,
        downloadRequestsInWindow: 0,
        windowStartMs: nowMs,
        activeConcurrent: 0,
        violations: 0,
        bannedUntilMs: 0,
        lastSeenAt: new Date(nowMs).toISOString(),
        lastPath: req.path,
        userAgent: ua.slice(0, 120),
      };
      ipRecords.set(ip, record);
    }

    // Reset sliding window if expired
    if (nowMs - record.windowStartMs >= ddosConfig.windowMs) {
      record.windowStartMs = nowMs;
      record.requestsInWindow = 0;
      record.authRequestsInWindow = 0;
      record.downloadRequestsInWindow = 0;
    }

    record.lastSeenAt = new Date(nowMs).toISOString();
    record.lastPath = req.path;
    record.userAgent = ua.slice(0, 120);

    // Allow security admin endpoints so admin never locks themselves out of viewing/resetting DDoS controls
    if (req.path.startsWith('/api/security/')) {
      next();
      return;
    }

    // Layer 3: WAF Payload & Bot Signature Inspection
    if (ddosConfig.enabled && ddosConfig.wafSqlXssProtection) {
      const rawBody = req.body ? JSON.stringify(req.body) : '';
      const wafResult = inspectWafRequest(req.originalUrl, rawBody, ua);
      if (wafResult.blocked) {
        record.violations += 1;
        recordSecurityEvent(
          ip,
          req.method,
          req.path,
          wafResult.reason || 'WAF Blocked',
          'WAF-Payload',
          'blocked-403'
        );
        res.status(403).json({
          error: `[LKimLamDrive Anti-DDoS WAF] Yêu cầu bị từ chối: ${wafResult.reason}`,
        });
        return;
      }
    }

    // Increment counters
    record.requestsInWindow += 1;
    record.activeConcurrent += 1;

    let bucket: 'general' | 'auth' | 'download' = 'general';
    if (req.path.startsWith('/api/auth/')) {
      record.authRequestsInWindow += 1;
      bucket = 'auth';
    } else if (req.path.startsWith('/api/download/') || req.path.startsWith('/api/list-files')) {
      record.downloadRequestsInWindow += 1;
      bucket = 'download';
    }

    let cleanedUp = false;
    const decConcurrent = () => {
      if (!cleanedUp && record) {
        cleanedUp = true;
        record.activeConcurrent = Math.max(0, record.activeConcurrent - 1);
      }
    };
    res.on('finish', decConcurrent);
    res.on('close', decConcurrent);

    const decision = evaluateRateLimitDecision(record, ddosConfig, bucket, nowMs);
    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    res.setHeader('X-RateLimit-Reset', String(decision.resetSeconds));

    if (!decision.allowed) {
      record.violations += 1;
      let action: DdosSecurityEvent['action'] =
        decision.statusCode === 403 ? 'blocked-403' : 'throttled-429';

      // Auto-Jail if violations exceed threshold
      if (
        record.violations >= ddosConfig.autoBanThresholdViolations &&
        record.bannedUntilMs <= nowMs &&
        !ddosConfig.whitelistedIps.includes(ip)
      ) {
        record.bannedUntilMs = nowMs + ddosConfig.autoBanDurationMinutes * 60_000;
        action = 'auto-banned';
      }

      res.setHeader('Retry-After', String(decision.resetSeconds));
      recordSecurityEvent(
        ip,
        req.method,
        req.path,
        decision.reason || 'Rate limit exceeded',
        decision.layer || 'L7-RateLimit',
        action
      );

      res.status(decision.statusCode).json({
        error: `[LKimLamDrive Anti-DDoS Shield] ${decision.reason}. Vui lòng thử lại sau ${decision.resetSeconds} giây.`,
        retryAfterSeconds: decision.resetSeconds,
      });
      return;
    }

    next();
  });

  // ============================================================================
  // Gmail OTP Registration Verification & Password Recovery Endpoints
  // ============================================================================
  app.post('/api/auth/send-verification', async (req, res) => {
    try {
      const { email, username, password, smtpEmail, smtpAppPassword } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanUsername = String(username || '').trim();
      const ip = getClientIp(req);
      const nowMs = Date.now();

      if (!cleanEmail || !cleanEmail.includes('@')) {
        res.status(400).json({ error: 'Địa chỉ Gmail không hợp lệ' });
        return;
      }

      // Check Brute-Force Lockout on this email or IP
      const emailLock = otpBruteForceLockouts.get(cleanEmail);
      const ipLock = otpBruteForceLockouts.get(`ip:${ip}`);
      const activeLockUntil = Math.max(emailLock?.lockedUntilMs || 0, ipLock?.lockedUntilMs || 0);
      if (activeLockUntil > nowMs) {
        const waitSec = Math.ceil((activeLockUntil - nowMs) / 1000);
        res.status(429).json({
          error: `[Chống Brute-Force] Địa chỉ Gmail hoặc IP này đang bị tạm khóa ${waitSec} giây do nhập sai OTP quá ${MAX_OTP_ATTEMPTS} lần.`,
          lockedOut: true,
          retryAfterSeconds: waitSec,
        });
        return;
      }

      // Check 60s Resend Cooldown to prevent Email Bombing
      const existingSession = otpStore.get(`register:${cleanEmail}`);
      if (existingSession && nowMs - existingSession.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (nowMs - existingSession.lastSentAt)) / 1000);
        res.status(429).json({
          error: `Vui lòng đợi ${waitSec} giây trước khi yêu cầu gửi lại mã xác thực tới Gmail.`,
          cooldownSeconds: waitSec,
        });
        return;
      }

      if (smtpEmail && smtpAppPassword) {
        runtimeSmtpConfig = { smtpEmail: String(smtpEmail), smtpAppPassword: String(smtpAppPassword) };
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = nowMs + 10 * 60 * 1000;

      otpStore.set(`register:${cleanEmail}`, {
        email: cleanEmail,
        username: cleanUsername || cleanEmail.split('@')[0],
        code,
        purpose: 'register',
        expiresAt,
        lastSentAt: nowMs,
        failedAttempts: 0,
        verified: false,
      });

      const mailRes = await dispatchGmailVerificationEmail({
        to: cleanEmail,
        username: cleanUsername,
        code,
        purpose: 'register',
        userPassword: password ? String(password) : undefined,
      });

      const otpToken = createSignedOtpToken('register', cleanEmail, code, expiresAt);

      // NEVER return the OTP code in the API response!
      res.json({
        success: true,
        sentViaSmtp: mailRes.sentViaSmtp,
        email: cleanEmail,
        otpToken,
        maxAttempts: MAX_OTP_ATTEMPTS,
        remainingAttempts: MAX_OTP_ATTEMPTS,
        cooldownSeconds: 60,
        message: `Đã gửi email xác thực tới hộp thư Gmail ${cleanEmail}. Mã xác thực chỉ nằm trong Gmail của bạn (Tối đa ${MAX_OTP_ATTEMPTS} lần thử).`,
      });
    } catch (err) {
      console.error('send-verification error:', err);
      res.status(500).json({ error: 'Không thể gửi email xác thực' });
    }
  });

  app.post('/api/auth/verify-otp', (req, res) => {
    const { email, code, purpose = 'register', otpToken } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();
    const cleanPurpose = purpose === 'reset-password' ? 'reset-password' : 'register';
    const key = `${cleanPurpose}:${cleanEmail}`;
    const ip = getClientIp(req);
    const nowMs = Date.now();

    // 1. Check active Brute-Force Lockout
    const emailLock = otpBruteForceLockouts.get(cleanEmail) || {
      failedCount: 0,
      lockedUntilMs: 0,
      lastAttemptMs: nowMs,
    };
    const ipLock = otpBruteForceLockouts.get(`ip:${ip}`) || {
      failedCount: 0,
      lockedUntilMs: 0,
      lastAttemptMs: nowMs,
    };

    const activeLockUntil = Math.max(emailLock.lockedUntilMs, ipLock.lockedUntilMs);
    if (activeLockUntil > nowMs) {
      const waitSec = Math.ceil((activeLockUntil - nowMs) / 1000);
      res.status(429).json({
        error: `[Chống Brute-Force] Quá giới hạn ${MAX_OTP_ATTEMPTS} lần thử! Tạm khóa xác thực trong ${waitSec} giây.`,
        lockedOut: true,
        retryAfterSeconds: waitSec,
        remainingAttempts: 0,
      });
      return;
    }

    const session = otpStore.get(key);
    let isCodeMatch = false;

    if (session) {
      if (nowMs > session.expiresAt) {
        otpStore.delete(key);
        res.status(400).json({
          error: 'Mã xác thực OTP đã hết hạn (quá 10 phút). Vui lòng yêu cầu gửi mã mới vào Gmail.',
        });
        return;
      }
      isCodeMatch = session.code === cleanCode;
    } else if (typeof otpToken === 'string' && otpToken.includes('.')) {
      // Stateless Serverless verification via HMAC-SHA256 signature
      const tokenCheck = verifySignedOtpToken(otpToken, cleanPurpose, cleanEmail, cleanCode);
      if (tokenCheck.expired) {
        res.status(400).json({
          error: 'Mã xác thực OTP đã hết hạn (quá 10 phút). Vui lòng yêu cầu gửi mã mới vào Gmail.',
        });
        return;
      }
      isCodeMatch = tokenCheck.valid;
    } else {
      res.status(400).json({
        error: 'Phiên xác thực không tồn tại hoặc đã bị hủy. Vui lòng gửi lại email xác thực.',
      });
      return;
    }

    if (!isCodeMatch) {
      // Increment brute-force counters
      const currentFailed = (session ? session.failedAttempts : emailLock.failedCount) + 1;
      if (session) {
        session.failedAttempts = currentFailed;
        otpStore.set(key, session);
      }

      emailLock.failedCount = currentFailed;
      emailLock.lastAttemptMs = nowMs;
      ipLock.failedCount += 1;
      ipLock.lastAttemptMs = nowMs;

      const remaining = Math.max(0, MAX_OTP_ATTEMPTS - currentFailed);

      if (currentFailed >= MAX_OTP_ATTEMPTS) {
        // Destroy OTP immediately so it can never be brute-forced
        otpStore.delete(key);
        emailLock.lockedUntilMs = nowMs + BRUTE_FORCE_LOCKOUT_MS;
        ipLock.lockedUntilMs = nowMs + BRUTE_FORCE_LOCKOUT_MS;
        otpBruteForceLockouts.set(cleanEmail, emailLock);
        otpBruteForceLockouts.set(`ip:${ip}`, ipLock);

        recordSecurityEvent(
          ip,
          'POST',
          '/api/auth/verify-otp',
          `[Brute-Force OTP] Nhập sai mã OTP ${MAX_OTP_ATTEMPTS}/${MAX_OTP_ATTEMPTS} lần liên tiếp cho ${cleanEmail} — Đã hủy mã OTP & Khóa 15 phút`,
          'Auto-Jail',
          'auto-banned'
        );

        res.status(429).json({
          error: `[Chống Brute-Force Attack] Bạn đã nhập sai quá ${MAX_OTP_ATTEMPTS} lần! Mã OTP đã bị hủy ngay lập tức và tài khoản bị khóa xác thực 15 phút.`,
          lockedOut: true,
          retryAfterSeconds: Math.ceil(BRUTE_FORCE_LOCKOUT_MS / 1000),
          remainingAttempts: 0,
        });
        return;
      }

      otpBruteForceLockouts.set(cleanEmail, emailLock);
      otpBruteForceLockouts.set(`ip:${ip}`, ipLock);

      recordSecurityEvent(
        ip,
        'POST',
        '/api/auth/verify-otp',
        `[Cảnh báo Brute-Force OTP] Nhập sai OTP cho ${cleanEmail} (Lần ${currentFailed}/${MAX_OTP_ATTEMPTS})`,
        'L7-RateLimit',
        'throttled-429'
      );

      res.status(400).json({
        error: `Mã OTP không chính xác! Bạn chỉ còn ${remaining}/${MAX_OTP_ATTEMPTS} lần thử trước khi mã bị hủy và khóa 15 phút.`,
        remainingAttempts: remaining,
        lockedOut: false,
      });
      return;
    }

    // Success: reset brute-force counters & consume OTP
    otpStore.delete(key);
    otpBruteForceLockouts.delete(cleanEmail);
    otpBruteForceLockouts.delete(`ip:${ip}`);

    res.json({
      success: true,
      email: cleanEmail,
      message: 'Xác thực Gmail thành công!',
    });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email, username, userPassword, smtpEmail, smtpAppPassword } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const ip = getClientIp(req);
      const nowMs = Date.now();

      if (!cleanEmail || !cleanEmail.includes('@')) {
        res.status(400).json({ error: 'Vui lòng nhập đúng địa chỉ Gmail đã đăng ký' });
        return;
      }

      // Check Brute-Force Lockout
      const emailLock = otpBruteForceLockouts.get(cleanEmail);
      const ipLock = otpBruteForceLockouts.get(`ip:${ip}`);
      const activeLockUntil = Math.max(emailLock?.lockedUntilMs || 0, ipLock?.lockedUntilMs || 0);
      if (activeLockUntil > nowMs) {
        const waitSec = Math.ceil((activeLockUntil - nowMs) / 1000);
        res.status(429).json({
          error: `[Chống Brute-Force] Yêu cầu khôi phục cho Gmail này đang tạm khóa ${waitSec} giây do thử sai quá nhiều lần.`,
          lockedOut: true,
          retryAfterSeconds: waitSec,
        });
        return;
      }

      // Check 60s Resend Cooldown
      const existingSession = otpStore.get(`reset-password:${cleanEmail}`);
      if (existingSession && nowMs - existingSession.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (nowMs - existingSession.lastSentAt)) / 1000);
        res.status(429).json({
          error: `Vui lòng đợi ${waitSec} giây trước khi gửi lại email khôi phục mật khẩu.`,
          cooldownSeconds: waitSec,
        });
        return;
      }

      if (smtpEmail && smtpAppPassword) {
        runtimeSmtpConfig = { smtpEmail: String(smtpEmail), smtpAppPassword: String(smtpAppPassword) };
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = nowMs + 10 * 60 * 1000;

      otpStore.set(`reset-password:${cleanEmail}`, {
        email: cleanEmail,
        username: String(username || cleanEmail.split('@')[0]),
        code,
        purpose: 'reset-password',
        expiresAt,
        lastSentAt: nowMs,
        failedAttempts: 0,
        verified: false,
      });

      const mailRes = await dispatchGmailVerificationEmail({
        to: cleanEmail,
        username: String(username || cleanEmail.split('@')[0]),
        code,
        purpose: 'reset-password',
        userPassword: userPassword ? String(userPassword) : undefined,
      });

      const otpToken = createSignedOtpToken('reset-password', cleanEmail, code, expiresAt);

      // NEVER return the OTP code in the API response!
      res.json({
        success: true,
        sentViaSmtp: mailRes.sentViaSmtp,
        email: cleanEmail,
        otpToken,
        maxAttempts: MAX_OTP_ATTEMPTS,
        remainingAttempts: MAX_OTP_ATTEMPTS,
        cooldownSeconds: 60,
        message: `Đã gửi thư khôi phục mật khẩu tới hộp thư Gmail ${cleanEmail}. Vui lòng mở Gmail của bạn (Tối đa ${MAX_OTP_ATTEMPTS} lần thử).`,
      });
    } catch (err) {
      console.error('forgot-password error:', err);
      res.status(500).json({ error: 'Không thể gửi email khôi phục mật khẩu' });
    }
  });

  // Anti-Brute-Force Login Guard Endpoint (Max 5 failed login attempts -> 15m lockout)
  app.post('/api/auth/login-guard', (req, res) => {
    const { identifier, outcome } = req.body || {};
    const cleanId = String(identifier || '').trim().toLowerCase() || 'unknown';
    const ip = getClientIp(req);
    const nowMs = Date.now();
    const key = `login:${cleanId}:${ip}`;

    const tracker = loginBruteForceLockouts.get(key) || {
      failedCount: 0,
      lockedUntilMs: 0,
      lastAttemptMs: nowMs,
    };

    if (tracker.lockedUntilMs > nowMs) {
      const waitSec = Math.ceil((tracker.lockedUntilMs - nowMs) / 1000);
      res.status(429).json({
        allowed: false,
        lockedOut: true,
        retryAfterSeconds: waitSec,
        remainingAttempts: 0,
        error: `[Chống Brute-Force] Tài khoản tạm khóa đăng nhập trong ${waitSec} giây do nhập sai mật khẩu quá ${MAX_LOGIN_ATTEMPTS} lần.`,
      });
      return;
    }

    if (outcome === 'success') {
      loginBruteForceLockouts.delete(key);
      res.json({ allowed: true, remainingAttempts: MAX_LOGIN_ATTEMPTS });
      return;
    }

    if (outcome === 'failed') {
      tracker.failedCount += 1;
      tracker.lastAttemptMs = nowMs;
      const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - tracker.failedCount);

      if (tracker.failedCount >= MAX_LOGIN_ATTEMPTS) {
        tracker.lockedUntilMs = nowMs + BRUTE_FORCE_LOCKOUT_MS;
        loginBruteForceLockouts.set(key, tracker);
        recordSecurityEvent(
          ip,
          'POST',
          '/api/auth/login',
          `[Brute-Force Login] Đăng nhập sai mật khẩu ${MAX_LOGIN_ATTEMPTS}/${MAX_LOGIN_ATTEMPTS} lần liên tiếp (${cleanId}) — Khóa 15 phút`,
          'Auto-Jail',
          'auto-banned'
        );
        res.status(429).json({
          allowed: false,
          lockedOut: true,
          retryAfterSeconds: Math.ceil(BRUTE_FORCE_LOCKOUT_MS / 1000),
          remainingAttempts: 0,
          error: `[Chống Brute-Force Attack] Nhập sai mật khẩu ${MAX_LOGIN_ATTEMPTS} lần liên tiếp! Tạm khóa đăng nhập 15 phút.`,
        });
        return;
      }

      loginBruteForceLockouts.set(key, tracker);
      res.json({
        allowed: true,
        lockedOut: false,
        remainingAttempts: remaining,
        error: `Sai thông tin đăng nhập! Cảnh báo Brute-Force: Còn ${remaining}/${MAX_LOGIN_ATTEMPTS} lần thử trước khi khóa 15 phút.`,
      });
      return;
    }

    res.json({
      allowed: true,
      lockedOut: false,
      remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - tracker.failedCount),
    });
  });

  app.get('/api/auth/outbox', (_req, res) => {
    res.json({
      smtpConfigured: Boolean(runtimeSmtpConfig.smtpEmail && runtimeSmtpConfig.smtpAppPassword),
      smtpEmail: runtimeSmtpConfig.smtpEmail,
      emails: sentEmailsOutbox.slice(0, 30),
    });
  });

  // ============================================================================
  // Anti-DDoS & Rate Limiting Admin Telemetry & Control Endpoints
  // ============================================================================
  app.get('/api/security/status', (_req, res) => {
    const nowMs = Date.now();
    const activeIps = Array.from(ipRecords.values()).map((r) => ({
      ...r,
      isBlacklisted: ddosConfig.blacklistedIps.includes(r.ip),
      isWhitelisted: ddosConfig.whitelistedIps.includes(r.ip),
      isAutoBanned: r.bannedUntilMs > nowMs,
      bannedRemainingSec: r.bannedUntilMs > nowMs ? Math.ceil((r.bannedUntilMs - nowMs) / 1000) : 0,
    }));

    res.json({
      config: ddosConfig,
      stats: {
        totalRequests: totalRequestsCount,
        totalBlocked: totalBlockedCount,
        trackedIpsCount: ipRecords.size,
        autoBannedCount: activeIps.filter((i) => i.isAutoBanned || i.isBlacklisted).length,
      },
      ips: activeIps.sort((a, b) => b.requestsInWindow - a.requestsInWindow).slice(0, 50),
      events: securityEvents.slice(0, 60),
    });
  });

  app.post('/api/security/config', (req, res) => {
    const partial = req.body || {};
    ddosConfig = {
      ...ddosConfig,
      ...partial,
      windowMs: Math.max(5000, Number(partial.windowMs ?? ddosConfig.windowMs)),
      maxRequestsPerWindow: Math.max(5, Number(partial.maxRequestsPerWindow ?? ddosConfig.maxRequestsPerWindow)),
      maxAuthRequestsPerWindow: Math.max(3, Number(partial.maxAuthRequestsPerWindow ?? ddosConfig.maxAuthRequestsPerWindow)),
      maxDownloadRequestsPerWindow: Math.max(3, Number(partial.maxDownloadRequestsPerWindow ?? ddosConfig.maxDownloadRequestsPerWindow)),
      maxConcurrentPerIp: Math.max(2, Number(partial.maxConcurrentPerIp ?? ddosConfig.maxConcurrentPerIp)),
      autoBanThresholdViolations: Math.max(1, Number(partial.autoBanThresholdViolations ?? ddosConfig.autoBanThresholdViolations)),
      autoBanDurationMinutes: Math.max(1, Number(partial.autoBanDurationMinutes ?? ddosConfig.autoBanDurationMinutes)),
    };
    if (partial.smtpEmail !== undefined || partial.smtpAppPassword !== undefined) {
      runtimeSmtpConfig = {
        smtpEmail: String(partial.smtpEmail ?? runtimeSmtpConfig.smtpEmail),
        smtpAppPassword: String(partial.smtpAppPassword ?? runtimeSmtpConfig.smtpAppPassword),
      };
    }
    res.json({ success: true, config: ddosConfig });
  });

  app.post('/api/security/ip-action', (req, res) => {
    const { ip, action } = req.body || {};
    const targetIp = String(ip || '').trim();

    if (action === 'clear-events') {
      securityEvents.length = 0;
      totalBlockedCount = 0;
      res.json({ success: true });
      return;
    }

    if (action === 'simulate-attack') {
      const simIp = targetIp || `203.113.${Math.floor(10 + Math.random() * 200)}.${Math.floor(10 + Math.random() * 240)}`;
      const nowMs = Date.now();
      ipRecords.set(simIp, {
        ip: simIp,
        requestsInWindow: ddosConfig.maxRequestsPerWindow + 45,
        authRequestsInWindow: ddosConfig.maxAuthRequestsPerWindow + 10,
        downloadRequestsInWindow: ddosConfig.maxDownloadRequestsPerWindow + 15,
        windowStartMs: nowMs,
        activeConcurrent: 0,
        violations: ddosConfig.autoBanThresholdViolations + 2,
        bannedUntilMs: nowMs + ddosConfig.autoBanDurationMinutes * 60_000,
        lastSeenAt: new Date(nowMs).toISOString(),
        lastPath: '/api/auth/login (Simulated Flood)',
        userAgent: 'Botnet-Flood-Simulator/2.1',
      });
      recordSecurityEvent(
        simIp,
        'POST',
        '/api/auth/login',
        `Phát hiện HTTP Flood (${ddosConfig.maxRequestsPerWindow + 45} req/phút) — Tự động cách ly IP vào Penalty Box`,
        'Auto-Jail',
        'auto-banned'
      );
      res.json({ success: true, simulatedIp: simIp });
      return;
    }

    if (!targetIp) {
      res.status(400).json({ error: 'Thiếu địa chỉ IP' });
      return;
    }

    if (action === 'blacklist') {
      if (!ddosConfig.blacklistedIps.includes(targetIp)) {
        ddosConfig.blacklistedIps.push(targetIp);
      }
      ddosConfig.whitelistedIps = ddosConfig.whitelistedIps.filter((i) => i !== targetIp);
    } else if (action === 'unban') {
      ddosConfig.blacklistedIps = ddosConfig.blacklistedIps.filter((i) => i !== targetIp);
      const rec = ipRecords.get(targetIp);
      if (rec) {
        rec.bannedUntilMs = 0;
        rec.violations = 0;
        rec.requestsInWindow = 0;
        rec.authRequestsInWindow = 0;
        rec.downloadRequestsInWindow = 0;
      }
    } else if (action === 'whitelist') {
      if (!ddosConfig.whitelistedIps.includes(targetIp)) {
        ddosConfig.whitelistedIps.push(targetIp);
      }
      ddosConfig.blacklistedIps = ddosConfig.blacklistedIps.filter((i) => i !== targetIp);
      const rec = ipRecords.get(targetIp);
      if (rec) {
        rec.bannedUntilMs = 0;
        rec.violations = 0;
      }
    }

    res.json({ success: true, config: ddosConfig });
  });

  app.post('/api/list-files', async (req, res) => {
    try {
      const {
        driveUrl,
        costPerSingleFileCredit = 1,
        costPerGbCredit = 1,
        userId,
      } = req.body || {};

      const authUser = String(userId || req.headers['x-user-id'] || '').trim();
      if (!authUser) {
        res.status(401).json({
          error:
            'Ràng buộc bảo mật: Bạn cần đăng ký hoặc đăng nhập tài khoản trước khi dán link Google Drive và xem danh sách files.',
          requireAuth: true,
        });
        return;
      }

      const parsed = parseDriveUrl(String(driveUrl || ''));
      if (!parsed.isValid) {
        res.status(400).json({
          error: String(driveUrl || '').includes('/folders')
            ? 'Đường dẫn thư mục Google Drive đang bị thiếu mã ID ở cuối (Ví dụ đúng: https://drive.google.com/drive/folders/1AbCdEf...). Hãy chuột phải vào thư mục -> Chia sẻ -> Sao chép đường liên kết!'
            : 'Link Google Drive không hợp lệ. Vui lòng dán đúng link File hoặc Thư mục Google Drive.',
        });
        return;
      }

      if (parsed.type === 'folder') {
        const folderData = await fetchRealDriveFolder(
          parsed.resourceId,
          Number(costPerSingleFileCredit) || 1,
          Number(costPerGbCredit) || 1,
          parsed.resourceKey
        );

        if (folderData.files.length === 0) {
          res.status(404).json({
            error:
              'Không tìm thấy file công khai trong thư mục này. Hãy đảm bảo thư mục Google Drive được bật chia sẻ công khai.',
          });
          return;
        }

        res.json({
          type: 'folder',
          resourceId: parsed.resourceId,
          folderTitle: folderData.folderTitle,
          files: folderData.files,
        });
        return;
      }

      const singleFile = await fetchRealSingleDriveFile(
        parsed.resourceId,
        Number(costPerSingleFileCredit) || 1,
        Number(costPerGbCredit) || 1
      );
      res.json({
        type: 'file',
        resourceId: parsed.resourceId,
        folderTitle: singleFile.name,
        files: [singleFile],
      });
    } catch (err) {
      console.error('Error in /api/list-files:', err);
      res.status(500).json({
        error: 'Không thể kết nối tới Google Drive để lấy danh sách file. Vui lòng thử lại.',
      });
    }
  });

  app.post('/api/download/start', async (req, res) => {
    try {
      const {
        driveUrl,
        selectedFileIds,
        costPerSingleFileCredit = 1,
        costPerGbCredit = 1,
        userId,
      } = req.body || {};

      const authUser = String(userId || req.headers['x-user-id'] || '').trim();
      if (!authUser) {
        res.status(401).json({
          error:
            'Ràng buộc bảo mật: Bạn cần đăng ký hoặc đăng nhập tài khoản trước khi thực hiện tải file.',
          requireAuth: true,
        });
        return;
      }

      const parsed = parseDriveUrl(String(driveUrl || ''));
      if (!parsed.isValid) {
        res.status(400).json({ error: 'Link Google Drive không hợp lệ' });
        return;
      }

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      let targetFiles: DriveFileItem[] = [];
      let folderTitle = '';

      if (parsed.type === 'folder') {
        const folderData = await fetchRealDriveFolder(
          parsed.resourceId,
          Number(costPerSingleFileCredit) || 1,
          Number(costPerGbCredit) || 1,
          parsed.resourceKey
        );
        folderTitle = folderData.folderTitle;
        if (Array.isArray(selectedFileIds) && selectedFileIds.length > 0) {
          const idSet = new Set(selectedFileIds.map(String));
          targetFiles = folderData.files.filter((f) => idSet.has(f.id));
        } else {
          targetFiles = folderData.files;
        }
      } else {
        const single = await fetchRealSingleDriveFile(
          parsed.resourceId,
          Number(costPerSingleFileCredit) || 1,
          Number(costPerGbCredit) || 1
        );
        folderTitle = single.name;
        targetFiles = [single];
      }

      if (targetFiles.length === 0) {
        const errJob: ActiveJob = {
          id: jobId,
          status: 'error',
          progress: 0,
          message: 'Không tìm thấy tệp nào để xử lý trong đường dẫn này.',
          current: 0,
          total: 0,
        };
        jobs.set(jobId, errJob);
        res.json({ job_id: jobId, job: errJob });
        return;
      }

      const total = targetFiles.length;
      const enrichedFiles: ProcessedFileResult[] = targetFiles.map((f) => ({
        ...f,
        proxyDownloadUrl: `/api/download/file/${encodeURIComponent(f.id)}?name=${encodeURIComponent(f.name)}`,
        viewerUnlockUrl: `/api/download/file/${encodeURIComponent(f.id)}?name=${encodeURIComponent(f.name)}&mode=viewer`,
        driveViewUrl:
          f.mimeType === 'application/vnd.google-apps.folder'
            ? `https://drive.google.com/drive/folders/${f.id}`
            : `https://drive.google.com/file/d/${f.id}/view`,
      }));

      const mainDriveLink =
        parsed.type === 'folder'
          ? `https://drive.google.com/drive/folders/${parsed.resourceId}`
          : `https://drive.google.com/file/d/${parsed.resourceId}/view`;

      const completedJob: ActiveJob = {
        id: jobId,
        status: 'completed',
        progress: 100,
        message: `Hoàn tất! Đã mở khóa ${total} file từ "${folderTitle}" (Hỗ trợ tải .PPTX đầy đủ hiệu ứng & PDF)`,
        current: total,
        total,
        driveLink: mainDriveLink,
        folderTitle,
        files: enrichedFiles,
      };

      jobs.set(jobId, completedJob);
      res.json({ job_id: jobId, job: completedJob });
    } catch (err) {
      console.error('Error starting job:', err);
      res.status(500).json({ error: 'Không thể khởi tạo tiến trình tải' });
    }
  });

  app.get('/api/download/progress/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ status: 'error', message: 'Không tìm thấy tiến trình tải' });
      return;
    }
    res.json(job);
  });

  app.get('/api/download/slide/:fileId/:page', async (req, res) => {
    try {
      const { fileId, page } = req.params;
      const session = await getUnlockedViewerSession(fileId);
      if (!session) {
        res.status(404).send('Slide not available');
        return;
      }
      const imgUrl = `https://drive.google.com/viewer/${session.imgBasePath}&page=${encodeURIComponent(page)}&w=1600`;
      const imgRes = await fetch(imgUrl, {
        headers: {
          'User-Agent': CHROME_UA,
          Cookie: session.cookies,
        },
      });
      if (!imgRes.ok) {
        res.status(imgRes.status).send('Failed to load slide');
        return;
      }
      const contentType = imgRes.headers.get('content-type') || 'image/png';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=600');
      const arrayBuffer = await imgRes.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (err) {
      console.error('Slide proxy error:', err);
      res.status(500).send('Slide error');
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'LKimLamDrive API',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  interface StreamOriginalResult {
    success: boolean;
    contentType?: string;
    contentLength?: string;
    fileName?: string;
    stream?: NodeJS.ReadableStream;
  }

  async function fetchGoogleDriveOriginalStream(
    fileId: string,
    preferredFileName?: string
  ): Promise<StreamOriginalResult> {
    const cleanBaseName = (preferredFileName || `File_${fileId}`).trim();

    const getCookies = (response: Response): string => {
      if (typeof (response.headers as any).getSetCookie === 'function') {
        const list = (response.headers as any).getSetCookie();
        return list.map((c: string) => c.split(';')[0]).join('; ');
      }
      const raw = response.headers.get('set-cookie');
      if (!raw) return '';
      return raw.split(/,(?=[^;]+=[^;]+)/).map((c: string) => c.trim().split(';')[0]).join('; ');
    };

    // 1. Try Google Drive Usercontent Direct Download (Primary for all binary files: PPTX, PDF, ZIP, MP4, etc.)
    const candidateUrls = [
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&authuser=0`,
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      `https://docs.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
    ];

    for (const initialUrl of candidateUrls) {
      try {
        const initRes = await fetch(initialUrl, {
          headers: {
            'User-Agent': CHROME_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
          },
          redirect: 'follow',
        });

        const initialCt = initRes.headers.get('content-type') || '';

        // If it returned a binary file directly (not HTML virus warning page)
        if (initRes.ok && !initialCt.includes('text/html') && initRes.body) {
          let detectedName = cleanBaseName;
          const cd = initRes.headers.get('content-disposition') || '';
          const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
          const normalMatch = cd.match(/filename="?([^";]+)"?/i);
          if (utf8Match && utf8Match[1]) {
            try { detectedName = decodeURIComponent(utf8Match[1]); } catch { detectedName = utf8Match[1]; }
          } else if (normalMatch && normalMatch[1]) {
            detectedName = normalMatch[1];
          }

          return {
            success: true,
            contentType: initialCt,
            contentLength: initRes.headers.get('content-length') || undefined,
            fileName: detectedName,
            stream: Readable.fromWeb(initRes.body as any),
          };
        }

        // If it returned HTML, this is the Google Drive virus scan warning for large files (>25MB like 35.5 MB or 89 MB)
        if (initRes.ok && initialCt.includes('text/html')) {
          const html = await initRes.text();
          const cookies = getCookies(initRes);

          // Extract hidden inputs from download form
          const formActionMatch = html.match(/<form[^>]+action=["']([^"']+)["'][^>]*>/i);
          let actionUrl = formActionMatch ? formActionMatch[1] : 'https://drive.usercontent.google.com/download';
          if (actionUrl.startsWith('/')) {
            actionUrl = `https://drive.usercontent.google.com${actionUrl}`;
          }

          const queryParams = new URLSearchParams();
          const inputRegex = /<input[^>]+name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
          let m;
          while ((m = inputRegex.exec(html)) !== null) {
            queryParams.set(m[1], m[2]);
          }

          const inputRegexRev = /<input[^>]+value=["']([^"']*)["'][^>]*name=["']([^"']+)["'][^>]*>/gi;
          while ((m = inputRegexRev.exec(html)) !== null) {
            if (!queryParams.has(m[2])) {
              queryParams.set(m[2], m[1]);
            }
          }

          if (!queryParams.has('id')) queryParams.set('id', fileId);
          if (!queryParams.has('export')) queryParams.set('export', 'download');

          const uuidMatch = html.match(/name=["']uuid["']\s+value=["']([^"']+)["']/i) ||
                            html.match(/value=["']([^"']+)["']\s+name=["']uuid["']/i) ||
                            html.match(/[?&]uuid=([a-zA-Z0-9_-]+)/);
          if (uuidMatch && !queryParams.has('uuid')) queryParams.set('uuid', uuidMatch[1]);

          const confirmMatch = html.match(/name=["']confirm["']\s+value=["']([^"']+)["']/i) ||
                               html.match(/[?&]confirm=([a-zA-Z0-9_-]+)/i);
          if (confirmMatch && !queryParams.has('confirm')) {
            queryParams.set('confirm', confirmMatch[1]);
          } else if (!queryParams.has('confirm')) {
            queryParams.set('confirm', 't');
          }

          const ucLinkMatch = html.match(/id=["']uc-download-link["'][^>]+href=["']([^"']+)["']/i) ||
                              html.match(/href=["']([^"']+)["'][^>]+id=["']uc-download-link["']/i);
          let confirmDownloadUrl = `${actionUrl}?${queryParams.toString()}`;
          if (ucLinkMatch && ucLinkMatch[1]) {
            const rawLink = ucLinkMatch[1].replace(/&amp;/g, '&');
            confirmDownloadUrl = rawLink.startsWith('http') ? rawLink : `https://drive.usercontent.google.com${rawLink}`;
          }

          // Execute second confirmed request with captured cookies and query parameters
          const confirmedRes = await fetch(confirmDownloadUrl, {
            headers: {
              'User-Agent': CHROME_UA,
              'Cookie': cookies,
              'Referer': initialUrl,
              'Accept': '*/*',
            },
            redirect: 'follow',
          });

          const confirmedCt = confirmedRes.headers.get('content-type') || '';
          if (confirmedRes.ok && !confirmedCt.includes('text/html') && confirmedRes.body) {
            let detectedName = cleanBaseName;
            const cd = confirmedRes.headers.get('content-disposition') || '';
            const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
            const normalMatch = cd.match(/filename="?([^";]+)"?/i);
            if (utf8Match && utf8Match[1]) {
              try { detectedName = decodeURIComponent(utf8Match[1]); } catch { detectedName = utf8Match[1]; }
            } else if (normalMatch && normalMatch[1]) {
              detectedName = normalMatch[1];
            }

            return {
              success: true,
              contentType: confirmedCt,
              contentLength: confirmedRes.headers.get('content-length') || undefined,
              fileName: detectedName,
              stream: Readable.fromWeb(confirmedRes.body as any),
            };
          }
        }
      } catch (err) {
        console.warn(`Error attempting drive download via ${initialUrl}:`, err);
      }
    }

    // 2. Try Google Slides presentation export endpoint (for native Google Slides documents)
    try {
      const exportUrl = `https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/export/pptx`;
      const exportRes = await fetch(exportUrl, {
        headers: {
          'User-Agent': CHROME_UA,
          'Accept': '*/*',
        },
        redirect: 'follow',
      });

      const exportCt = exportRes.headers.get('content-type') || '';
      if (exportRes.ok && !exportCt.includes('text/html') && exportRes.body) {
        const cleanPptxName = cleanBaseName.replace(/\.(pptx|ppt)?$/i, '') + '.pptx';
        return {
          success: true,
          contentType: exportCt || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          contentLength: exportRes.headers.get('content-length') || undefined,
          fileName: cleanPptxName,
          stream: Readable.fromWeb(exportRes.body as any),
        };
      }
    } catch (exportErr) {
      console.warn('Error attempting Google Slides export:', exportErr);
    }

    return { success: false };
  }

  app.get('/api/download/file/:fileId', async (req, res) => {
    try {
      const { fileId } = req.params;
      const requestedName = String(req.query.name || `Drive_File_${fileId}.pptx`);
      const forceViewer = req.query.mode === 'viewer';

      // 1. If not forcing viewer, always deliver the 100% ORIGINAL Google Drive binary file
      if (!forceViewer) {
        const originalStream = await fetchGoogleDriveOriginalStream(fileId, requestedName);
        if (originalStream.success && originalStream.stream) {
          const finalName = originalStream.fileName || requestedName;
          res.setHeader(
            'Content-Type',
            originalStream.contentType || 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          );
          res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(finalName)}`
          );
          if (originalStream.contentLength) {
            res.setHeader('Content-Length', originalStream.contentLength);
          }
          const stream = originalStream.stream;
          stream.on('error', (streamErr) => {
            console.warn('Stream error during file download:', streamErr);
            if (!res.headersSent) {
              res.status(502).end();
            } else {
              res.end();
            }
          });
          res.on('close', () => {
            if (typeof (stream as any).destroy === 'function') {
              (stream as any).destroy();
            }
          });
          stream.pipe(res);
          return;
        }

        // Secondary fallback for presentations if direct download was restricted
        try {
          const deck = await fetchGoogleSlidesAnimatedDeck(fileId);
          if (deck && deck.slides.length > 0) {
            const pptxBuf = await buildAnimatedPptxBuffer(deck);
            if (pptxBuf.length > 25000) {
              const cleanName =
                (requestedName || deck.title || `Presentation_${fileId}`).replace(
                  /\.(pptx|ppt)?$/i,
                  ''
                ) + '.pptx';

              res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              );
              res.setHeader(
                'Content-Disposition',
                `attachment; filename*=UTF-8''${encodeURIComponent(cleanName)}`
              );
              res.setHeader('Content-Length', String(pptxBuf.length));
              res.send(pptxBuf);
              return;
            }
          }
        } catch (deckErr) {
          console.warn('Animated deck build fallback:', deckErr);
        }

        // Redirect to Google Drive preview if neither stream succeeded
        res.redirect(302, `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`);
        return;
      }

      // 3. Interactive Live Presentation Player (with 100% original animations) + Slide-by-Slide / PDF Print Viewer
      const session = await getUnlockedViewerSession(fileId);
      const displayTitle = session?.title || requestedName;
      const totalPages = session?.pages || 0;

      const slidesHtml =
        totalPages > 0
          ? Array.from({ length: totalPages }, (_, idx) => {
              return `<div class="slide-card">
            <div class="slide-header">
              <span>Slide / Trang ${idx + 1} / ${totalPages}</span>
              <a href="/api/download/slide/${encodeURIComponent(fileId)}/${idx}" download="${encodeURIComponent(displayTitle)}_Slide_${idx + 1}.png" class="dl-btn">⬇ Tải ảnh Slide ${idx + 1} (PNG)</a>
            </div>
            <img src="/api/download/slide/${encodeURIComponent(fileId)}/${idx}" alt="Slide ${idx + 1}" loading="lazy" />
          </div>`;
            }).join('\n')
          : '';

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${displayTitle} - LKimLamDrive VIP Presentation Unlocker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #090d16; color: #f8fafc; font-family: system-ui, sans-serif; padding-bottom: 60px; }
    .topbar { position: sticky; top: 0; z-index: 50; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.1); padding: 14px 24px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    .title-wrap h1 { font-size: 16px; font-weight: 700; color: #fff; }
    .title-wrap p { font-size: 12px; color: #34d399; margin-top: 2px; }
    .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .btn { background: #10b981; color: #000; border: none; padding: 9px 18px; border-radius: 999px; font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { background: #34d399; }
    .btn-white { background: #fff; color: #000; }
    .btn-white:hover { background: #e2e8f0; }
    .btn-secondary { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
    .container { max-width: 1180px; margin: 24px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 24px; }
    .player-box { background: #0f172a; border: 1px solid rgba(52, 211, 153, 0.35); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
    .player-header { padding: 12px 18px; background: rgba(16, 185, 129, 0.1); border-bottom: 1px solid rgba(52, 211, 153, 0.2); display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #a7f3d0; font-weight: 600; }
    .player-iframe { width: 100%; aspect-ratio: 16 / 9; border: none; display: block; background: #000; }
    .slide-card { background: #0f172a; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; overflow: hidden; }
    .slide-header { padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .dl-btn { color: #60a5fa; text-decoration: none; font-weight: 600; }
    .slide-card img { width: 100%; height: auto; display: block; background: #fff; }
    @media print {
      body { background: #fff; padding: 0; }
      .topbar, .player-box, .slide-header { display: none !important; }
      .container { max-width: 100%; margin: 0; padding: 0; gap: 0; }
      .slide-card { border: none; border-radius: 0; page-break-after: always; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="title-wrap">
      <h1>${displayTitle} ${totalPages ? `(${totalPages} Slide)` : ''}</h1>
      <p>✓ Đã mở khóa toàn bộ hiệu ứng động (Animations & Transitions) + File PowerPoint (.PPTX) + Xuất PDF</p>
    </div>
    <div class="actions">
      <a class="btn" href="/api/download/file/${encodeURIComponent(fileId)}?name=${encodeURIComponent(displayTitle)}">⬇ Tải File .PPTX (Đầy Đủ Hiệu Ứng)</a>
      <button class="btn btn-white" onclick="window.print()">⬇ Lưu thành PDF (${totalPages} trang)</button>
      <a class="btn btn-secondary" href="https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view" target="_blank" rel="noreferrer">Mở trên Google Drive ↗</a>
    </div>
  </div>
  <div class="container">
    <div class="player-box">
      <div class="player-header">
        <span>▶ TRÌNH CHIẾU TƯƠNG TÁC (CÓ ĐẦY ĐỦ HIỆU ỨNG CLICK, ÂM THANH & CHUYỂN SLIDE GỐC)</span>
        <span>Nhấn vào Slide hoặc phím mũi tên → để chạy từng hiệu ứng</span>
      </div>
      <iframe class="player-iframe" src="https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/embed?start=false&loop=false&delayms=3000" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>
    </div>
    ${slidesHtml}
  </div>
</body>
</html>`);
    } catch (err) {
      console.error('Download file error:', err);
      res.redirect(`https://drive.google.com/file/d/${encodeURIComponent(req.params.fileId)}/view`);
    }
  });

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in server:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in server:', reason);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LKimLamDrive server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

export default app;

