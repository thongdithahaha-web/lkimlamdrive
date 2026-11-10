import React, { useState } from 'react';
import {
  User,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  KeyRound,
  Loader2,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';
import { AppRoute } from './HomeView';

interface AuthViewsProps {
  mode: 'login' | 'register';
  onNavigate: (route: AppRoute) => void;
}

type SubFlow =
  | 'form'
  | 'register-verify-otp'
  | 'forgot-request'
  | 'forgot-verify-reset';

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
  const [mailPreviewBanner, setMailPreviewBanner] = useState<{
    to: string;
    code: string;
    sentViaSmtp: boolean;
    purpose: 'register' | 'reset-password';
  } | null>(null);

  const isLogin = mode === 'login';

  const handleGoogleSignIn = async () => {
    setError('');
    setSuccessMsg('');
    setGoogleLoading(true);
    try {
      const res = await loginWithGoogle();
      if (!res.success) {
        setError(res.error || 'Đăng nhập Google thất bại');
        return;
      }
      setSuccessMsg(`Đăng nhập Google thành công (${res.user?.email})!`);
      window.setTimeout(() => {
        onNavigate('home');
      }, 500);
    } finally {
      setGoogleLoading(false);
    }
  };

  // Step 1: Login or Send Registration Gmail OTP
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (isLogin) {
      const res = login(username, password);
      if (!res.success) {
        setError(res.error || 'Đăng nhập thất bại');
        return;
      }
      onNavigate('home');
      return;
    }

    // Registration Step 1: Validate & Send Gmail OTP
    if (password.length < 4) {
      setError('Mật khẩu phải có ít nhất 4 ký tự');
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp');
      return;
    }
    if (!notRobot) {
      setError('Vui lòng xác nhận bạn không phải là robot');
      return;
    }

    const canReg = checkUserCanRegister(username, email);
    if (!canReg.ok) {
      setError(canReg.error || 'Thông tin đăng ký không hợp lệ');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          smtpEmail: config.smtpEmail,
          smtpAppPassword: config.smtpAppPassword,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Không thể gửi mã xác thực Gmail');
        return;
      }

      setMailPreviewBanner({
        to: email.trim().toLowerCase(),
        code: String(data.demoOtpCode || ''),
        sentViaSmtp: Boolean(data.sentViaSmtp),
        purpose: 'register',
      });
      setOtpCode('');
      setSubFlow('register-verify-otp');
      setSuccessMsg(
        `Đã gửi mã xác nhận gồm 6 chữ số tới Gmail ${email.trim().toLowerCase()}. Vui lòng nhập mã để kích hoạt tài khoản!`
      );
    } catch {
      setError('Lỗi kết nối khi gửi mã xác thực Gmail');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify Registration OTP & Create Account
  const handleVerifyRegistrationOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setError('Vui lòng nhập đủ mã OTP 6 chữ số');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: otpCode.trim(),
          purpose: 'register',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Mã OTP không chính xác');
        return;
      }

      const regRes = register(username, email, password);
      if (!regRes.success) {
        setError(regRes.error || 'Đăng ký thất bại');
        return;
      }

      setMailPreviewBanner(null);
      setSuccessMsg(
        `Xác thực Gmail thành công! Tài khoản đã kích hoạt & tặng ${config.defaultSignupCredits} Credits khởi điểm.`
      );
      window.setTimeout(() => {
        onNavigate('home');
      }, 900);
    } catch {
      setError('Lỗi xác thực mã OTP');
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Step 1: Request OTP to Gmail
  const handleForgotPasswordRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const cleanEmail = email.trim().toLowerCase();
    const matchedUser = users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!matchedUser) {
      setError('Không tìm thấy tài khoản nào đăng ký với địa chỉ Gmail này');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          username: matchedUser.username,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Không thể gửi mã khôi phục');
        return;
      }

      setMailPreviewBanner({
        to: cleanEmail,
        code: String(data.demoOtpCode || ''),
        sentViaSmtp: Boolean(data.sentViaSmtp),
        purpose: 'reset-password',
      });
      setOtpCode('');
      setSubFlow('forgot-verify-reset');
      setSuccessMsg(`Đã gửi mã khôi phục mật khẩu 6 số tới Gmail ${cleanEmail}!`);
    } catch {
      setError('Lỗi kết nối khi gửi mã khôi phục mật khẩu');
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Step 2: Verify OTP & Set New Password
  const handleForgotPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setError('Vui lòng nhập đủ mã OTP 6 chữ số từ Gmail');
      return;
    }
    if (!newResetPassword || newResetPassword.length < 4) {
      setError('Mật khẩu mới phải có ít nhất 4 ký tự');
      return;
    }
    if (newResetPassword !== confirmResetPassword) {
      setError('Mật khẩu xác nhận không khớp');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: otpCode.trim(),
          purpose: 'reset-password',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Mã OTP khôi phục không chính xác');
        return;
      }

      const resetRes = resetPasswordByEmail(email.trim().toLowerCase(), newResetPassword);
      if (!resetRes.success) {
        setError(resetRes.error || 'Không thể đặt lại mật khẩu');
        return;
      }

      setMailPreviewBanner(null);
      setSuccessMsg('Khôi phục mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.');
      setPassword(newResetPassword);
      window.setTimeout(() => {
        setSubFlow('form');
        onNavigate('login');
      }, 900);
    } catch {
      setError('Lỗi đặt lại mật khẩu');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-black relative overflow-y-auto flex items-center justify-center py-10 px-4">
      {/* Top-left Return to Home link identical to ezdrive.id.vn */}
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

      {/* Atmospheric Background Gradient */}
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

      {/* Auth Glass Card */}
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
                ? 'Xác nhận mã OTP gửi tới Gmail'
                : subFlow === 'forgot-request' || subFlow === 'forgot-verify-reset'
                ? 'Khôi phục mật khẩu qua Gmail'
                : isLogin
                ? 'Đăng nhập để sử dụng'
                : `Tạo tài khoản ${config.brandName}`}
            </p>
          </div>

          {error && (
            <div className="bg-red-500/20 text-red-300 p-2.5 rounded-lg text-xs mb-4 text-center border border-red-500/30">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="bg-green-500/20 text-green-300 p-3 rounded-lg text-xs mb-4 text-center border border-green-500/30">
              {successMsg}
            </div>
          )}

          {/* Real-time Gmail Notification Card with 1-Click OTP Fill */}
          {mailPreviewBanner && (
            <div className="mb-4 p-3.5 rounded-xl bg-indigo-500/15 border border-indigo-400/40 text-left space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Thư xác nhận Gmail tới {mailPreviewBanner.to}</span>
                </span>
              </div>
              <p className="text-xs text-white/80">
                Mã xác nhận OTP 6 số của bạn là:{' '}
                <strong className="font-mono text-sm text-emerald-300 tracking-widest bg-black/40 px-2 py-0.5 rounded border border-emerald-500/30">
                  {mailPreviewBanner.code}
                </strong>
              </p>
              <button
                type="button"
                onClick={() => setOtpCode(mailPreviewBanner.code)}
                className="text-[11px] text-indigo-300 hover:text-white underline cursor-pointer font-medium"
              >
                → Nhấn để tự động điền mã {mailPreviewBanner.code}
              </button>
            </div>
          )}

          {/* SUBFLOW 1: Standard Login / Register Form */}
          {subFlow === 'form' && (
            <>
              {/* Official Sign in with Google Button */}
              <div className="mb-4 relative z-10">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading || loading}
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
                  <span>{isLogin ? 'Đăng nhập bằng Google' : 'Đăng ký nhanh bằng Google'}</span>
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
                    aria-label="Tên đăng nhập"
                    placeholder={isLogin ? 'Tên đăng nhập hoặc Gmail' : 'Tên đăng nhập'}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-3 focus:bg-white/10 focus:outline-none transition-all"
                  />
                </div>

                {!isLogin && (
                  <div className="relative flex items-center overflow-hidden rounded-lg">
                    <Mail className="absolute left-3 w-4 h-4 text-white/40" />
                    <input
                      type="email"
                      required
                      aria-label="Email"
                      placeholder="Địa chỉ Gmail nhận mã xác thực"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-3 focus:bg-white/10 focus:outline-none transition-all"
                    />
                  </div>
                )}

                <div className="relative flex items-center overflow-hidden rounded-lg">
                  <Lock className="absolute left-3 w-4 h-4 text-white/40" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    aria-label="Mật khẩu"
                    placeholder="Mật khẩu"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:bg-white/10 focus:outline-none transition-all"
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
                      aria-label="Xác nhận mật khẩu"
                      placeholder="Xác nhận mật khẩu"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-white/5 border border-transparent focus:border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:bg-white/10 focus:outline-none transition-all"
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
                  disabled={loading}
                  className="w-full bg-white text-black font-medium h-10 rounded-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer mt-2 disabled:opacity-60"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {isLogin ? 'Đăng Nhập' : 'Gửi Mã Xác Nhận Tới Gmail'}
                  </span>
                  {!loading && <ArrowRight className="w-3.5 h-3.5" />}
                </button>
              </form>
            </>
          )}

          {/* SUBFLOW 2: Verify Gmail OTP for Registration */}
          {subFlow === 'register-verify-otp' && (
            <form onSubmit={handleVerifyRegistrationOtp} className="space-y-4 relative z-10">
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white/80">
                Mã xác thực 6 chữ số đã được gửi tới Gmail{' '}
                <strong className="text-white">{email}</strong>. Xác thực Gmail giúp bảo vệ tài
                khoản và khôi phục mật khẩu khi cần.
              </div>

              <div className="relative flex items-center overflow-hidden rounded-lg">
                <KeyRound className="absolute left-3 w-4 h-4 text-emerald-400" />
                <input
                  type="text"
                  required
                  maxLength={6}
                  aria-label="Mã xác nhận OTP 6 số"
                  placeholder="Nhập mã OTP 6 chữ số"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-white/10 border border-emerald-500/40 focus:border-emerald-400 rounded-lg text-white placeholder:text-white/40 h-11 text-base font-mono tracking-widest pl-10 pr-3 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold h-10 rounded-lg transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>Xác Nhận Gmail & Hoàn Tất Đăng Ký</span>
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSubFlow('form');
                    setMailPreviewBanner(null);
                  }}
                  className="text-white/60 hover:text-white cursor-pointer"
                >
                  ← Sửa lại Gmail
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="text-indigo-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Gửi lại mã</span>
                </button>
              </div>
            </form>
          )}

          {/* SUBFLOW 3: Forgot Password — Request Gmail OTP */}
          {subFlow === 'forgot-request' && (
            <form onSubmit={handleForgotPasswordRequest} className="space-y-4 relative z-10">
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white/80">
                Nhập địa chỉ <strong>Gmail</strong> bạn đã dùng khi đăng ký. Hệ thống sẽ gửi mã OTP
                6 số để khôi phục mật khẩu ngay lập tức.
              </div>

              <div className="relative flex items-center overflow-hidden rounded-lg">
                <Mail className="absolute left-3 w-4 h-4 text-white/40" />
                <input
                  type="email"
                  required
                  aria-label="Gmail khôi phục mật khẩu"
                  placeholder="Nhập Gmail đã đăng ký..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/20 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-3 focus:bg-white/10 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-black font-semibold h-10 rounded-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer disabled:opacity-60"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Gửi Mã Khôi Phục Tới Gmail</span>
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

          {/* SUBFLOW 4: Forgot Password — Verify OTP & Set New Password */}
          {subFlow === 'forgot-verify-reset' && (
            <form onSubmit={handleForgotPasswordReset} className="space-y-3.5 relative z-10">
              <div className="relative flex items-center overflow-hidden rounded-lg">
                <KeyRound className="absolute left-3 w-4 h-4 text-emerald-400" />
                <input
                  type="text"
                  required
                  maxLength={6}
                  aria-label="Mã OTP khôi phục 6 số"
                  placeholder="Nhập mã OTP 6 số từ Gmail"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-white/10 border border-emerald-500/40 rounded-lg text-white placeholder:text-white/40 h-10 text-sm font-mono tracking-widest pl-10 pr-3 focus:outline-none"
                />
              </div>

              <div className="relative flex items-center overflow-hidden rounded-lg">
                <Lock className="absolute left-3 w-4 h-4 text-white/40" />
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  aria-label="Mật khẩu mới"
                  placeholder="Nhập mật khẩu mới"
                  value={newResetPassword}
                  onChange={(e) => setNewResetPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/15 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:outline-none"
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
                  aria-label="Xác nhận mật khẩu mới"
                  placeholder="Xác nhận mật khẩu mới"
                  value={confirmResetPassword}
                  onChange={(e) => setConfirmResetPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/15 rounded-lg text-white placeholder:text-white/30 h-10 text-sm pl-10 pr-10 focus:outline-none"
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
                disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold h-10 rounded-lg transition-all flex items-center justify-center gap-1.5 text-sm cursor-pointer"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Đặt Lại Mật Khẩu Mới</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSubFlow('form');
                  setMailPreviewBanner(null);
                }}
                className="w-full text-center text-xs text-white/60 hover:text-white cursor-pointer pt-1"
              >
                ← Hủy & quay lại Đăng nhập
              </button>
            </form>
          )}

          <p className="text-center text-xs text-white/60 mt-5">
            {isLogin ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? '}
            <button
              type="button"
              onClick={() => {
                setSubFlow('form');
                setMailPreviewBanner(null);
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
