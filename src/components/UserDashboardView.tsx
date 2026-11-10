import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Clock,
  CreditCard,
  CheckCircle2,
  QrCode,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { useAppStore } from '../context/AppContext';
import { calculateTopupCredits, PaymentTransaction } from '../utils/systemRules';
import { AppRoute } from './HomeView';

interface UserDashboardViewProps {
  defaultTab: 'history' | 'topup';
  onNavigate: (route: AppRoute) => void;
}

export const UserDashboardView: React.FC<UserDashboardViewProps> = ({
  defaultTab,
  onNavigate,
}) => {
  const {
    config,
    currentUser,
    history,
    payments,
    createPaymentOrder,
    confirmPaymentOrder,
    cancelPaymentOrder,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'history' | 'topup'>(defaultTab);
  const [amountInput, setAmountInput] = useState<string>(String(config.minTopupVnd || 10000));
  const [activePayment, setActivePayment] = useState<PaymentTransaction | null>(null);
  const [topupError, setTopupError] = useState('');
  const [topupSuccess, setTopupSuccess] = useState('');

  // If user is not logged in, prompt login or register
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8 text-center backdrop-blur-xl">
          <h2 className="text-xl font-bold mb-2">Yêu cầu Đăng nhập</h2>
          <p className="text-sm text-white/60 mb-6">
            Vui lòng đăng nhập hoặc đăng ký tài khoản {config.brandName} để xem lịch sử tải và nạp Credits.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium cursor-pointer"
            >
              Về Trang Chủ
            </button>
            <button
              type="button"
              onClick={() => onNavigate('register')}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium cursor-pointer"
            >
              Đăng Ký
            </button>
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="px-5 py-2.5 rounded-xl bg-white text-black hover:bg-gray-200 text-sm font-semibold cursor-pointer"
            >
              Đăng Nhập Ngay
            </button>
          </div>
        </div>
      </div>
    );
  }

  const userHistory = useMemo(
    () => history.filter((h) => h.userId === currentUser.id),
    [history, currentUser.id]
  );

  const userPayments = useMemo(
    () => payments.filter((p) => p.userId === currentUser.id),
    [payments, currentUser.id]
  );

  const numericAmount = parseInt(amountInput || '0', 10);
  const creditPreview = useMemo(
    () => calculateTopupCredits(numericAmount, config),
    [numericAmount, config]
  );

  const handleCreateQr = () => {
    setTopupError('');
    setTopupSuccess('');
    const res = createPaymentOrder(numericAmount);
    if (!res.success || !res.payment) {
      setTopupError(res.error || 'Lỗi khi tạo giao dịch');
      return;
    }
    setActivePayment(res.payment);
  };

  const handleSimulateCompletePayment = () => {
    if (!activePayment) return;
    confirmPaymentOrder(activePayment.id);
    setTopupSuccess(
      `Đã xác nhận thanh toán thành công! +${activePayment.credits} Credits đã được cộng vào tài khoản ${currentUser.username}.`
    );
    setActivePayment(null);
  };

  const handleCancelOrder = () => {
    if (activePayment) {
      cancelPaymentOrder(activePayment.id);
      setActivePayment(null);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Top bar matching ezdrive.id.vn $L component */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="text-white/60 hover:text-white flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-5 w-5" />
            <span>Quay lại Trang Chủ</span>
          </button>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-full px-6 py-2">
              <span className="text-sm font-medium">{currentUser.username}</span>
              <span className="w-px h-4 bg-white/20" />
              <span className="font-semibold text-yellow-400 tabular-nums">
                💎 {currentUser.credits} Credits
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Left Sidebar Tabs */}
          <div className="md:col-span-1 space-y-2">
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-black font-semibold'
                  : 'hover:bg-white/10 text-white/70'
              }`}
            >
              <Clock className="h-5 w-5" />
              <span>Lịch sử tải</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('topup')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                activeTab === 'topup'
                  ? 'bg-white text-black font-semibold'
                  : 'hover:bg-white/10 text-white/70'
              }`}
            >
              <CreditCard className="h-5 w-5" />
              <span>Nạp tiền</span>
            </button>
          </div>

          {/* Right Content Area */}
          <div className="md:col-span-3">
            {activeTab === 'history' && (
              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl">
                <div className="p-6 border-b border-white/10 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Lịch sử tải</h2>
                  <span className="text-xs text-white/50 tabular-nums">
                    Tổng cộng: {userHistory.length} lượt tải
                  </span>
                </div>

                {userHistory.length === 0 ? (
                  <div className="p-12 text-center text-white/50">
                    <p className="mb-4">Chưa có lịch sử tải file nào.</p>
                    <button
                      type="button"
                      onClick={() => onNavigate('home')}
                      className="px-5 py-2.5 bg-white text-black rounded-xl text-sm font-semibold hover:bg-gray-200 transition-colors cursor-pointer"
                    >
                      Tải File Ngay
                    </button>
                  </div>
                ) : (
                  <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto">
                    {userHistory.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                          <div className="flex-1 min-w-0 w-full">
                            <div className="flex items-start gap-3 mb-2">
                              <span className="text-2xl flex-shrink-0">
                                {item.fileType === 'folder' ? '📁' : '📄'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-white break-words leading-snug">
                                  {item.fileName || 'Không có tên'}
                                </h3>
                                <a
                                  href={item.driveUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-blue-400 hover:underline mt-1 break-all block"
                                >
                                  {item.driveUrl}
                                </a>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 mt-3 flex-wrap text-xs text-white/60 tabular-nums">
                              <span>{item.fileType === 'folder' ? 'Thư mục' : 'Tệp tin'}</span>
                              <span>·</span>
                              <span className="text-emerald-400 font-medium">
                                {item.status === 'completed' ? 'Hoàn thành' : item.status}
                              </span>
                              <span>·</span>
                              <span>{item.sizeFormatted}</span>
                              <span>·</span>
                              <span>
                                Credits:{' '}
                                <strong className="text-yellow-400">{item.creditsUsed} 💎</strong>
                              </span>
                              <span>·</span>
                              <span>{new Date(item.createdAt).toLocaleString('vi-VN')}</span>
                            </div>
                          </div>

                          {item.destinationFolderLink && item.status === 'completed' && (
                            <div className="flex-shrink-0 mt-2 sm:mt-0 w-full sm:w-auto">
                              <a
                                href={item.destinationFolderLink}
                                target="_blank"
                                rel="noreferrer"
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-lg font-medium text-sm transition-colors shadow-md"
                              >
                                <ExternalLink className="h-4 w-4" />
                                <span>Mở folder đã copy</span>
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'topup' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column: Create Topup or QR Payment View */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl flex flex-col items-center text-center">
                  {topupSuccess && (
                    <div className="w-full mb-5 p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs text-left">
                      {topupSuccess}
                    </div>
                  )}

                  {activePayment ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">Quét mã QR để thanh toán</h3>
                      <p className="text-white/60 text-sm mb-6">Sử dụng App ngân hàng của bạn</p>

                      <div className="bg-white p-4 rounded-xl mb-6 shadow-2xl">
                        <img
                          src={`https://qr.sepay.vn/img?acc=${encodeURIComponent(
                            activePayment.bankAcc
                          )}&bank=${encodeURIComponent(
                            activePayment.bankName
                          )}&amount=${activePayment.amount}&des=${encodeURIComponent(
                            activePayment.transactionCode
                          )}`}
                          alt="VietQR"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                          className="w-48 h-48 object-contain"
                        />
                        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-700 font-semibold mt-2">
                          <QrCode className="w-4 h-4 text-indigo-600" />
                          <span>VietQR · {activePayment.bankName}</span>
                        </div>
                      </div>

                      <div className="w-full text-left space-y-3 bg-black/40 p-4 rounded-xl border border-white/10 tabular-nums">
                        <div className="flex justify-between">
                          <span className="text-white/60 text-sm">Ngân hàng:</span>
                          <span className="font-medium">{activePayment.bankName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-white/60 text-sm">Số tài khoản:</span>
                          <span className="font-medium text-blue-400 font-mono">
                            {activePayment.bankAcc}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-white/60 text-sm">Tên TK:</span>
                          <span className="font-medium">{activePayment.bankAccountName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-white/60 text-sm">Số tiền:</span>
                          <span className="font-medium text-green-400">
                            {activePayment.amount.toLocaleString()} VNĐ
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-white/10 pt-3">
                          <span className="text-white/60 text-sm">Nội dung (BẮT BUỘC):</span>
                          <span className="font-mono bg-white/10 px-2 py-0.5 rounded text-yellow-400 font-bold tracking-wider">
                            {activePayment.transactionCode}
                          </span>
                        </div>
                      </div>

                      <p className="mt-4 text-xs text-white/50 text-left w-full">
                        * Sau khi chuyển khoản xong, nhấn "Kiểm tra số dư" để hệ thống tự động cộng{' '}
                        {activePayment.credits} Credits.
                      </p>

                      <div className="mt-6 flex gap-3 w-full">
                        <button
                          type="button"
                          onClick={handleCancelOrder}
                          className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-xl text-sm transition-colors cursor-pointer"
                        >
                          Hủy giao dịch
                        </button>
                        <button
                          type="button"
                          onClick={handleSimulateCompletePayment}
                          className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 font-semibold py-2.5 rounded-xl text-sm transition-colors cursor-pointer"
                        >
                          Kiểm tra số dư
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-semibold mb-2">Tạo giao dịch nạp tiền</h3>
                      <p className="text-white/60 text-sm mb-6 tabular-nums">
                        Tối thiểu {config.minTopupVnd.toLocaleString()} VNĐ
                      </p>

                      {/* Quick Package Amount Selector */}
                      <div className="w-full grid grid-cols-3 gap-2 mb-5">
                        {config.packages.map((pkg) => (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() => setAmountInput(String(pkg.priceVnd))}
                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer tabular-nums ${
                              numericAmount === pkg.priceVnd
                                ? 'bg-indigo-600/25 border-indigo-400 text-white'
                                : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                            }`}
                          >
                            <div className="text-xs font-bold">{pkg.priceVnd.toLocaleString()}đ</div>
                            <div className="text-[11px] text-yellow-400">
                              +{pkg.credits + pkg.bonusCredits} 💎
                            </div>
                          </button>
                        ))}
                      </div>

                      <div className="w-full text-left mb-4">
                        <label
                          htmlFor="topup-amount-input"
                          className="block text-sm font-medium text-white/70 mb-2"
                        >
                          Số tiền muốn nạp (VNĐ)
                        </label>
                        <input
                          id="topup-amount-input"
                          type="number"
                          min={config.minTopupVnd}
                          step="1000"
                          value={amountInput}
                          onChange={(e) => setAmountInput(e.target.value)}
                          className="w-full bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 tabular-nums"
                        />
                        <div className="flex items-center justify-between text-xs mt-2.5 tabular-nums">
                          <span className="text-yellow-400 font-medium">
                            Tương đương: {creditPreview.totalCredits} Credits
                          </span>
                          {creditPreview.bonusCredits > 0 && (
                            <span className="text-emerald-400 inline-flex items-center gap-1">
                              <Sparkles className="w-3.5 h-3.5" /> Đã cộng +{creditPreview.bonusCredits}{' '}
                              Credits thưởng
                            </span>
                          )}
                        </div>
                      </div>

                      {topupError && (
                        <div className="text-red-400 text-sm mb-4">{topupError}</div>
                      )}

                      <button
                        type="button"
                        onClick={handleCreateQr}
                        disabled={numericAmount < config.minTopupVnd}
                        className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50 transition-all cursor-pointer"
                      >
                        Tạo mã QR nạp tiền
                      </button>
                    </>
                  )}
                </div>

                {/* Right Column: Payment Transaction History */}
                <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl">
                  <div className="p-6 border-b border-white/10">
                    <h2 className="text-lg font-semibold">Lịch sử giao dịch</h2>
                  </div>
                  <div>
                    {userPayments.length === 0 ? (
                      <div className="p-8 text-center text-white/50">
                        Chưa có giao dịch nạp tiền nào.
                      </div>
                    ) : (
                      <div className="overflow-y-auto max-h-[500px]">
                        {userPayments.map((pay) => (
                          <div
                            key={pay.id}
                            className="flex items-center justify-between p-4 border-b border-white/10 hover:bg-white/5 tabular-nums"
                          >
                            <div className="flex items-center gap-3">
                              <div className="bg-green-500/20 p-2 rounded-full border border-green-500/30">
                                <CheckCircle2 className="h-4 w-4 text-green-400" />
                              </div>
                              <div>
                                <p className="font-medium text-sm text-white">
                                  +{pay.amount.toLocaleString()} VNĐ
                                </p>
                                <p className="text-xs text-white/50">
                                  {new Date(pay.createdAt).toLocaleString('vi-VN')} ·{' '}
                                  {pay.status === 'completed'
                                    ? 'Thành công'
                                    : pay.status === 'pending'
                                    ? 'Đang chờ duyệt'
                                    : 'Đã hủy'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-yellow-400">+{pay.credits} 💎</p>
                              <p className="text-[11px] font-mono text-white/40">
                                {pay.transactionCode}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
