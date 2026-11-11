import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  KeyRound,
  Mail,
  Eye,
  EyeOff,
  AlertOctagon,
  ArrowLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Terminal,
} from 'lucide-react';
import { useAppStore } from '../context/AppContext';
import { AdminView } from './AdminView';
import { AppRoute } from './HomeView';
import {
  MASTER_ADMIN_EMAIL,
  STEALTH_KNOCK_REQUIRED_CLICKS,
  MAX_ADMIN_LOGIN_ATTEMPTS,
  ADMIN_LOCKOUT_DURATION_MS,
  isAuthorizedAdminEmail,
  evaluateAdminBruteForceStatus,
} from '../utils/systemRules';

interface AdminCamouflageGuardProps {
  onNavigate: (route: AppRoute) => void;
}

type GuardMode = 'camouflaged' | 'admin_login' | 'forgot_password';

export const AdminCamouflageGuard: React.FC<AdminCamouflageGuardProps> = ({ onNavigate }) => {
  const { currentUser, login, resetPasswordByEmail, logout, users } = useAppStore();

  const [mode, setMode] = useState<GuardMode>('camouflaged');
  const [stealthKnockClicks, setStealthKnockClicks] = useState(0);
  const [knockNotice, setKnockNotice] = useState(false);

  // Admin Login Form State
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [botTrap, setBotTrap] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(() => {
    return Number(sessionStorage.getItem('lkld_admin_failed_count') || 0);
  });
  const [lockoutUntilMs, setLockoutUntilMs] = useState(() => {
    return Number(sessionStorage.getItem('lkld_admin_lockout_until') || 0);
  });
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Dynamic Math Challenge (anti-bot & anti-bruteforce)
  const [mathNum1, setMathNum1] = useState(12);
  const [mathNum2, setMathNum2] = useState(17);
  const [mathAnswer, setMathAnswer] = useState('');

  // Admin Identity Verification & Forgot Password State
  const [recoveryStep, setRecoveryStep] = useState<'email' | 'otp' | 'new_password'>('email');
  const [recoveryEmail, setRecoveryEmail] = useState(MASTER_ADMIN_EMAIL);
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryOtpToken, setRecoveryOtpToken] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [recoverySuccessMsg, setRecoverySuccessMsg] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const knockResetTimerRef = useRef<number | null>(null);

  // Play subtle Web Audio feedback for tactile stealth clicks
  const playAudioFeedback = (freq: number, duration: number) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // ignore audio context restrictions
    }
  };

  const generateNewMathChallenge = () => {
    const n1 = Math.floor(10 + Math.random() * 40);
    const n2 = Math.floor(5 + Math.random() * 30);
    setMathNum1(n1);
    setMathNum2(n2);
    setMathAnswer('');
  };

  // Lockout Countdown Timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      if (lockoutUntilMs > now) {
        setSecondsRemaining(Math.ceil((lockoutUntilMs - now) / 1000));
      } else {
        setSecondsRemaining(0);
      }
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, [lockoutUntilMs]);

  // Resend OTP Cooldown Timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = window.setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [resendCooldown]);

  // Secret 10-Click Knock Handler on 404 Header
  const handleStealthKnock = () => {
    const next = stealthKnockClicks + 1;
    setStealthKnockClicks(next);

    if (knockResetTimerRef.current) {
      window.clearTimeout(knockResetTimerRef.current);
    }
    // Reset click counter if inactive for 8 seconds
    knockResetTimerRef.current = window.setTimeout(() => {
      setStealthKnockClicks(0);
      setKnockNotice(false);
    }, 8000);

    if (next < STEALTH_KNOCK_REQUIRED_CLICKS) {
      playAudioFeedback(260 + next * 45, 0.04);
      if (next >= 4) {
        setKnockNotice(true);
      }
    } else {
      // 10th click: Trigger Master Admin Door Unlock
      playAudioFeedback(880, 0.3);
      setStealthKnockClicks(0);
      setKnockNotice(false);
      setMode('admin_login');
      generateNewMathChallenge();
    }
  };

  // Admin Login Handler with Multi-Layer Anti-Brute-Force & Honeypot
  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const now = Date.now();
    if (lockoutUntilMs > now) {
      setLoginError(`[Chống Brute-Force] Cổng Quản Trị đang bị tạm khóa. Vui lòng đợi ${secondsRemaining}s.`);
      return;
    }

    // Layer 1: Honeypot Bot Trap Check
    if (botTrap.trim().length > 0) {
      const penaltyLock = now + ADMIN_LOCKOUT_DURATION_MS;
      setLockoutUntilMs(penaltyLock);
      sessionStorage.setItem('lkld_admin_lockout_until', String(penaltyLock));
      setLoginError('[An Ninh Cảnh Báo] Phát hiện bot tự động dò mật khẩu! Cổng Quản Trị đã bị khóa 15 phút.');
      return;
    }

    // Layer 2: Math Challenge Check if attempts >= 3
    if (failedAttempts >= 3) {
      const expected = mathNum1 + mathNum2;
      if (parseInt(mathAnswer.trim(), 10) !== expected) {
        setLoginError('Câu hỏi bảo mật xác thực (CAPTCHA) không chính xác.');
        generateNewMathChallenge();
        return;
      }
    }

    setLoginLoading(true);

    // Layer 3: Constant-Time Delay (750ms) to defeat timing attacks
    await new Promise((resolve) => setTimeout(resolve, 750));

    try {
      const result = login(username, password);

      if (!result.success || result.user?.role !== 'admin') {
        // Increment brute-force failure tracker
        const newFailed = failedAttempts + 1;
        setFailedAttempts(newFailed);
        sessionStorage.setItem('lkld_admin_failed_count', String(newFailed));

        if (newFailed >= MAX_ADMIN_LOGIN_ATTEMPTS) {
          const lockTime = now + ADMIN_LOCKOUT_DURATION_MS;
          setLockoutUntilMs(lockTime);
          sessionStorage.setItem('lkld_admin_lockout_until', String(lockTime));
          setLoginError(
            `[Cảnh Báo An Ninh Tối Cao] Bạn đã nhập sai mật khẩu Quản Trị ${MAX_ADMIN_LOGIN_ATTEMPTS} lần liên tiếp! Cổng Admin đã bị khóa trong 15 phút.`
          );
        } else {
          const remaining = MAX_ADMIN_LOGIN_ATTEMPTS - newFailed;
          setLoginError(
            `Thông tin đăng nhập Quản Trị Viên không chính xác! Cảnh báo chống Brute-Force: Bạn còn ${remaining} lần thử.`
          );
          if (newFailed >= 3) {
            generateNewMathChallenge();
          }
        }
        setLoginLoading(false);
        return;
      }

      // Success: Clear brute force records
      setFailedAttempts(0);
      sessionStorage.removeItem('lkld_admin_failed_count');
      sessionStorage.removeItem('lkld_admin_lockout_until');
      setLoginLoading(false);
    } catch {
      setLoginLoading(false);
      setLoginError('Lỗi kiểm tra thông tin đăng nhập Quản Trị.');
    }
  };

  // Admin Forgot Password Request (Only lekimlam2707@gmail.com accepted)
  const handleSendAdminRecoveryOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoverySuccessMsg('');

    const cleanEmail = recoveryEmail.trim().toLowerCase();

    // STRICT SOLE AUTHORIZED ADMIN EMAIL VALIDATION
    if (!isAuthorizedAdminEmail(cleanEmail)) {
      setRecoveryError(
        `⛔ TỪ CHỐI XÁC MINH: Chỉ duy nhất địa chỉ Gmail Quản Trị Viên Tối Cao (${MASTER_ADMIN_EMAIL}) mới có quyền khôi phục quyền Admin! Mọi email khác đều bị chặn.`
      );
      return;
    }

    setRecoveryLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: MASTER_ADMIN_EMAIL,
          username: 'admin',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể gửi email xác minh tới Gmail quản trị.');
      }

      setRecoveryOtpToken(data.otpToken || '');
      setRecoverySuccessMsg(
        `✓ Đã gửi thư xác minh danh tính & Mã OTP 6 số tới hộp thư Gmail ${MASTER_ADMIN_EMAIL}. Vui lòng mở Gmail để kiểm tra.`
      );
      setResendCooldown(60);
      setRecoveryStep('otp');
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Lỗi gửi email xác thực');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Verify OTP and Update Admin Password
  const handleVerifyOtpAndResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoverySuccessMsg('');

    const cleanOtp = recoveryOtp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setRecoveryError('Vui lòng nhập đúng mã OTP 6 số từ hộp thư Gmail.');
      return;
    }

    if (recoveryStep === 'otp') {
      setRecoveryLoading(true);
      try {
        const verifyRes = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: MASTER_ADMIN_EMAIL,
            code: cleanOtp,
            purpose: 'reset-password',
            otpToken: recoveryOtpToken,
          }),
        });

        const verifyData = await verifyRes.json();
        if (!verifyRes.ok) {
          throw new Error(verifyData.error || 'Mã OTP không chính xác.');
        }

        setRecoverySuccessMsg('✓ Xác thực mã OTP Gmail thành công! Vui lòng nhập mật khẩu Quản Trị mới.');
        setRecoveryStep('new_password');
      } catch (err) {
        setRecoveryError(err instanceof Error ? err.message : 'Xác thực mã OTP thất bại');
      } finally {
        setRecoveryLoading(false);
      }
      return;
    }

    // Step: new_password
    if (!recoveryNewPassword || recoveryNewPassword.length < 6) {
      setRecoveryError('Mật khẩu quản trị mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setRecoveryError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setRecoveryLoading(true);
    try {
      // 1. Update in local/firestore users store
      const res = resetPasswordByEmail(MASTER_ADMIN_EMAIL, recoveryNewPassword);
      if (!res.success) {
        throw new Error(res.error || 'Không thể cập nhật mật khẩu');
      }

      // 2. Automatically log in as Admin with the new password
      const loginRes = login(MASTER_ADMIN_EMAIL, recoveryNewPassword);
      if (!loginRes.success) {
        login('admin', recoveryNewPassword);
      }

      // 3. Clear brute force lockouts and state
      setFailedAttempts(0);
      sessionStorage.removeItem('lkld_admin_failed_count');
      sessionStorage.removeItem('lkld_admin_lockout_until');

      setRecoverySuccessMsg('✓ Đã khôi phục và thiết lập mật khẩu Quản Trị thành công! Đang chuyển vào trang Quản Trị...');
      window.setTimeout(() => {
        setMode('admin_login');
      }, 1000);
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Lỗi cập nhật mật khẩu.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // If already authenticated as Admin, render Admin Dashboard directly!
  if (currentUser?.role === 'admin') {
    return (
      <div className="relative">
        {/* Floating Quick Camouflage Action for Admin */}
        <div className="fixed bottom-4 right-4 z-50">
          <button
            type="button"
            onClick={() => {
              logout();
              setMode('camouflaged');
              setStealthKnockClicks(0);
            }}
            title="Đóng phiên & Ngụy trang lại thành 404"
            className="px-3.5 py-2 rounded-xl bg-slate-900/90 border border-red-500/30 hover:border-red-500 text-red-400 text-xs font-semibold backdrop-blur-md shadow-2xl flex items-center gap-2 transition-all cursor-pointer hover:scale-105"
          >
            <Lock className="h-4 w-4" />
            <span>Khóa & Ngụy trang 404</span>
          </button>
        </div>
        <AdminView onNavigate={onNavigate} />
      </div>
    );
  }

  // ==========================================================================
  // VIEW 1: Ultra-Realistic 404 Not Found Camouflage
  // ==========================================================================
  if (mode === 'camouflaged') {
    return (
      <main className="min-h-screen w-full bg-[#0a0d14] text-slate-400 font-mono flex flex-col justify-center items-center p-6 select-none relative overflow-hidden">
        {/* Ambient subtle noise */}
        <div className="absolute inset-0 bg-radial from-slate-900/40 via-transparent to-black pointer-events-none" />

        <div className="max-w-lg w-full text-center relative z-10 flex flex-col items-center">
          {/* Secret 10-Click Target: Clicking 404 unlocks Admin Portal */}
          <div
            onClick={handleStealthKnock}
            className="cursor-pointer transition-transform active:scale-95 group mb-4 p-4 rounded-2xl hover:bg-white/[0.02]"
            aria-label="404 Error Header"
          >
            <h1 className="text-8xl sm:text-9xl font-black tracking-widest text-slate-800 group-hover:text-slate-700 transition-colors select-none">
              404
            </h1>
            <p className="text-xl sm:text-2xl font-bold text-slate-500 mt-2 tracking-wide uppercase">
              Not Found
            </p>
          </div>

          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            The requested URL <code className="text-slate-300 bg-slate-950 px-2 py-1 rounded">/admin</code> was not found on this server.
          </p>

          {/* Technical realistic server signature */}
          <div className="w-full border-t border-slate-800/80 pt-6 text-xs text-slate-500 space-y-1">
            <p>nginx/1.24.0 (Ubuntu) — Host: lkimlamdrive.vn</p>
            <p className="text-[11px] text-slate-600">Error Code: ERR_HTTP_RESOURCE_NOT_FOUND (0x80004005)</p>
            <p className="text-[11px] text-slate-600">Time: {new Date().toISOString()}</p>
          </div>

          {/* Regular Home button */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="px-6 py-2.5 rounded-full bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-300 text-xs font-semibold transition-all hover:text-white cursor-pointer shadow-lg"
            >
              ← Quay về trang chủ LKimLamDrive
            </button>

            {/* Hidden Knocking Sequence Progress Hint (only shows faintly after 4 clicks) */}
            {knockNotice && (
              <div className="text-[11px] text-amber-500/60 tracking-widest uppercase flex items-center gap-1.5 animate-pulse mt-2">
                <Terminal className="h-3 w-3" />
                <span>Security Sequence: {stealthKnockClicks}/{STEALTH_KNOCK_REQUIRED_CLICKS} Knocks</span>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ==========================================================================
  // VIEW 2: Master Admin Cyber Login Form (Anti-Brute-Force & Anti-Bot Protected)
  // ==========================================================================
  if (mode === 'admin_login') {
    const isLocked = secondsRemaining > 0;

    return (
      <main className="min-h-screen w-full bg-slate-950 text-white flex flex-col justify-center items-center p-4 sm:p-6 relative">
        <div className="w-full max-w-md rounded-3xl bg-slate-900/90 border border-amber-500/30 p-6 sm:p-8 shadow-2xl relative backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
          {/* Top Bar Actions */}
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('camouflaged');
                setStealthKnockClicks(0);
              }}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Ngụy trang lại 404</span>
            </button>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300">
              Cổng Bảo Mật Cấp 5
            </span>
          </div>

          <div className="flex items-center gap-4 mb-6">
            <div className="h-14 w-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-lg shadow-amber-500/10">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-wide">
                QUẢN TRỊ VIÊN TỐI CAO
              </h2>
              <p className="text-xs text-amber-300/80">
                Phân hệ Master Root & Giám sát An ninh
              </p>
            </div>
          </div>

          {/* Brute-force Lockout Banner */}
          {isLocked && (
            <div className="mb-5 p-3.5 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-center gap-2.5">
              <AlertOctagon className="h-5 w-5 text-red-400 shrink-0" />
              <div>
                <p className="font-bold text-red-100">Cổng Quản Trị Tạm Khóa An Ninh</p>
                <p className="text-red-300">Vui lòng đợi <strong>{secondsRemaining}s</strong> do nhập sai quá số lần quy định.</p>
              </div>
            </div>
          )}

          {loginError && !isLocked && (
            <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-xs flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLoginSubmit} className="space-y-4">
            {/* Honeypot hidden input against automated bots */}
            <input
              type="text"
              name="admin_bot_trap_token"
              className="hidden opacity-0 absolute -z-50"
              tabIndex={-1}
              autoComplete="off"
              value={botTrap}
              onChange={(e) => setBotTrap(e.target.value)}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Tài khoản hoặc Gmail Quản Trị
              </label>
              <input
                type="text"
                required
                disabled={isLocked || loginLoading}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin hoặc lekimlam2707@gmail.com"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-white/10 text-white text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/30 transition-all disabled:opacity-50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Mật khẩu Quản Trị Viên
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot_password');
                    setRecoveryStep('email');
                    setRecoveryError('');
                  }}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                >
                  Quên mật khẩu?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  disabled={isLocked || loginLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu quản trị..."
                  className="w-full px-4 py-3 pr-11 rounded-xl bg-slate-950 border border-white/10 text-white text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/30 transition-all disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Dynamic Math Challenge CAPTCHA after 3 failed attempts */}
            {failedAttempts >= 3 && !isLocked && (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs text-amber-300">
                  <span className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Xác minh bảo vệ chống Bot:
                  </span>
                  <button
                    type="button"
                    onClick={generateNewMathChallenge}
                    className="text-slate-400 hover:text-white"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm bg-slate-900 px-3 py-1.5 rounded-lg border border-white/10 text-white font-bold">
                    {mathNum1} + {mathNum2} = ?
                  </span>
                  <input
                    type="number"
                    required
                    value={mathAnswer}
                    onChange={(e) => setMathAnswer(e.target.value)}
                    placeholder="Kết quả"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLocked || loginLoading}
              className="w-full py-3.5 px-6 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-2"
            >
              {loginLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Đang xác thực an ninh...</span>
                </>
              ) : isLocked ? (
                <>
                  <Lock className="h-4 w-4" />
                  <span>Cổng Bị Tạm Khóa ({secondsRemaining}s)</span>
                </>
              ) : (
                <>
                  <Unlock className="h-4 w-4" />
                  <span>Xác Thực & Mở Bảng Quản Trị</span>
                </>
              )}
            </button>
          </form>

          {/* Quick verification bypass link for master admin email */}
          <div className="mt-6 pt-5 border-t border-white/10 text-center">
            <button
              type="button"
              onClick={() => {
                setMode('forgot_password');
                setRecoveryStep('email');
                setRecoveryError('');
              }}
              className="text-xs text-slate-400 hover:text-amber-300 transition-colors cursor-pointer flex items-center justify-center gap-1.5 mx-auto"
            >
              <KeyRound className="h-3.5 w-3.5 text-amber-400" />
              <span>Xác minh danh tính Master qua Gmail <strong>{MASTER_ADMIN_EMAIL}</strong></span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================================================
  // VIEW 3: Master Admin Exclusive Password Recovery via lekimlam2707@gmail.com
  // ==========================================================================
  return (
    <main className="min-h-screen w-full bg-slate-950 text-white flex flex-col justify-center items-center p-4 sm:p-6 relative">
      <div className="w-full max-w-md rounded-3xl bg-slate-900/90 border border-amber-500/30 p-6 sm:p-8 shadow-2xl relative backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <button
            type="button"
            onClick={() => setMode('admin_login')}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Quay lại Đăng nhập</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('camouflaged');
              setStealthKnockClicks(0);
            }}
            className="text-xs text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
          >
            Ngụy trang 404
          </button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="h-14 w-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-lg shadow-amber-500/10">
            <Mail className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white tracking-wide">
              XÁC MINH DANH TÍNH MASTER
            </h2>
            <p className="text-xs text-amber-300/80">
              Khôi phục quyền Quản Trị Viên tối cao
            </p>
          </div>
        </div>

        {/* Sole Authorized Email Policy Notice */}
        <div className="mb-5 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs">
          <p className="font-bold text-amber-100 flex items-center gap-1.5 mb-1">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Chính Sách Bảo Mật Duy Nhất:
          </p>
          <p className="text-amber-200/80 leading-relaxed">
            Hệ thống <strong>CHỈ</strong> chấp nhận duy nhất địa chỉ Gmail{' '}
            <strong className="text-white underline">{MASTER_ADMIN_EMAIL}</strong> để xác minh danh tính và khôi phục quyền Admin.
          </p>
        </div>

        {recoveryError && (
          <div className="mb-5 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{recoveryError}</span>
          </div>
        )}

        {recoverySuccessMsg && (
          <div className="mb-5 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{recoverySuccessMsg}</span>
          </div>
        )}

        {/* STEP 1: Enter lekimlam2707@gmail.com */}
        {recoveryStep === 'email' && (
          <form onSubmit={handleSendAdminRecoveryOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Địa chỉ Gmail Quản Trị Viên Tối Cao
              </label>
              <input
                type="email"
                required
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder={MASTER_ADMIN_EMAIL}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-white/10 text-white text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/30 transition-all font-mono"
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                Mã OTP 6 số sẽ được bắn trực tiếp vào hộp thư Gmail này.
              </p>
            </div>

            <button
              type="submit"
              disabled={recoveryLoading}
              className="w-full py-3.5 px-6 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {recoveryLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Đang kết nối & gửi thư OTP...</span>
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  <span>Bắn Mã OTP Vào Gmail Quản Trị</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* STEP 2 & 3: Enter OTP and Reset Password */}
        {(recoveryStep === 'otp' || recoveryStep === 'new_password') && (
          <form onSubmit={handleVerifyOtpAndResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Nhập Mã OTP 6 Số từ Gmail ({MASTER_ADMIN_EMAIL})
              </label>
              <input
                type="text"
                maxLength={6}
                required
                disabled={recoveryStep === 'new_password'}
                value={recoveryOtp}
                onChange={(e) => setRecoveryOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-amber-400/40 text-center text-white text-2xl font-mono tracking-widest focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 transition-all"
              />
              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="text-slate-500">Mã có hiệu lực trong 10 phút</span>
                {resendCooldown > 0 ? (
                  <span className="text-slate-400">Gửi lại sau {resendCooldown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendAdminRecoveryOtp}
                    className="text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    Gửi lại mã OTP
                  </button>
                )}
              </div>
            </div>

            {recoveryStep === 'new_password' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Mật khẩu Quản Trị mới (tối thiểu 6 ký tự)
                  </label>
                  <input
                    type="password"
                    required
                    value={recoveryNewPassword}
                    onChange={(e) => setRecoveryNewPassword(e.target.value)}
                    placeholder="Mật khẩu mới..."
                    className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-white/10 text-white text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Xác nhận mật khẩu mới
                  </label>
                  <input
                    type="password"
                    required
                    value={recoveryConfirmPassword}
                    onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới..."
                    className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-white/10 text-white text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={recoveryLoading}
              className="w-full py-3.5 px-6 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {recoveryLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Đang xử lý...</span>
                </>
              ) : recoveryStep === 'otp' ? (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>Xác Thực Mã OTP 6 Số</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Cập Nhật Mật Khẩu & Mở Bảng Quản Trị</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </main>
  );
};
