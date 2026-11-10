import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';
import { parseDriveUrl, DriveFileItem } from './src/utils/systemRules';
import {
  fetchRealDriveFolder,
  fetchRealSingleDriveFile,
} from './src/utils/driveScraper';
import {
  fetchGoogleSlidesAnimatedDeck,
  buildAnimatedPptxBuffer,
} from './src/utils/pptxAnimator';
import {
  DdosConfig,
  DEFAULT_DDOS_CONFIG,
  DdosSecurityEvent,
  IpReputationRecord,
  inspectWafRequest,
  evaluateRateLimitDecision,
} from './src/utils/ddosProtection';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
// Gmail OTP Verification & Password Recovery State
// ============================================================================
interface OtpSession {
  email: string;
  username: string;
  code: string;
  purpose: 'register' | 'reset-password';
  expiresAt: number;
  verified: boolean;
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
const sentEmailsOutbox: SentEmailRecord[] = [];
let runtimeSmtpConfig = {
  smtpEmail: process.env.GMAIL_USER || '',
  smtpAppPassword: process.env.GMAIL_APP_PASSWORD || '',
};

async function dispatchGmailVerificationEmail(params: {
  to: string;
  username: string;
  code: string;
  purpose: 'register' | 'reset-password';
}): Promise<{ sentViaSmtp: boolean; previewRecord: SentEmailRecord }> {
  const isRegister = params.purpose === 'register';
  const subject = isRegister
    ? `[LKimLamDrive] Mã xác thực đăng ký tài khoản: ${params.code}`
    : `[LKimLamDrive] Mã khôi phục mật khẩu của bạn: ${params.code}`;

  const htmlPreview = `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 28px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.12);">
      <h2 style="margin: 0 0 8px; color: #ffffff;">LKIMLAMDRIVE VIP SYSTEM</h2>
      <p style="color: #94a3b8; font-size: 14px; margin-bottom: 20px;">
        Xin chào <strong>${params.username || params.to}</strong>,
      </p>
      <p style="color: #e2e8f0; font-size: 14px; line-height: 1.6;">
        ${
          isRegister
            ? 'Cảm ơn bạn đã đăng ký tài khoản tại <strong>LKimLamDrive</strong>. Vui lòng nhập mã xác nhận gồm 6 chữ số bên dưới để kích hoạt tài khoản và bảo vệ quyền khôi phục mật khẩu:'
            : 'Chúng tôi nhận được yêu cầu khôi phục mật khẩu cho tài khoản liên kết với Gmail này. Vui lòng sử dụng mã OTP 6 chữ số bên dưới để đặt lại mật khẩu mới:'
        }
      </p>
      <div style="margin: 24px 0; padding: 18px; background: rgba(93, 69, 245, 0.18); border: 1px dashed #818cf8; border-radius: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #a5b4fc; margin-bottom: 6px;">MÃ XÁC NHẬN GMAIL (OTP)</div>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #ffffff; font-family: monospace;">${params.code}</div>
      </div>
      <p style="color: #64748b; font-size: 12px;">Mã xác thực có hiệu lực trong vòng 10 phút. Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.</p>
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
      console.warn('SMTP send fallback to local outbox:', err);
    }
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
const PORT = 3000;

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
      const { email, username, smtpEmail, smtpAppPassword, clientOtpCode } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanUsername = String(username || '').trim();

      if (!cleanEmail || !cleanEmail.includes('@')) {
        res.status(400).json({ error: 'Địa chỉ Gmail không hợp lệ' });
        return;
      }

      if (smtpEmail && smtpAppPassword) {
        runtimeSmtpConfig = { smtpEmail: String(smtpEmail), smtpAppPassword: String(smtpAppPassword) };
      }

      const code =
        typeof clientOtpCode === 'string' && /^\d{6}$/.test(clientOtpCode)
          ? clientOtpCode
          : String(Math.floor(100000 + Math.random() * 900000));

      otpStore.set(`register:${cleanEmail}`, {
        email: cleanEmail,
        username: cleanUsername || cleanEmail.split('@')[0],
        code,
        purpose: 'register',
        expiresAt: Date.now() + 10 * 60 * 1000,
        verified: false,
      });

      const mailRes = await dispatchGmailVerificationEmail({
        to: cleanEmail,
        username: cleanUsername,
        code,
        purpose: 'register',
      });

      res.json({
        success: true,
        sentViaSmtp: mailRes.sentViaSmtp,
        email: cleanEmail,
        demoOtpCode: code,
        message: mailRes.sentViaSmtp
          ? `Đã gửi mã xác nhận 6 số tới hộp thư Gmail ${cleanEmail}.`
          : `Đã phát hành email xác nhận tới ${cleanEmail} (Mã OTP: ${code}).`,
      });
    } catch (err) {
      console.error('send-verification error:', err);
      res.status(500).json({ error: 'Không thể gửi email xác thực' });
    }
  });

  app.post('/api/auth/verify-otp', (req, res) => {
    const { email, code, purpose = 'register', expectedCode } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();
    const key = `${purpose}:${cleanEmail}`;

    const session = otpStore.get(key);
    if (!session) {
      // Stateless Serverless fallback (e.g. when Vercel routes verify-otp to a different instance)
      if (typeof expectedCode === 'string' && /^\d{6}$/.test(expectedCode) && cleanCode === expectedCode) {
        res.json({
          success: true,
          email: cleanEmail,
          message: 'Xác thực Gmail thành công!',
        });
        return;
      }
      res.status(400).json({ error: 'Không tìm thấy yêu cầu xác thực hoặc mã đã hết hạn. Vui lòng gửi lại mã.' });
      return;
    }
    if (Date.now() > session.expiresAt) {
      otpStore.delete(key);
      res.status(400).json({ error: 'Mã xác thực OTP đã hết hạn (quá 10 phút). Vui lòng yêu cầu mã mới.' });
      return;
    }
    if (session.code !== cleanCode) {
      res.status(400).json({ error: 'Mã xác nhận OTP không chính xác. Vui lòng kiểm tra lại hộp thư Gmail.' });
      return;
    }

    session.verified = true;
    otpStore.set(key, session);
    res.json({
      success: true,
      email: cleanEmail,
      message: 'Xác thực Gmail thành công!',
    });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email, username, smtpEmail, smtpAppPassword, clientOtpCode } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        res.status(400).json({ error: 'Vui lòng nhập đúng địa chỉ Gmail đã đăng ký' });
        return;
      }

      if (smtpEmail && smtpAppPassword) {
        runtimeSmtpConfig = { smtpEmail: String(smtpEmail), smtpAppPassword: String(smtpAppPassword) };
      }

      const code =
        typeof clientOtpCode === 'string' && /^\d{6}$/.test(clientOtpCode)
          ? clientOtpCode
          : String(Math.floor(100000 + Math.random() * 900000));

      otpStore.set(`reset-password:${cleanEmail}`, {
        email: cleanEmail,
        username: String(username || cleanEmail.split('@')[0]),
        code,
        purpose: 'reset-password',
        expiresAt: Date.now() + 10 * 60 * 1000,
        verified: false,
      });

      const mailRes = await dispatchGmailVerificationEmail({
        to: cleanEmail,
        username: String(username || cleanEmail.split('@')[0]),
        code,
        purpose: 'reset-password',
      });

      res.json({
        success: true,
        sentViaSmtp: mailRes.sentViaSmtp,
        email: cleanEmail,
        demoOtpCode: code,
        message: mailRes.sentViaSmtp
          ? `Đã gửi mã khôi phục mật khẩu 6 số tới Gmail ${cleanEmail}.`
          : `Đã gửi mã khôi phục mật khẩu tới ${cleanEmail} (Mã OTP: ${code}).`,
      });
    } catch (err) {
      console.error('forgot-password error:', err);
      res.status(500).json({ error: 'Không thể gửi mã khôi phục mật khẩu' });
    }
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
      } = req.body || {};

      const parsed = parseDriveUrl(String(driveUrl || ''));
      if (!parsed.isValid) {
        res.status(400).json({
          error: 'Link Google Drive không hợp lệ. Vui lòng dán đúng link File hoặc Thư mục Google Drive.',
        });
        return;
      }

      if (parsed.type === 'folder') {
        const folderData = await fetchRealDriveFolder(
          parsed.resourceId,
          Number(costPerSingleFileCredit) || 1,
          Number(costPerGbCredit) || 1
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
      } = req.body || {};

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
          Number(costPerGbCredit) || 1
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

  app.get('/api/download/file/:fileId', async (req, res) => {
    try {
      const { fileId } = req.params;
      const requestedName = String(req.query.name || `Drive_File_${fileId}.pptx`);
      const forceViewer = req.query.mode === 'viewer';

      // 1. If not forcing viewer, try direct binary download from Google Drive first
      if (!forceViewer) {
        const directUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
        const directRes = await fetch(directUrl, {
          headers: { 'User-Agent': CHROME_UA },
        });

        const contentType = directRes.headers.get('content-type') || '';

        if (directRes.ok && !contentType.includes('text/html')) {
          res.setHeader('Content-Type', contentType || 'application/octet-stream');
          const cd = directRes.headers.get('content-disposition');
          if (cd) {
            res.setHeader('Content-Disposition', cd);
          } else {
            res.setHeader(
              'Content-Disposition',
              `attachment; filename*=UTF-8''${encodeURIComponent(requestedName)}`
            );
          }
          const cl = directRes.headers.get('content-length');
          if (cl) res.setHeader('Content-Length', cl);

          const buf = await directRes.arrayBuffer();
          res.send(Buffer.from(buf));
          return;
        }

        // 2. If direct download is blocked by owner ("Sorry, the owner hasn't given you permission to download"),
        // reconstruct the full OpenXML .PPTX with all vector layers, images, slide transitions, and click-by-click animations!
        const cachedPptx = pptxBufferCache.get(fileId);
        if (cachedPptx && cachedPptx.expiresAt > Date.now()) {
          res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          );
          res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(cachedPptx.filename)}`
          );
          res.setHeader('Content-Length', String(cachedPptx.buffer.length));
          res.send(cachedPptx.buffer);
          return;
        }

        const deck = await fetchGoogleSlidesAnimatedDeck(fileId);
        if (deck && deck.slides.length > 0) {
          const pptxBuf = await buildAnimatedPptxBuffer(deck);
          const cleanName = (requestedName || deck.title || `Presentation_${fileId}`).replace(
            /\.(pptx|ppt)?$/i,
            ''
          ) + '.pptx';

          pptxBufferCache.set(fileId, {
            buffer: pptxBuf,
            filename: cleanName,
            expiresAt: Date.now() + 15 * 60 * 1000,
          });

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

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
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

if (!process.env.VERCEL) {
  startServer();
}

export default app;

