import React, { useState, useEffect } from 'react';
import {
  User,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Loader2,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';
import { AppRoute } from './HomeView';
import {
  sendFirebaseVerificationEmailToUser,
  sendFirebasePasswordResetToUser,
  checkFirebaseEmailVerified,
  verifyFirebaseEmailPasswordLogin,
  confirmFirebaseResetWithCodeOrLink,
  applyFirebaseVerifyWithCodeOrLink,
} from '../firebase';

interface AuthViewsProps {
  mode: 'login' | 'register';
  onNavigate: (route: AppRoute) => void;
}

type SubFlow =
  | 'form'
  | 'register-verify-otp'
  | 'forgot-request'
  | 'forgot-verify-reset';

const MAX_OTP_ATTEMPTS = 3;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SEC = 15 * 60;

export const AuthViews: React.FC<AuthViewsProps> = ({ mode, onNavigate }) => {
  const {
    config,
    users,
    login,
    loginWithGoogle,
    checkUserCanRegister,
    register,
    resetPasswordByEmail,
  } = useAppStore();

  const [subFlow, setSubFlow] = useState<SubFlow>('form');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');

  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [notRobot, setNotRobot] = useState(true);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [remainingOtpAttempts, setRemainingOtpAttempts] = useState<number>(MAX_OTP_ATTEMPTS);
  const [remainingLoginAttempts, setRemainingLoginAttempts] = useState<number>(MAX_LOGIN_ATTEMPTS);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);
  const [resendCooldownSec, setResendCooldownSec] = useState<number>(0);

  const isLogin = mode === 'login';

  useEffect(() => {
    if (lockoutSeconds <= 0 && resendCooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      setResendCooldownSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds, resendCooldownSec]);

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleGoogleSignIn = async () => {
    if (lockoutSeconds > 0) return;
    setError('');
    setSuccessMsg('');
    setGoogleLoading(true);
    try {
      const res = await loginWithGoogle();
      if (!res.success) {
        setError(res.error || 'Đăng nhập Google thất bại');
        return;
      }
      onNavigate('home');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (lockoutSeconds > 0) {
      setError(`Đang tạm khóa. Thử lại sau ${formatCountdown(lockoutSeconds)}.`);
      return;
    }

    if (isLogin) {
      setLoading(true);
      try {
        const cleanId = username.trim().toLowerCase();

        try {
          const checkResp = await fetch('/api/auth/login-guard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: cleanId, outcome: 'check' }),
          });
          if (checkResp.status === 429) {
            const checkData = await checkResp.json();
            const waitSec = Number(checkData.retryAfterSeconds) || LOCKOUT_DURATION_SEC;
            setLockoutSeconds(waitSec);
            setRemainingLoginAttempts(0);
            setError(`Tạm khóa ${formatCountdown(waitSec)} do sai quá ${MAX_LOGIN_ATTEMPTS} lần.`);
            return;
          }
        } catch {
          // continue
        }

        // Sync password if user reset it via Firebase Gmail link
        const matchedAccount = users.find(
          (u) => u.email.toLowerCase() === cleanId || u.username.toLowerCase() === cleanId
        );
        const loginEmail = cleanId.includes('@') ? cleanId : matchedAccount?.email || '';
        if (loginEmail) {
          const fbCheck = await verifyFirebaseEmailPasswordLogin(loginEmail, password);
          if (fbCheck.ok) {
            resetPasswordByEmail(loginEmail, password);
          }
        }

        const res = login(username, password);
        if (!res.success) {
          const nextRemaining = Math.max(0, remainingLoginAttempts - 1);
          setRemainingLoginAttempts(nextRemaining);

          try {
            const failResp = await fetch('/api/auth/login-guard', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ identifier: cleanId, outcome: 'failed' }),
            });
            const contentType = failResp.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const failData = await failResp.json();
              if (failResp.status === 429 || failData.lockedOut) {
                const waitSec = Number(failData.retryAfterSeconds) || LOCKOUT_DURATION_SEC;
                setLockoutSeconds(waitSec);
                setRemainingLoginAttempts(0);
                setError(`Sai mật khẩu ${MAX_LOGIN_ATTEMPTS} lần! Khóa 15 phút.`);
                return;
              }
              if (typeof failData.remainingAttempts === 'number') {
                setRemainingLoginAttempts(failData.remainingAttempts);
              }
            }
          } catch {
            // fallback
          }

          if (nextRemaining <= 0) {
            setLockoutSeconds(LOCKOUT_DURATION_SEC);
            setError(`Sai mật khẩu ${MAX_LOGIN_ATTEMPTS} lần! Khóa 15 phút.`);
            return;
          }

          setError(`Sai tài khoản hoặc mật khẩu (Còn ${nextRemaining}/${MAX_LOGIN_ATTEMPTS} lần thử)`);
          return;
        }

        setRemainingLoginAttempts(MAX_LOGIN_ATTEMPTS);
        fetch('/api/auth/login-guard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: cleanId, outcome: 'success' }),
        }).catch(() => {});

        onNavigate('home');
        return;
      } finally {
        setLoading(false);
      }
    }

    // Registration Step 1
    if (password.length < 6) {
      setError('Mật khẩu tối thiểu 6 ký tự');
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp');
      return;
    }
    if (!notRobot) {
      setError('Vui lòng xác nhận reCAPTCHA');
      return;
    }

    const canReg = checkUserCanRegister(username, email);
    if (!canReg.ok) {
      setError(canReg.error || 'Thông tin không hợp lệ');
      return;
    }

    if (resendCooldownSec > 0) {
      setError(`Đợi ${resendCooldownSec}s để gửi lại.`);
      return;
    }

    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();

    try {
      const fbMailPromise = sendFirebaseVerificationEmailToUser(cleanEmail, password);

      let serverLocked = false;
      try {
        const resp = await fetch('/api/auth/send-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            email: cleanEmail,
            smtpEmail: config.smtpEmail,
            smtpAppPassword: config.smtpAppPassword,
          }),
        });
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          if (resp.status === 429) {
            serverLocked = true;
            if (data.lockedOut && data.retryAfterSeconds) {
              setLockoutSeconds(Number(data.retryAfterSeconds));
              setRemainingOtpAttempts(0);
            } else if (data.cooldownSeconds) {
              setResendCooldownSec(Number(data.cooldownSeconds));
            }
            setError(data.error || 'Quá giới hạn yêu cầu.');
            return;
          }
          if (!resp.ok && data.error) {
            setError(data.error);
            return;
          }
          if (data.otpToken) {
            setOtpToken(String(data.otpToken));
          }
        }
      } catch {
        // continue
      }

      if (serverLocked) return;
      await fbMailPromise;

      setRemainingOtpAttempts(MAX_OTP_ATTEMPTS);
      setResendCooldownSec(60);
      setOtpCode('');
      setSubFlow('register-verify-otp');
      setSuccessMsg(`Đã gửi tới Gmail: ${cleanEmail}`);
    } finally {
      setLoading(false);
    }
  };

  const penalizeFailedOtpAttempt = (customMsg?: string) => {
    const nextRem = Math.max(0, remainingOtpAttempts - 1);
    setRemainingOtpAttempts(nextRem);
    if (nextRem <= 0) {
      setLockoutSeconds(LOCKOUT_DURATION_SEC);
      setOtpCode('');
      setError(`Sai quá ${MAX_OTP_ATTEMPTS} lần! Đã hủy mã & khóa 15 phút.`);
      return;
    }
    setError(`${customMsg || 'Mã hoặc trạng thái xác thực chưa đúng'} (Còn ${nextRem}/${MAX_OTP_ATTEMPTS} lần)`);
  };

  const handleCheckFirebaseGmailVerified = async () => {
    setError('');
    setSuccessMsg('');
    if (lockoutSeconds > 0) return;

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const status = await checkFirebaseEmailVerified(cleanEmail, password);
      if (!status.verified) {
        penalizeFailedOtpAttempt('Chưa nhấn link xác nhận trong Gmail');
        return;
      }

      const regRes = register(username, email, password);
      if (!regRes.success) {
        setError(regRes.error || 'Đăng ký thất bại');
        return;
      }
      onNavigate('home');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRegistrationOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (lockoutSeconds > 0) return;

    const rawInput = otpCode.trim();
    if (!rawInput) {
      setError('Vui lòng nhập mã hoặc dán link từ Gmail');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      // Support pasting Firebase verification link or oobCode from Gmail
      if (rawInput.length > 6) {
        const fbVerify = await applyFirebaseVerifyWithCodeOrLink(rawInput);
        if (fbVerify.ok) {
          const regRes = register(username, email, password);
          if (!regRes.success) {
            setError(regRes.error || 'Đăng ký thất bại');
            return;
          }
          onNavigate('home');
          return;
        }
        penalizeFailedOtpAttempt('Link / Mã xác thực không đúng');
        return;
      }

      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          code: rawInput,
          purpose: 'register',
          otpToken,
        }),
      });

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        penalizeFailedOtpAttempt('Mã không hợp lệ');
        return;
      }

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        if (resp.status === 429 || data.lockedOut) {
          const waitSec = Number(data.retryAfterSeconds) || LOCKOUT_DURATION_SEC;
          setLockoutSeconds(waitSec);
          setRemainingOtpAttempts(0);
          setOtpCode('');
          setError(`Sai quá ${MAX_OTP_ATTEMPTS} lần! Khóa 15 phút.`);
          return;
        }
        const nextRem =
          typeof data.remainingAttempts === 'number'
            ? data.remainingAttempts
            : Math.max(0, remainingOtpAttempts - 1);
        setRemainingOtpAttempts(nextRem);
        if (nextRem <= 0) setLockoutSeconds(LOCKOUT_DURATION_SEC);
        setError(`Mã không đúng (Còn ${nextRem}/${MAX_OTP_ATTEMPTS} lần)`);
        return;
      }

      const regRes = register(username, email, password);
      if (!regRes.success) {
        setError(regRes.error || 'Đăng ký thất bại');
        return;
      }
      onNavigate('home');
    } catch {
      setError('Lỗi kết nối xác thực');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (lockoutSeconds > 0 || resendCooldownSec > 0) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Gmail không hợp lệ');
      return;
    }

    const matchedUser = users.find((u) => u.email.toLowerCase() === cleanEmail);
    const resolvedUsername = matchedUser?.username || cleanEmail.split('@')[0];

    setLoading(true);
    try {
      const fbResetPromise = sendFirebasePasswordResetToUser(cleanEmail);

      try {
        const resp = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            username: resolvedUsername,
            smtpEmail: config.smtpEmail,
            smtpAppPassword: config.smtpAppPassword,
          }),
        });
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          if (resp.status === 429) {
            if (data.lockedOut && data.retryAfterSeconds) {
              setLockoutSeconds(Number(data.retryAfterSeconds));
              setRemainingOtpAttempts(0);
            } else if (data.cooldownSeconds) {
              setResendCooldownSec(Number(data.cooldownSeconds));
            }
            setError(data.error || 'Quá giới hạn yêu cầu.');
            return;
          }
          if (!resp.ok && data.error) {
            setError(data.error);
            return;
          }
          if (data.otpToken) {
            setOtpToken(String(data.otpToken));
          }
        }
      } catch {
        // continue
      }

      await fbResetPromise;

      setRemainingOtpAttempts(MAX_OTP_ATTEMPTS);
      setResendCooldownSec(60);
      setOtpCode('');
      setSubFlow('forgot-verify-reset');
      setSuccessMsg(`Đã gửi tới Gmail: ${cleanEmail}`);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (lockoutSeconds > 0) return;

    const rawInput = otpCode.trim();
    if (!rawInput) {
      setError('Vui lòng dán link / mã từ Gmail');
      return;
    }
    if (!newResetPassword || newResetPassword.length < 6) {
      setError('Mật khẩu mới tối thiểu 6 ký tự');
      return;
    }
    if (newResetPassword !== confirmResetPassword) {
      setError('Mật khẩu xác nhận không khớp');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      // 1. If user pasted the Firebase link or oobCode from Gmail (like in image_e622b7ca.png)
      if (rawInput.length > 6) {
        const fbConfirm = await confirmFirebaseResetWithCodeOrLink(rawInput, newResetPassword);
        if (!fbConfirm.ok) {
          penalizeFailedOtpAttempt('Link / Mã khôi phục không đúng hoặc đã hết hạn');
          return;
        }
        const targetEmail = (fbConfirm.email || cleanEmail).toLowerCase();
        resetPasswordByEmail(targetEmail, newResetPassword);
        setSuccessMsg('Đặt lại mật khẩu thành công!');
        setPassword(newResetPassword);
        window.setTimeout(() => {
          setSubFlow('form');
          onNavigate('login');
        }, 700);
        return;
      }

      // 2. Otherwise verify 6-digit SMTP OTP code
      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          code: rawInput,
          purpose: 'reset-password',
          otpToken,
        }),
      });

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        penalizeFailedOtpAttempt('Mã không đúng');
        return;
      }

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        if (resp.status === 429 || data.lockedOut) {
          const waitSec = Number(data.retryAfterSeconds) || LOCKOUT_DURATION_SEC;
          setLockoutSeconds(waitSec);
          setRemainingOtpAttempts(0);
          setOtpCode('');
          setError(`Sai quá ${MAX_OTP_ATTEMPTS} lần! Khóa 15 phút.`);
          return;
        }

        const nextRem =
          typeof data.remainingAttempts === 'number'
            ? data.remainingAttempts
            : Math.max(0, remainingOtpAttempts - 1);
        setRemainingOtpAttempts(nextRem);
        if (nextRem <= 0) setLockoutSeconds(LOCKOUT_DURATION_SEC);
        setError(`Mã không đúng (Còn ${nextRem}/${MAX_OTP_ATTEMPTS} lần)`);
        return;
      }

      const resetRes = resetPasswordByEmail(cleanEmail, newResetPassword);
      if (!resetRes.success) {
        setError(resetRes.error || 'Không thể đặt lại mật khẩu');
        return;
      }

      setSuccessMsg('Đặt lại mật khẩu thành công!');
      setPassword(newResetPassword);
      window.setTimeout(() => {
        setSubFlow('form');
        onNavigate('login');
      }, 700);
    } catch {
      setError('Lỗi xác thực mã');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-black relative overflow-y-auto flex items-center justify-center py-10 px-4">
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="absolute top-6 left-6 z-50 flex items-center gap-2 text-white/60 hover:text-white transition-colors cursor-pointer"
      >
        <div className="w-8 h-8 flex items-center justify-center">
          <img
            src="/mini-logo.svg"
            alt={`${config.brandName} Mini`}
            className="w-full h-full object-contain"
          />
        </div>
        <span className="font-medium text-sm">Trang chủ</span>
      </button>

      <div
        className={`absolute inset-0 ${
          isLogin
            ? 'bg-gradient-to-b from-purple-500/40 via-purple-700/50 to-black'
            : 'bg-gradient-to-b from-blue-500/40 via-blue-700/50 to-black'
        }`}
      />
      <div
        className={`absolute top-0 left-1/2 transform -translate-x-1/2 w-[120vh] h-[60vh] rounded-b-[50%] blur-[80px] ${
          isLogin ? 'bg-purple-400/20' : 'bg-blue-400/20'
        }`}
      />

      <div className="w-full max-w-sm relative z-10">
        <div className="relative bg-black/45 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl overflow-hidden">
          <div className="text-center space-y-1.5 mb-5 relative z-10">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="mx-auto flex justify-center mb-1 hover:opacity-80 transition-opacity cursor-pointer"
            >
              <BrandLogo brandName={config.brandName} size="lg" />
            </button>
            <p className="text-white/60 text-xs">
              {subFlow === 'register-verify-otp'
                ? 'Xác thực Gmail'
                : subFlow === 'forgot-request' || subFlow === 'forgot-verify-reset'
                ? 'Khôi phục mật khẩu'
                : isLogin
                ? 'Đăng nhập để sử dụng'
                : `Tạo tài khoản ${config.brandName}`}
            </p>
          </div>

          {lockoutSeconds > 0 && (
            <div className="bg-red-500/25 text-red-200 p-2.5 rounded-xl text-xs mb-3.5 border border-red-500/40 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                <span>Tạm khóa Brute-Force</span>
              </span>
              <strong className="font-mono text-red-300 tabular-nums">
                {formatCountdown(lockoutSeconds)}
              </strong>
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 text-red-300 p-2.5 rounded-lg text-xs mb-3.5 text-center border border-red-500/30">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="bg-green-500/20 text-green-300 p-2.5 rounded-lg text-xs mb-3.5 text-center border border-green-500/30 flex items-center justify-between gap-2">
              <span className="truncate">{successMsg}</span>
              {(subFlow === 'register-verify-otp' || subFlow === 'forgot-verify-reset') && (
                <span className="text-[11px] text-amber-300 shrink-0 font-semibold tabular-nums">
                  {remainingOtpAttempts}/{MAX_OTP_ATTEMPTS} lần
                </span>
              )}
            </div>
          )}

          {/* SUBFLOW 1: Login / Register */}
          {subFlow === 'form' && (
            <>
              <div className="mb-4 relative z-10">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading || loading || lockoutSeconds > 0}
                  className="w-full h-10 bg-white hover:bg-gray-100 text-gray-900 font-medium rounded-lg text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-all shadow cursor-pointer disabled:opacity-60"
                >
                  {googleLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-gray-700" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 48 48">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  )}
                  <span>{isLogin ? 'Đăng nhập bằng Google' : 'Đăng ký bằng Google'}</span>
                </button>

                <div className="flex items-center gap-3 my-4">
                  <div className="h-px bg-white/10 flex-1" />
                  <span className="text-[11px] text-white/40 uppercase tracking-wider">Hoặc</span>
                  <div className="h-px bg-white/10 flex-1" />
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5 relative z-10">
                <div className="relative flex items-center overflow-hidden rounded-lg">
                  <User className="absolute left-3 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    required
                    disabled={lockoutSeconds > 0}
                    aria-label="Tên đăng nhập"
                    placeholder={isLogin ? 'Tên đăng nhập hoặc Gmail' : 'Tên đăng nhập'}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-3 focus:bg-white/10 focus:outline-none transition-all disabled:opacity-50"
                  />
                </div>

                {!isLogin && (
                  <div className="relative flex items-center overflow-hidden rounded-lg">
                    <Mail className="absolute left-3 w-4 h-4 text-white/40" />
                    <input
                      type="email"
                      required
                      disabled={lockoutSeconds > 0}
                      aria-label="Email"
                      placeholder="Địa chỉ Gmail"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-3 focus:bg-white/10 focus:outline-none transition-all disabled:opacity-50"
                    />
                  </div>
                )}

                <div className="relative flex items-center overflow-hidden rounded-lg">
                  <Lock className="absolute left-3 w-4 h-4 text-white/40" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    disabled={lockoutSeconds > 0}
                    aria-label="Mật khẩu"
                    placeholder="Mật khẩu"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:bg-white/10 focus:outline-none transition-all disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    aria-label="Hiện hoặc ẩn mật khẩu"
                    className="absolute right-3 text-white/40 hover:text-white cursor-pointer"
                  >
                    {showPass ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>

                {!isLogin && (
                  <div className="relative flex items-center overflow-hidden rounded-lg">
                    <Lock className="absolute left-3 w-4 h-4 text-white/40" />
                    <input
                      type={showConfirmPass ? 'text' : 'password'}
                      required
                      disabled={lockoutSeconds > 0}
                      aria-label="Xác nhận mật khẩu"
                      placeholder="Xác nhận mật khẩu"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:bg-white/10 focus:outline-none transition-all disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPass(!showConfirmPass)}
                      aria-label="Hiện hoặc ẩn xác nhận mật khẩu"
                      className="absolute right-3 text-white/40 hover:text-white cursor-pointer"
                    >
                      {showConfirmPass ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                )}

                {isLogin ? (
                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="rounded border-white/20 bg-white/5 accent-[#5D45F5]"
                      />
                      <span>Ghi nhớ</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        setSuccessMsg('');
                        setSubFlow('forgot-request');
                      }}
                      className="text-xs text-indigo-300 hover:text-white hover:underline cursor-pointer"
                    >
                      Quên mật khẩu?
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-between bg-[#1e1e1e] border border-white/15 rounded-lg px-3.5 py-2.5 cursor-pointer select-none">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={notRobot}
                        onChange={(e) => setNotRobot(e.target.checked)}
                        className="w-4 h-4 accent-emerald-500 rounded"
                      />
                      <span className="text-xs text-white/90">I'm not a robot</span>
                    </div>
                    <div className="flex flex-col items-end text-[10px] text-white/40">
                      <ShieldCheck className="w-4 h-4 text-blue-400" />
                      <span>reCAPTCHA</span>
                    </div>
                  </label>
                )}

                <button
                  type="submit"
                  disabled={loading || lockoutSeconds > 0}
                  className="w-full bg-white text-black font-medium h-10 rounded-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer mt-2 disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{isLogin ? 'Đăng Nhập' : 'Đăng Ký'}</span>
                  {!loading && <ArrowRight className="w-3.5 h-3.5" />}
                </button>
              </form>
            </>
          )}

          {/* SUBFLOW 2: Concise Registration Verification */}
          {subFlow === 'register-verify-otp' && (
            <div className="space-y-3.5 relative z-10">
              <form onSubmit={handleVerifyRegistrationOtp} className="space-y-3">
                <div className="relative flex items-center overflow-hidden rounded-lg">
                  <KeyRound className="absolute left-3 w-4 h-4 text-emerald-400" />
                  <input
                    type="text"
                    required
                    disabled={lockoutSeconds > 0 || remainingOtpAttempts <= 0}
                    aria-label="Dán link hoặc mã xác nhận từ Gmail"
                    placeholder="Dán link hoặc mã OTP trong Gmail"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 focus:border-emerald-400 rounded-lg text-white placeholder:text-white/40 h-10 text-xs pl-10 pr-3 focus:outline-none disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || lockoutSeconds > 0 || remainingOtpAttempts <= 0}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold h-10 rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Xác Nhận Mã / Link Gmail</span>
                </button>
              </form>

              <button
                type="button"
                onClick={handleCheckFirebaseGmailVerified}
                disabled={loading || lockoutSeconds > 0 || remainingOtpAttempts <= 0}
                className="w-full bg-white/10 hover:bg-white/20 text-white font-medium h-9 rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Đã Nhấn Link Trong Gmail → Kích Hoạt</span>
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSubFlow('form');
                    setError('');
                    setSuccessMsg('');
                  }}
                  className="text-white/60 hover:text-white cursor-pointer"
                >
                  ← Quay lại
                </button>
                <button
                  type="button"
                  disabled={resendCooldownSec > 0 || lockoutSeconds > 0 || loading}
                  onClick={handleSubmit}
                  className="text-indigo-300 hover:text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>
                    {resendCooldownSec > 0 ? `Gửi lại (${resendCooldownSec}s)` : 'Gửi lại'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* SUBFLOW 3: Concise Forgot Password Request */}
          {subFlow === 'forgot-request' && (
            <form onSubmit={handleForgotPasswordRequest} className="space-y-3.5 relative z-10">
              <div className="relative flex items-center overflow-hidden rounded-lg">
                <Mail className="absolute left-3 w-4 h-4 text-white/40" />
                <input
                  type="email"
                  required
                  disabled={lockoutSeconds > 0}
                  aria-label="Gmail khôi phục mật khẩu"
                  placeholder="Nhập Gmail đã đăng ký..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-3 focus:bg-white/10 focus:outline-none disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={loading || lockoutSeconds > 0 || resendCooldownSec > 0}
                className="w-full bg-white text-black font-semibold h-10 rounded-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {resendCooldownSec > 0 ? `Đợi ${resendCooldownSec}s` : 'Gửi Mã Khôi Phục'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setSubFlow('form');
                  setError('');
                  setSuccessMsg('');
                }}
                className="w-full text-center text-xs text-white/60 hover:text-white cursor-pointer pt-1"
              >
                ← Quay lại Đăng nhập
              </button>
            </form>
          )}

          {/* SUBFLOW 4: Concise Forgot Password Reset (No verbose instructions!) */}
          {subFlow === 'forgot-verify-reset' && (
            <div className="space-y-3.5 relative z-10">
              <form onSubmit={handleForgotPasswordReset} className="space-y-3">
                <div className="relative flex items-center overflow-hidden rounded-lg">
                  <KeyRound className="absolute left-3 w-4 h-4 text-emerald-400" />
                  <input
                    type="text"
                    required
                    disabled={lockoutSeconds > 0 || remainingOtpAttempts <= 0}
                    aria-label="Dán link hoặc mã khôi phục từ Gmail"
                    placeholder="Dán link hoặc mã trong Gmail vào đây"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 focus:border-emerald-400 rounded-lg text-white placeholder:text-white/40 h-10 text-xs pl-10 pr-3 focus:outline-none disabled:opacity-50"
                  />
                </div>

                <div className="relative flex items-center overflow-hidden rounded-lg">
                  <Lock className="absolute left-3 w-4 h-4 text-white/40" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    disabled={lockoutSeconds > 0 || remainingOtpAttempts <= 0}
                    aria-label="Mật khẩu mới"
                    placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
                    value={newResetPassword}
                    onChange={(e) => setNewResetPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/15 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 text-white/40 hover:text-white cursor-pointer"
                  >
                    {showPass ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>

                <div className="relative flex items-center overflow-hidden rounded-lg">
                  <Lock className="absolute left-3 w-4 h-4 text-white/40" />
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    required
                    disabled={lockoutSeconds > 0 || remainingOtpAttempts <= 0}
                    aria-label="Xác nhận mật khẩu mới"
                    placeholder="Xác nhận mật khẩu mới"
                    value={confirmResetPassword}
                    onChange={(e) => setConfirmResetPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/15 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass(!showConfirmPass)}
                    className="absolute right-3 text-white/40 hover:text-white cursor-pointer"
                  >
                    {showConfirmPass ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading || lockoutSeconds > 0 || remainingOtpAttempts <= 0}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold h-10 rounded-lg transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Đặt Lại Mật Khẩu Mới</span>
                </button>
              </form>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSubFlow('form');
                    setError('');
                    setSuccessMsg('');
                  }}
                  className="text-white/60 hover:text-white cursor-pointer"
                >
                  ← Quay lại
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubFlow('form');
                    setError('');
                    setSuccessMsg('');
                    onNavigate('login');
                  }}
                  className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                >
                  Đã đổi qua link Gmail →
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-white/60 mt-5">
            {isLogin ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? '}
            <button
              type="button"
              onClick={() => {
                setSubFlow('form');
                setError('');
                setSuccessMsg('');
                onNavigate(isLogin ? 'register' : 'login');
              }}
              className="text-white font-medium hover:underline cursor-pointer"
            >
              {isLogin ? 'Đăng ký ngay' : 'Đăng nhập'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
