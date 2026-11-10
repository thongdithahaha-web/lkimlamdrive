import React, { useState, useMemo } from 'react';
import {
  Users,
  DollarSign,
  Sliders,
  Activity,
  ArrowLeft,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  Ban,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  FileCode,
  CreditCard,
} from 'lucide-react';
import { useAppStore } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';
import { AppRoute } from './HomeView';
import { PricingPackage, UserRole } from '../utils/systemRules';
import { SecurityDdosPanel } from './SecurityDdosPanel';

interface AdminViewProps {
  onNavigate: (route: AppRoute) => void;
}

type AdminSection = 'accounts' | 'pricing' | 'system' | 'transactions' | 'security';

export const AdminView: React.FC<AdminViewProps> = ({ onNavigate }) => {
  const {
    config,
    users,
    history,
    payments,
    updateSystemConfig,
    resetSystemConfig,
    savePricingPackage,
    deletePricingPackage,
    adminUpdateUser,
    adminAdjustCredits,
    adminAdjustBalanceVnd,
    adminCreateUser,
    adminDeleteUser,
    confirmPaymentOrder,
    cancelPaymentOrder,
  } = useAppStore();

  const [activeSection, setActiveSection] = useState<AdminSection>('accounts');
  const [toastMsg, setToastMsg] = useState('');

  // Accounts state
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [creditInputs, setCreditInputs] = useState<Record<string, string>>({});
  const [moneyInputs, setMoneyInputs] = useState<Record<string, string>>({});

  // Create new account modal/inline form
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('123456');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [newBalanceVnd, setNewBalanceVnd] = useState('0');
  const [newCredits, setNewCredits] = useState('50');
  const [createUserError, setCreateUserError] = useState('');

  // Pricing & Package form state
  const [editingPkg, setEditingPkg] = useState<PricingPackage | null>(null);
  const [pkgName, setPkgName] = useState('');
  const [pkgAudience, setPkgAudience] = useState('');
  const [pkgPrice, setPkgPrice] = useState('50000');
  const [pkgCredits, setPkgCredits] = useState('50');
  const [pkgBonus, setPkgBonus] = useState('10');
  const [pkgMaxGb, setPkgMaxGb] = useState('100');
  const [pkgDesc, setPkgDesc] = useState('');
  const [pkgPopular, setPkgPopular] = useState(false);

  // Local editable system form synced with config
  const [sysForm, setSysForm] = useState({
    brandName: config.brandName,
    heroBadge: config.heroBadge,
    heroTitlePrefix: config.heroTitlePrefix,
    heroTitleHighlight: config.heroTitleHighlight,
    heroSubtitle: config.heroSubtitle,
    inputPlaceholder: config.inputPlaceholder,
    ctaButtonText: config.ctaButtonText,
    stat1Value: config.stat1Value,
    stat1Label: config.stat1Label,
    stat2Value: config.stat2Value,
    stat2Label: config.stat2Label,
    stat3Value: config.stat3Value,
    stat3Label: config.stat3Label,
    maintenanceMode: config.maintenanceMode,
    maintenanceMessage: config.maintenanceMessage,
    announcementBanner: config.announcementBanner,
    bankName: config.bankName,
    bankAccountNo: config.bankAccountNo,
    bankAccountName: config.bankAccountName,
    transferPrefix: config.transferPrefix,
    activeProxyRegion: config.activeProxyRegion,
    maxConcurrentJobs: config.maxConcurrentJobs,
  });

  // Local editable pricing rates synced with config
  const [rateForm, setRateForm] = useState({
    creditPer10kVnd: config.creditPer10kVnd,
    minTopupVnd: config.minTopupVnd,
    defaultSignupCredits: config.defaultSignupCredits,
    costPerSingleFileCredit: config.costPerSingleFileCredit,
    costPerGbCredit: config.costPerGbCredit,
    vipDiscountPercent: config.vipDiscountPercent,
  });

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg('');
    }, 3000);
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      const q = userSearch.trim().toLowerCase();
      const matchesQuery =
        !q ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q);
      return matchesRole && matchesQuery;
    });
  }, [users, userSearch, roleFilter]);

  const totalRevenueVnd = useMemo(
    () =>
      payments
        .filter((p) => p.status === 'completed')
        .reduce((acc, p) => acc + p.amount, 0),
    [payments]
  );

  const totalCreditsCirculating = useMemo(
    () => users.reduce((acc, u) => acc + u.credits, 0),
    [users]
  );

  const handleSaveRates = (e: React.FormEvent) => {
    e.preventDefault();
    updateSystemConfig({
      creditPer10kVnd: Math.max(1, Number(rateForm.creditPer10kVnd) || 10),
      minTopupVnd: Math.max(1000, Number(rateForm.minTopupVnd) || 10000),
      defaultSignupCredits: Math.max(0, Number(rateForm.defaultSignupCredits) || 0),
      costPerSingleFileCredit: Math.max(1, Number(rateForm.costPerSingleFileCredit) || 1),
      costPerGbCredit: Math.max(1, Number(rateForm.costPerGbCredit) || 1),
      vipDiscountPercent: Math.min(90, Math.max(0, Number(rateForm.vipDiscountPercent) || 0)),
    });
    showToast('Đã lưu bảng tỷ giá Credits & cấu hình Set Giá thành công!');
  };

  const handleSaveSystemConfig = (e: React.FormEvent) => {
    e.preventDefault();
    updateSystemConfig(sysForm);
    showToast('Đã cập nhật cấu hình toàn bộ hệ thống LKimLamDrive thành công!');
  };

  const startEditPackage = (pkg: PricingPackage) => {
    setEditingPkg(pkg);
    setPkgName(pkg.name);
    setPkgAudience(pkg.targetAudience);
    setPkgPrice(String(pkg.priceVnd));
    setPkgCredits(String(pkg.credits));
    setPkgBonus(String(pkg.bonusCredits));
    setPkgMaxGb(String(pkg.maxFileSizeGb));
    setPkgDesc(pkg.description);
    setPkgPopular(Boolean(pkg.popular));
  };

  const handleSavePackage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pkgName.trim()) return;
    const saved: PricingPackage = {
      id: editingPkg ? editingPkg.id : `pkg-${Date.now()}`,
      name: pkgName.trim(),
      targetAudience: pkgAudience.trim() || 'Cho mọi đối tượng người dùng',
      priceVnd: Math.max(1000, parseInt(pkgPrice || '10000', 10)),
      credits: Math.max(1, parseInt(pkgCredits || '10', 10)),
      bonusCredits: Math.max(0, parseInt(pkgBonus || '0', 10)),
      maxFileSizeGb: Math.max(1, parseInt(pkgMaxGb || '50', 10)),
      description: pkgDesc.trim() || 'Gói tải tốc độ cao qua máy chủ Proxy VIP.',
      popular: pkgPopular,
    };
    savePricingPackage(saved);
    setEditingPkg(null);
    setPkgName('');
    setPkgAudience('');
    setPkgDesc('');
    showToast(`Đã lưu gói cước "${saved.name}" thành công!`);
  };

  const handleCreateUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateUserError('');
    const res = adminCreateUser({
      username: newUsername,
      email: newEmail || `${newUsername}@lkimlamdrive.vn`,
      password: newPassword || '123456',
      role: newRole,
      balanceVnd: Math.max(0, parseInt(newBalanceVnd || '0', 10)),
      credits: Math.max(0, parseInt(newCredits || '0', 10)),
      status: 'active',
    });
    if (!res.success) {
      setCreateUserError(res.error || 'Không thể tạo tài khoản');
      return;
    }
    setNewUsername('');
    setNewEmail('');
    setNewPassword('123456');
    setNewBalanceVnd('0');
    setNewCredits('50');
    showToast(`Đã tạo tài khoản "${newUsername}" thành công!`);
  };

  const handleSetUserExactCredits = (userId: string, username: string) => {
    const raw = creditInputs[userId];
    if (raw === undefined) return;
    const val = Math.max(0, parseInt(raw, 10) || 0);
    adminUpdateUser(userId, { credits: val });
    showToast(`Đã cập nhật số dư của ${username} thành ${val.toLocaleString()} Credits!`);
  };

  const handleSetUserExactMoney = (userId: string, username: string) => {
    const raw = moneyInputs[userId];
    if (raw === undefined) return;
    const val = Math.max(0, parseInt(raw, 10) || 0);
    adminAdjustBalanceVnd(userId, val, true);
    showToast(`Đã cập nhật số tiền của ${username} thành ${val.toLocaleString()} VNĐ!`);
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col lg:flex-row">
      {/* Sidebar Navigation (260px Workspace Canvas) */}
      <aside className="w-full lg:w-64 bg-[#0F172A] border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div className="p-5">
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="flex items-center gap-2 focus:outline-none cursor-pointer"
            >
              <BrandLogo brandName={config.brandName} size="sm" />
            </button>
          </div>

          <div className="mb-4 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300 flex items-center gap-2">
            <FileCode className="w-4 h-4 shrink-0 text-indigo-400" />
            <span className="truncate font-mono">/admin · /index.html</span>
          </div>

          <nav className="space-y-1.5" aria-label="Menu Quản Trị Hệ Thống">
            <button
              type="button"
              onClick={() => setActiveSection('accounts')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeSection === 'accounts'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Quản Lý Tài Khoản</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('pricing')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeSection === 'pricing'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
              }`}
            >
              <DollarSign className="w-4 h-4 shrink-0" />
              <span>Set Giá & Gói VIP</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('system')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeSection === 'system'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
              }`}
            >
              <Sliders className="w-4 h-4 shrink-0" />
              <span>Chỉnh Sửa Hệ Thống</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('transactions')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeSection === 'transactions'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
              }`}
            >
              <Activity className="w-4 h-4 shrink-0" />
              <span>Duyệt Nạp & Lịch Sử</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('security')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeSection === 'security'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
              }`}
            >
              <Shield className="w-4 h-4 shrink-0" />
              <span>Chống DDoS & Bảo Mật</span>
            </button>
          </nav>
        </div>

        <div className="p-5 border-t border-slate-800 space-y-2">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Xem Trang Chủ ({config.brandName})</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Contract */}
        <header className="h-16 px-6 border-b border-slate-800 bg-[#0F172A]/60 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-sm text-slate-400 truncate">
            <span className="font-semibold text-white">LKimLamDrive Admin</span>
            <span>/</span>
            <span className="text-indigo-400 font-medium">
              {activeSection === 'accounts' && 'Quản Lý Toàn Bộ Tài Khoản'}
              {activeSection === 'pricing' && 'Thiết Lập Bảng Giá & Tỷ Giá Credits'}
              {activeSection === 'system' && 'Chỉnh Sửa Toàn Bộ Hệ Thống & Ngân Hàng'}
              {activeSection === 'transactions' && 'Quản Lý Giao Dịch Nạp & Lượt Tải'}
              {activeSection === 'security' && 'Trung Tâm Chống DDoS, Rate Limit & Gmail OTP'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                resetSystemConfig();
                showToast('Đã khôi phục cấu hình mặc định của LKimLamDrive!');
              }}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-300 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Khôi phục mặc định</span>
            </button>
          </div>
        </header>

        {/* Notification Toast */}
        {toastMsg && (
          <div className="mx-6 mt-4 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-sm flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Top KPI Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6 pb-2">
          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Tổng Tài Khoản Hệ Thống</div>
            <div className="text-2xl font-bold text-white tabular-nums">{users.length}</div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              {users.filter((u) => u.status === 'active').length} đang hoạt động ·{' '}
              {users.filter((u) => u.role === 'vip').length} VIP
            </div>
          </div>

          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Tỷ Giá & Giá Tải Hiện Tại</div>
            <div className="text-2xl font-bold text-amber-400 tabular-nums">
              {config.creditPer10kVnd} 💎 / 10k
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              Phí: {config.costPerSingleFileCredit} 💎/file · {config.costPerGbCredit} 💎/GB
            </div>
          </div>

          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Doanh Thu Nạp Tiền</div>
            <div className="text-2xl font-bold text-emerald-400 tabular-nums">
              {totalRevenueVnd.toLocaleString()}đ
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              {payments.filter((p) => p.status === 'pending').length} đơn đang chờ duyệt
            </div>
          </div>

          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Tổng Credits Lưu Hành</div>
            <div className="text-2xl font-bold text-indigo-400 tabular-nums">
              {totalCreditsCirculating.toLocaleString()} 💎
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              {history.length} phiên tải hoàn tất
            </div>
          </div>
        </div>

        {/* Section 1: QUẢN LÝ TOÀN BỘ TÀI KHOẢN */}
        {activeSection === 'accounts' && (
          <div className="p-6 space-y-6">
            {/* Add New User Card */}
            <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5">
              <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>Tạo Tài Khoản Mới / Cấp Tiền & Credits Nhanh</span>
              </h2>
              <form
                onSubmit={handleCreateUserSubmit}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end"
              >
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tên đăng nhập *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: khachhang_vip"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="khachhang@gmail.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Mật khẩu</label>
                  <input
                    type="text"
                    placeholder="123456"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Phân quyền (Role)</label>
                  <select
                    aria-label="Phân quyền tài khoản mới"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="user">Member (Thường)</option>
                    <option value="vip">VIP (Ưu đãi giảm giá)</option>
                    <option value="admin">Admin (Quản trị viên)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Số tiền (VNĐ)</label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={newBalanceVnd}
                    onChange={(e) => setNewBalanceVnd(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Credits (💎)</label>
                  <input
                    type="number"
                    min="0"
                    value={newCredits}
                    onChange={(e) => setNewCredits(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Thêm Tài Khoản
                </button>
              </form>
              {createUserError && (
                <p className="text-xs text-red-400 mt-2">{createUserError}</p>
              )}
            </div>

            {/* Accounts Table & Filter Bar */}
            <div className="bg-[#0F172A] border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Tìm kiếm tài khoản"
                    placeholder="Tìm theo username, email, ID..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                  {(['all', 'admin', 'vip', 'user'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRoleFilter(r)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        roleFilter === r
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {r === 'all' ? 'Tất cả' : r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-400 bg-slate-900/50">
                      <th className="py-3 px-4 font-medium">Tài Khoản & Email</th>
                      <th className="py-3 px-4 font-medium">Quyền & Trạng Thái</th>
                      <th className="py-3 px-4 font-medium">Điều Chỉnh Tiền (VNĐ)</th>
                      <th className="py-3 px-4 font-medium">Điều Chỉnh Credits (💎)</th>
                      <th className="py-3 px-4 font-medium text-right">Thống Kê</th>
                      <th className="py-3 px-4 font-medium text-right">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-sm">
                    {filteredUsers.map((u) => {
                      const currentCreditVal =
                        creditInputs[u.id] !== undefined ? creditInputs[u.id] : String(u.credits);
                      const userMoney = u.balanceVnd ?? u.totalDepositedVnd ?? 0;
                      const currentMoneyVal =
                        moneyInputs[u.id] !== undefined ? moneyInputs[u.id] : String(userMoney);
                      return (
                        <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white">{u.username}</div>
                            <div className="text-xs text-slate-400">{u.email}</div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <select
                                aria-label={`Phân quyền cho ${u.username}`}
                                value={u.role}
                                onChange={(e) =>
                                  adminUpdateUser(u.id, { role: e.target.value as UserRole })
                                }
                                className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500"
                              >
                                <option value="user">USER</option>
                                <option value="vip">VIP</option>
                                <option value="admin">ADMIN</option>
                              </select>

                              <button
                                type="button"
                                onClick={() =>
                                  adminUpdateUser(u.id, {
                                    status: u.status === 'active' ? 'banned' : 'active',
                                  })
                                }
                                className={`inline-flex items-center gap-1 text-xs font-medium cursor-pointer whitespace-nowrap ${
                                  u.status === 'active' ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {u.status === 'active' ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Hoạt động
                                  </>
                                ) : (
                                  <>
                                    <Ban className="w-3.5 h-3.5" /> Đã khóa
                                  </>
                                )}
                              </button>
                            </div>
                          </td>

                          {/* Điều Chỉnh Tiền (VNĐ) */}
                          <td className="py-3.5 px-4">
                            <div className="text-xs font-mono font-bold text-emerald-400 mb-1.5 tabular-nums">
                              Số tiền: {userMoney.toLocaleString()} VNĐ
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <input
                                type="number"
                                step="1000"
                                aria-label={`Số tiền VNĐ mới cho ${u.username}`}
                                value={currentMoneyVal}
                                onChange={(e) =>
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [u.id]: e.target.value,
                                  }))
                                }
                                className="w-28 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono tabular-nums"
                              />
                              <button
                                type="button"
                                onClick={() => handleSetUserExactMoney(u.id, u.username)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium cursor-pointer whitespace-nowrap"
                              >
                                Set Tiền
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  adminAdjustBalanceVnd(u.id, 50000, false);
                                  showToast(`Đã cộng +50,000 VNĐ cho ${u.username}`);
                                }}
                                className="px-2 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded text-xs font-mono cursor-pointer whitespace-nowrap"
                              >
                                +50k
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  adminAdjustBalanceVnd(u.id, -20000, false);
                                  showToast(`Đã trừ 20,000 VNĐ của ${u.username}`);
                                }}
                                className="px-2 py-1 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 rounded text-xs font-mono cursor-pointer whitespace-nowrap"
                              >
                                -20k
                              </button>
                            </div>
                          </td>

                          {/* Điều Chỉnh Credits (💎) */}
                          <td className="py-3.5 px-4">
                            <div className="text-xs font-mono font-bold text-amber-400 mb-1.5 tabular-nums">
                              Số dư: {u.credits.toLocaleString()} 💎
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <input
                                type="number"
                                aria-label={`Số dư Credits mới cho ${u.username}`}
                                value={currentCreditVal}
                                onChange={(e) =>
                                  setCreditInputs((prev) => ({
                                    ...prev,
                                    [u.id]: e.target.value,
                                  }))
                                }
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono tabular-nums"
                              />
                              <button
                                type="button"
                                onClick={() => handleSetUserExactCredits(u.id, u.username)}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium cursor-pointer whitespace-nowrap"
                              >
                                Set 💎
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  adminAdjustCredits(u.id, 50);
                                  showToast(`Đã cộng +50 Credits cho ${u.username}`);
                                }}
                                className="px-2 py-1 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 rounded text-xs font-mono cursor-pointer"
                              >
                                +50
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  adminAdjustCredits(u.id, -10);
                                  showToast(`Đã trừ 10 Credits của ${u.username}`);
                                }}
                                className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded text-xs font-mono cursor-pointer"
                              >
                                -10
                              </button>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right text-xs text-slate-400 tabular-nums">
                            <div className="text-slate-200 font-medium">
                              Tổng nạp: {u.totalDepositedVnd.toLocaleString()}đ
                            </div>
                            <div>Đã tải: {u.totalDownloadedFiles} files</div>
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                adminDeleteUser(u.id);
                                showToast(`Đã xóa tài khoản ${u.username}`);
                              }}
                              aria-label={`Xóa tài khoản ${u.username}`}
                              className="p-1.5 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Section 2: SET GIÁ & GÓI CƯỚC VIP */}
        {activeSection === 'pricing' && (
          <div className="p-6 space-y-6">
            {/* Global Credit & Download Rate Configuration */}
            <form
              onSubmit={handleSaveRates}
              className="bg-[#0F172A] border border-slate-800 rounded-xl p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Thiết Lập Đơn Giá Tải File & Tỷ Giá Quy Đổi Credits
                  </h2>
                  <p className="text-xs text-slate-400">
                    Thay đổi tại đây sẽ áp dụng ngay lập tức cho tính năng tải file và trang nạp tiền
                    của người dùng.
                  </p>
                </div>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Save className="w-4 h-4" />
                  <span>Lưu Bảng Giá</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Số Credits nhận được mỗi 10,000 VNĐ
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={rateForm.creditPer10kVnd}
                    onChange={(e) =>
                      setRateForm({ ...rateForm, creditPer10kVnd: Number(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Số tiền nạp tối thiểu (VNĐ)
                  </label>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={rateForm.minTopupVnd}
                    onChange={(e) =>
                      setRateForm({ ...rateForm, minTopupVnd: Number(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Credits tặng miễn phí khi đăng ký mới
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={rateForm.defaultSignupCredits}
                    onChange={(e) =>
                      setRateForm({ ...rateForm, defaultSignupCredits: Number(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Giá tải mỗi File lẻ (Credits / File)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={rateForm.costPerSingleFileCredit}
                    onChange={(e) =>
                      setRateForm({
                        ...rateForm,
                        costPerSingleFileCredit: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Giá tính theo dung lượng (Credits / GB)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={rateForm.costPerGbCredit}
                    onChange={(e) =>
                      setRateForm({ ...rateForm, costPerGbCredit: Number(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Chiết khấu ưu đãi cho tài khoản VIP (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={rateForm.vipDiscountPercent}
                    onChange={(e) =>
                      setRateForm({ ...rateForm, vipDiscountPercent: Number(e.target.value) })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono tabular-nums"
                  />
                </div>
              </div>
            </form>

            {/* VIP Packages Editor */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: Create / Edit Package Form */}
              <form
                onSubmit={handleSavePackage}
                className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 space-y-4 lg:col-span-1"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white">
                    {editingPkg ? `Sửa: ${editingPkg.name}` : 'Thêm Gói Cước VIP Mới'}
                  </h3>
                  {editingPkg && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPkg(null);
                        setPkgName('');
                      }}
                      className="text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      Hủy sửa
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tên gói cước *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Gói Studio Pro"
                    value={pkgName}
                    onChange={(e) => setPkgName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nhóm khách hàng mục tiêu</label>
                  <input
                    type="text"
                    placeholder="VD: Cho Editor & Filmmaker"
                    value={pkgAudience}
                    onChange={(e) => setPkgAudience(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Giá tiền (VNĐ)</label>
                    <input
                      type="number"
                      min="1000"
                      step="1000"
                      value={pkgPrice}
                      onChange={(e) => setPkgPrice(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Credits gốc</label>
                    <input
                      type="number"
                      min="1"
                      value={pkgCredits}
                      onChange={(e) => setPkgCredits(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Credits thưởng (+)</label>
                    <input
                      type="number"
                      min="0"
                      value={pkgBonus}
                      onChange={(e) => setPkgBonus(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Max File Size (GB)</label>
                    <input
                      type="number"
                      min="1"
                      value={pkgMaxGb}
                      onChange={(e) => setPkgMaxGb(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Mô tả quyền lợi gói</label>
                  <textarea
                    rows={2}
                    value={pkgDesc}
                    onChange={(e) => setPkgDesc(e.target.value)}
                    placeholder="Băng thông 10Gbps, ưu tiên tải..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pkgPopular}
                    onChange={(e) => setPkgPopular(e.target.checked)}
                    className="rounded accent-indigo-500"
                  />
                  <span>Đánh dấu là gói Phổ biến nhất (Highlight)</span>
                </label>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
                >
                  {editingPkg ? 'Cập Nhật Gói Cước' : '+ Lưu Gói Cước Mới'}
                </button>
              </form>

              {/* Right: Existing Packages List */}
              <div className="lg:col-span-2 space-y-4">
                {config.packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h4 className="text-base font-bold text-white">{pkg.name}</h4>
                        {pkg.popular && (
                          <span className="text-xs text-amber-400 font-medium inline-flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5" /> Nổi bật
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{pkg.targetAudience}</p>
                      <p className="text-xs text-slate-300 mt-2">{pkg.description}</p>
                      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-400 tabular-nums">
                        <span>
                          Giá bán:{' '}
                          <strong className="text-emerald-400 text-sm">
                            {pkg.priceVnd.toLocaleString()} VNĐ
                          </strong>
                        </span>
                        <span>·</span>
                        <span>
                          Credits: <strong className="text-white">{pkg.credits} 💎</strong> (+
                          <strong className="text-amber-400">{pkg.bonusCredits} 💎 thưởng</strong>)
                        </span>
                        <span>·</span>
                        <span>Tối đa: {pkg.maxFileSizeGb} GB/file</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditPackage(pkg)}
                        className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white cursor-pointer"
                      >
                        Chỉnh sửa giá
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deletePricingPackage(pkg.id);
                          showToast(`Đã xóa gói ${pkg.name}`);
                        }}
                        aria-label={`Xóa gói ${pkg.name}`}
                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Section 3: CHỈNH SỬA TOÀN BỘ HỆ THỐNG */}
        {activeSection === 'system' && (
          <form onSubmit={handleSaveSystemConfig} className="p-6 space-y-6">
            <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Chỉnh Sửa Thương Hiệu, Giao Diện Trang Chủ & Máy Chủ
                  </h2>
                  <p className="text-xs text-slate-400">
                    Toàn bộ nội dung chữ, tên thương hiệu (LKimLamDrive), thông số thống kê, ngân
                    hàng VietQR và trạng thái bảo trì.
                  </p>
                </div>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Save className="w-4 h-4" />
                  <span>Lưu Toàn Bộ Hệ Thống</span>
                </button>
              </div>

              {/* Brand & Hero Text */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Tên thương hiệu (Brand Name)
                  </label>
                  <input
                    type="text"
                    value={sysForm.brandName}
                    onChange={(e) => setSysForm({ ...sysForm, brandName: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nhãn Hero (Badge)</label>
                  <input
                    type="text"
                    value={sysForm.heroBadge}
                    onChange={(e) => setSysForm({ ...sysForm, heroBadge: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nút hành động chính (CTA)</label>
                  <input
                    type="text"
                    value={sysForm.ctaButtonText}
                    onChange={(e) => setSysForm({ ...sysForm, ctaButtonText: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tiêu đề chính (Phần 1)</label>
                  <input
                    type="text"
                    value={sysForm.heroTitlePrefix}
                    onChange={(e) => setSysForm({ ...sysForm, heroTitlePrefix: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Tiêu đề chính (Phần in đậm Gradient)
                  </label>
                  <input
                    type="text"
                    value={sysForm.heroTitleHighlight}
                    onChange={(e) =>
                      setSysForm({ ...sysForm, heroTitleHighlight: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Placeholder ô nhập link</label>
                  <input
                    type="text"
                    value={sysForm.inputPlaceholder}
                    onChange={(e) => setSysForm({ ...sysForm, inputPlaceholder: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div className="md:col-span-2 lg:col-span-3">
                  <label className="block text-xs text-slate-400 mb-1">Mô tả phụ dưới tiêu đề</label>
                  <input
                    type="text"
                    value={sysForm.heroSubtitle}
                    onChange={(e) => setSysForm({ ...sysForm, heroSubtitle: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white"
                  />
                </div>
              </div>

              {/* 3 Hero Metrics */}
              <div className="pt-4 border-t border-slate-800">
                <h3 className="text-sm font-semibold text-white mb-3">
                  Chỉ Số Thống Kê Trang Chủ (3 Cột)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sysForm.stat1Value}
                      onChange={(e) => setSysForm({ ...sysForm, stat1Value: e.target.value })}
                      className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-bold"
                    />
                    <input
                      type="text"
                      value={sysForm.stat1Label}
                      onChange={(e) => setSysForm({ ...sysForm, stat1Label: e.target.value })}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sysForm.stat2Value}
                      onChange={(e) => setSysForm({ ...sysForm, stat2Value: e.target.value })}
                      className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-bold"
                    />
                    <input
                      type="text"
                      value={sysForm.stat2Label}
                      onChange={(e) => setSysForm({ ...sysForm, stat2Label: e.target.value })}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sysForm.stat3Value}
                      onChange={(e) => setSysForm({ ...sysForm, stat3Value: e.target.value })}
                      className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-bold"
                    />
                    <input
                      type="text"
                      value={sysForm.stat3Label}
                      onChange={(e) => setSysForm({ ...sysForm, stat3Label: e.target.value })}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
              </div>

              {/* VietQR & Bank Account Settings */}
              <div className="pt-4 border-t border-slate-800">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-indigo-400" />
                  <span>Cấu Hình Ngân Hàng Nhận Tiền Tự Động (VietQR / SePay)</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tên Ngân Hàng</label>
                    <input
                      type="text"
                      value={sysForm.bankName}
                      onChange={(e) => setSysForm({ ...sysForm, bankName: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Số Tài Khoản</label>
                    <input
                      type="text"
                      value={sysForm.bankAccountNo}
                      onChange={(e) => setSysForm({ ...sysForm, bankAccountNo: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Chủ Tài Khoản</label>
                    <input
                      type="text"
                      value={sysForm.bankAccountName}
                      onChange={(e) => setSysForm({ ...sysForm, bankAccountName: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Cú pháp nội dung CK (Prefix)
                    </label>
                    <input
                      type="text"
                      value={sysForm.transferPrefix}
                      onChange={(e) => setSysForm({ ...sysForm, transferPrefix: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Server Proxy & Maintenance Controls */}
              <div className="pt-4 border-t border-slate-800">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Cụm Máy Chủ Proxy VIP & Chế Độ Bảo Trì</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Cụm Proxy Google Drive Đang Chạy
                    </label>
                    <select
                      aria-label="Cụm máy chủ Proxy"
                      value={sysForm.activeProxyRegion}
                      onChange={(e) =>
                        setSysForm({ ...sysForm, activeProxyRegion: e.target.value })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {config.proxyRegions.map((reg) => (
                        <option key={reg} value={reg}>
                          {reg}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">
                      Thông báo chạy ngang đầu trang (Để trống nếu muốn ẩn)
                    </label>
                    <input
                      type="text"
                      placeholder="VD: Khuyến mãi +20% Credits khi nạp qua VietQR hôm nay!"
                      value={sysForm.announcementBanner}
                      onChange={(e) =>
                        setSysForm({ ...sysForm, announcementBanner: e.target.value })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div className="mt-4 p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <label className="flex items-center gap-2.5 text-sm font-semibold text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sysForm.maintenanceMode}
                        onChange={(e) =>
                          setSysForm({ ...sysForm, maintenanceMode: e.target.checked })
                        }
                        className="w-4 h-4 rounded accent-amber-500"
                      />
                      <span>Bật Chế Độ Bảo Trì Hệ Thống (Chỉ Admin được phép tải file)</span>
                    </label>
                    <p className="text-xs text-slate-400 mt-1">
                      Khi bật, người dùng thường sẽ thấy thông báo bảo trì khi bấm Tiến Hành.
                    </p>
                  </div>

                  <input
                    type="text"
                    value={sysForm.maintenanceMessage}
                    onChange={(e) =>
                      setSysForm({ ...sysForm, maintenanceMessage: e.target.value })
                    }
                    className="w-full sm:w-96 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
            </div>
          </form>
        )}

        {/* Section 4: DUYỆT NẠP TIỀN & LỊCH SỬ TẢI TOÀN HỆ THỐNG */}
        {activeSection === 'transactions' && (
          <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: All Payment Orders */}
            <div className="bg-[#0F172A] border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-semibold text-white">Quản Lý Giao Dịch Nạp Tiền</h3>
                <span className="text-xs text-slate-400 tabular-nums">
                  {payments.length} giao dịch
                </span>
              </div>
              <div className="divide-y divide-slate-800 max-h-[540px] overflow-y-auto">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="p-4 flex items-center justify-between gap-3 hover:bg-slate-800/30 tabular-nums"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">{p.username}</span>
                        <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                          {p.transactionCode}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Số tiền:{' '}
                        <strong className="text-emerald-400">{p.amount.toLocaleString()}đ</strong> →{' '}
                        <strong className="text-white">+{p.credits} 💎</strong> ·{' '}
                        {new Date(p.createdAt).toLocaleString('vi-VN')}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {p.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              confirmPaymentOrder(p.id);
                              showToast(
                                `Đã duyệt đơn ${p.transactionCode} (+${p.credits} Credits cho ${p.username})`
                              );
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                          >
                            Duyệt Cộng Tiền
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelPaymentOrder(p.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs cursor-pointer"
                          >
                            Hủy
                          </button>
                        </>
                      ) : (
                        <span
                          className={`text-xs font-medium ${
                            p.status === 'completed' ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          {p.status === 'completed' ? 'Đã hoàn thành' : 'Đã hủy'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: All System Download Logs */}
            <div className="bg-[#0F172A] border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-semibold text-white">Nhật Ký Tải File Toàn Hệ Thống</h3>
                <span className="text-xs text-slate-400 tabular-nums">
                  {history.length} lượt tải
                </span>
              </div>
              <div className="divide-y divide-slate-800 max-h-[540px] overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="p-4 hover:bg-slate-800/30 tabular-nums">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-indigo-400">{h.username}</span>
                      <span className="text-xs text-slate-400">
                        {new Date(h.createdAt).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-white truncate">{h.fileName}</div>
                    <div className="flex items-center justify-between text-xs text-slate-400 mt-1.5">
                      <span>
                        {h.fileType.toUpperCase()} · {h.sizeFormatted}
                      </span>
                      <span className="text-amber-400 font-semibold">-{h.creditsUsed} 💎</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Section 5: TRUNG TÂM CHỐNG DDOS, RATE LIMITING & GMAIL OTP */}
        {activeSection === 'security' && <SecurityDdosPanel onToast={showToast} />}
      </div>
    </div>
  );
};
