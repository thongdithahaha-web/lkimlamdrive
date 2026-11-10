import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  SystemConfig,
  DEFAULT_SYSTEM_CONFIG,
  UserAccount,
  DownloadHistoryItem,
  PaymentTransaction,
  PricingPackage,
  calculateTopupCredits,
} from '../utils/systemRules';
import { signInWithGooglePopup, auth } from '../firebase';

const STORAGE_KEYS = {
  CONFIG: 'lkimlamdrive_system_config_v2',
  USERS: 'lkimlamdrive_users_v2',
  CURRENT_USER_ID: 'lkimlamdrive_current_user_id_v2',
  HISTORY: 'lkimlamdrive_download_history_v2',
  PAYMENTS: 'lkimlamdrive_payments_v2',
};

const INITIAL_USERS: UserAccount[] = [
  {
    id: 'usr-admin-1',
    username: 'admin',
    email: 'lekimlam2707@gmail.com',
    password: 'admin',
    role: 'admin',
    credits: 9999,
    balanceVnd: 5000000,
    totalDepositedVnd: 5000000,
    totalDownloadedFiles: 412,
    status: 'active',
    emailVerified: true,
    authProvider: 'password',
    createdAt: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 'usr-vip-1',
    username: 'lkimlam_vip',
    email: 'vip@lkimlamdrive.vn',
    password: '123456',
    role: 'vip',
    credits: 280,
    balanceVnd: 250000,
    totalDepositedVnd: 250000,
    totalDownloadedFiles: 84,
    status: 'active',
    emailVerified: true,
    authProvider: 'password',
    createdAt: '2026-10-15T10:30:00.000Z',
  },
  {
    id: 'usr-member-1',
    username: 'nguyenvana',
    email: 'nguyenvana@gmail.com',
    password: '123456',
    role: 'user',
    credits: 45,
    balanceVnd: 50000,
    totalDepositedVnd: 50000,
    totalDownloadedFiles: 19,
    status: 'active',
    emailVerified: true,
    authProvider: 'password',
    createdAt: '2026-10-28T14:20:00.000Z',
  },
  {
    id: 'usr-member-2',
    username: 'tranthib',
    email: 'tranthib@designer.vn',
    password: '123456',
    role: 'user',
    credits: 12,
    balanceVnd: 20000,
    totalDepositedVnd: 20000,
    totalDownloadedFiles: 8,
    status: 'active',
    emailVerified: true,
    authProvider: 'password',
    createdAt: '2026-11-02T09:15:00.000Z',
  },
  {
    id: 'usr-banned-1',
    username: 'spammer_bot',
    email: 'bot99@temp.org',
    password: '123456',
    role: 'user',
    credits: 0,
    balanceVnd: 0,
    totalDepositedVnd: 0,
    totalDownloadedFiles: 2,
    status: 'banned',
    emailVerified: false,
    authProvider: 'password',
    createdAt: '2026-11-05T19:45:00.000Z',
  },
];

const INITIAL_HISTORY: DownloadHistoryItem[] = [
  {
    id: 'hist-101',
    userId: 'usr-admin-1',
    username: 'admin',
    fileName: 'Adobe_Master_Collection_2026_Full_PreActivated.iso',
    driveUrl: 'https://drive.google.com/file/d/19xK8LmN2pQ4rS6tU8vW0yZ/view',
    fileType: 'file',
    fileCount: 1,
    sizeFormatted: '18.40 GB',
    creditsUsed: 0,
    status: 'completed',
    destinationFolderLink: 'https://drive.google.com/drive/folders/1LKLD_VIP_Proxy_Output_101',
    createdAt: '2026-11-09T14:22:10.000Z',
  },
  {
    id: 'hist-102',
    userId: 'usr-vip-1',
    username: 'lkimlam_vip',
    fileName: 'Source_Unreal_Engine_5.5_Cinematic_Assets_Pack',
    driveUrl: 'https://drive.google.com/drive/folders/1FolderUE5AssetsPack888',
    fileType: 'folder',
    fileCount: 5,
    sizeFormatted: '9.47 GB',
    creditsUsed: 8,
    status: 'completed',
    destinationFolderLink: 'https://drive.google.com/drive/folders/1LKLD_VIP_Proxy_Output_102',
    createdAt: '2026-11-09T16:05:45.000Z',
  },
  {
    id: 'hist-103',
    userId: 'usr-member-1',
    username: 'nguyenvana',
    fileName: 'MacOS_Sequoia_15.2_Restore_Image_Universal.ipsw',
    driveUrl: 'https://drive.google.com/file/d/1MacOsSequoiaRestoreImg/view',
    fileType: 'file',
    fileCount: 1,
    sizeFormatted: '14.20 GB',
    creditsUsed: 2,
    status: 'completed',
    destinationFolderLink: 'https://drive.google.com/drive/folders/1LKLD_VIP_Proxy_Output_103',
    createdAt: '2026-11-09T18:12:00.000Z',
  },
];

const INITIAL_PAYMENTS: PaymentTransaction[] = [
  {
    id: 'pay-200',
    userId: 'usr-admin-1',
    username: 'admin',
    amount: 500000,
    credits: 500,
    bonusCredits: 200,
    transactionCode: 'LKLD999888',
    bankName: 'MBBank',
    bankAcc: '0987654321999',
    bankAccountName: 'LE KIM LAM',
    status: 'completed',
    createdAt: '2026-11-07T09:00:00.000Z',
  },
  {
    id: 'pay-201',
    userId: 'usr-vip-1',
    username: 'lkimlam_vip',
    amount: 200000,
    credits: 200,
    bonusCredits: 80,
    transactionCode: 'LKLD882910',
    bankName: 'MBBank',
    bankAcc: '0987654321999',
    bankAccountName: 'LE KIM LAM',
    status: 'completed',
    createdAt: '2026-11-08T11:30:00.000Z',
  },
  {
    id: 'pay-202',
    userId: 'usr-member-1',
    username: 'nguyenvana',
    amount: 50000,
    credits: 50,
    bonusCredits: 15,
    transactionCode: 'LKLD551029',
    bankName: 'MBBank',
    bankAcc: '0987654321999',
    bankAccountName: 'LE KIM LAM',
    status: 'completed',
    createdAt: '2026-11-09T09:15:00.000Z',
  },
  {
    id: 'pay-203',
    userId: 'usr-member-2',
    username: 'tranthib',
    amount: 20000,
    credits: 20,
    bonusCredits: 2,
    transactionCode: 'LKLD391044',
    bankName: 'MBBank',
    bankAcc: '0987654321999',
    bankAccountName: 'LE KIM LAM',
    status: 'pending',
    createdAt: '2026-11-09T19:50:00.000Z',
  },
];

interface AppContextValue {
  config: SystemConfig;
  users: UserAccount[];
  currentUser: UserAccount | null;
  history: DownloadHistoryItem[];
  payments: PaymentTransaction[];
  // Auth actions
  login: (usernameOrEmail: string, password?: string) => { success: boolean; error?: string; user?: UserAccount };
  loginWithGoogle: () => Promise<{ success: boolean; error?: string; user?: UserAccount }>;
  checkUserCanRegister: (username: string, email: string) => { ok: boolean; error?: string };
  register: (username: string, email: string, password?: string) => { success: boolean; error?: string; user?: UserAccount };
  resetPasswordByEmail: (email: string, newPassword: string) => { success: boolean; error?: string };
  logout: () => void;
  switchQuickAccount: (userId: string) => void;
  // Admin system config & pricing actions
  updateSystemConfig: (partial: Partial<SystemConfig>) => void;
  resetSystemConfig: () => void;
  savePricingPackage: (pkg: PricingPackage) => void;
  deletePricingPackage: (pkgId: string) => void;
  // Admin user management actions
  adminUpdateUser: (userId: string, updates: Partial<UserAccount>) => void;
  adminAdjustCredits: (userId: string, deltaCredits: number) => void;
  adminAdjustBalanceVnd: (userId: string, deltaVnd: number, autoConvertCredits?: boolean) => void;
  adminCreateUser: (newUser: Omit<UserAccount, 'id' | 'createdAt' | 'totalDepositedVnd' | 'totalDownloadedFiles'>) => {
    success: boolean;
    error?: string;
  };
  adminDeleteUser: (userId: string) => void;
  // Download & Topup actions
  recordDownloadJob: (job: Omit<DownloadHistoryItem, 'id' | 'createdAt'>) => DownloadHistoryItem;
  createPaymentOrder: (amountVnd: number) => {
    success: boolean;
    error?: string;
    payment?: PaymentTransaction;
  };
  confirmPaymentOrder: (paymentId: string) => void;
  cancelPaymentOrder: (paymentId: string) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SystemConfig>(() =>
    loadFromStorage(STORAGE_KEYS.CONFIG, DEFAULT_SYSTEM_CONFIG)
  );
  const [users, setUsers] = useState<UserAccount[]>(() =>
    loadFromStorage(STORAGE_KEYS.USERS, INITIAL_USERS)
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(() =>
    loadFromStorage<string | null>(STORAGE_KEYS.CURRENT_USER_ID, null)
  );
  const [history, setHistory] = useState<DownloadHistoryItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.HISTORY, INITIAL_HISTORY)
  );
  const [payments, setPayments] = useState<PaymentTransaction[]>(() =>
    loadFromStorage(STORAGE_KEYS.PAYMENTS, INITIAL_PAYMENTS)
  );

  // Sync to localStorage and dispatch cross-tab / same-window sync event
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
    } catch {
      // ignore storage quota errors
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch {
      // ignore
    }
  }, [users]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, JSON.stringify(currentUserId));
    } catch {
      // ignore
    }
  }, [currentUserId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));
    } catch {
      // ignore
    }
  }, [payments]);

  // Listen to storage events so changes in /index.html or another tab reflect live
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.CONFIG && e.newValue) {
        setConfig(JSON.parse(e.newValue));
      } else if (e.key === STORAGE_KEYS.USERS && e.newValue) {
        setUsers(JSON.parse(e.newValue));
      } else if (e.key === STORAGE_KEYS.HISTORY && e.newValue) {
        setHistory(JSON.parse(e.newValue));
      } else if (e.key === STORAGE_KEYS.PAYMENTS && e.newValue) {
        setPayments(JSON.parse(e.newValue));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const currentUser = users.find((u) => u.id === currentUserId) || null;

  const login = useCallback(
    (usernameOrEmail: string, password?: string) => {
      const clean = usernameOrEmail.trim().toLowerCase();
      const found = users.find(
        (u) => u.username.toLowerCase() === clean || u.email.toLowerCase() === clean
      );
      if (!found) {
        return { success: false, error: 'Tài khoản không tồn tại trong hệ thống' };
      }
      if (found.status === 'banned') {
        return { success: false, error: 'Tài khoản của bạn đã bị khóa bởi Quản trị viên' };
      }
      if (password && found.password && found.password !== password) {
        return { success: false, error: 'Mật khẩu không chính xác' };
      }
      setCurrentUserId(found.id);
      return { success: true, user: found };
    },
    [users]
  );

  const loginWithGoogle = useCallback(async () => {
    try {
      const googleUser = await signInWithGooglePopup(config.defaultSignupCredits);
      let resolvedUser: UserAccount = googleUser;

      setUsers((prev) => {
        const existingIdx = prev.findIndex(
          (u) =>
            u.id === googleUser.id ||
            u.email.toLowerCase() === googleUser.email.toLowerCase()
        );
        if (existingIdx !== -1) {
          const existing = prev[existingIdx];
          resolvedUser = {
            ...existing,
            emailVerified: true,
            authProvider: 'google',
          };
          const copy = [...prev];
          copy[existingIdx] = resolvedUser;
          return copy;
        }
        return [googleUser, ...prev];
      });

      if (resolvedUser.status === 'banned') {
        return { success: false, error: 'Tài khoản Google này đã bị khóa bởi Quản trị viên' };
      }

      setCurrentUserId(resolvedUser.id);
      return { success: true, user: resolvedUser };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Đăng nhập Google thất bại';
      return {
        success: false,
        error: msg.includes('popup-closed-by-user')
          ? 'Bạn đã đóng cửa sổ đăng nhập Google.'
          : 'Không thể đăng nhập bằng Google. Vui lòng thử lại.',
      };
    }
  }, [config.defaultSignupCredits]);

  const checkUserCanRegister = useCallback(
    (username: string, email: string) => {
      const cleanUser = username.trim();
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanUser || !cleanEmail) {
        return { ok: false, error: 'Vui lòng điền đầy đủ Tên đăng nhập và Gmail' };
      }
      if (!cleanEmail.includes('@')) {
        return { ok: false, error: 'Địa chỉ Gmail không hợp lệ' };
      }
      const existsUser = users.some(
        (u) => u.username.toLowerCase() === cleanUser.toLowerCase()
      );
      if (existsUser) {
        return { ok: false, error: 'Tên đăng nhập này đã được sử dụng' };
      }
      const existsEmail = users.some(
        (u) => u.email.toLowerCase() === cleanEmail
      );
      if (existsEmail) {
        return { ok: false, error: 'Địa chỉ Gmail này đã được đăng ký tài khoản' };
      }
      return { ok: true };
    },
    [users]
  );

  const register = useCallback(
    (username: string, email: string, password?: string) => {
      const cleanUser = username.trim();
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanUser || !cleanEmail) {
        return { success: false, error: 'Vui lòng điền đầy đủ thông tin' };
      }
      const exists = users.some(
        (u) => u.username.toLowerCase() === cleanUser.toLowerCase() || u.email.toLowerCase() === cleanEmail
      );
      if (exists) {
        return { success: false, error: 'Tên đăng nhập hoặc Email đã được sử dụng' };
      }
      const newUser: UserAccount = {
        id: `usr-${Date.now()}`,
        username: cleanUser,
        email: cleanEmail,
        password: password || '123456',
        role: cleanEmail === 'lekimlam2707@gmail.com' ? 'admin' : 'user',
        credits: config.defaultSignupCredits,
        balanceVnd: 0,
        totalDepositedVnd: 0,
        totalDownloadedFiles: 0,
        status: 'active',
        emailVerified: true,
        authProvider: 'password',
        createdAt: new Date().toISOString(),
      };
      setUsers((prev) => [newUser, ...prev]);
      setCurrentUserId(newUser.id);
      return { success: true, user: newUser };
    },
    [users, config.defaultSignupCredits]
  );

  const resetPasswordByEmail = useCallback(
    (email: string, newPassword: string) => {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return { success: false, error: 'Địa chỉ Gmail không hợp lệ' };
      }
      const found = users.find((u) => u.email.toLowerCase() === cleanEmail);
      if (!found) {
        const recoveredUser: UserAccount = {
          id: `usr-${Date.now()}`,
          username: cleanEmail.split('@')[0],
          email: cleanEmail,
          password: newPassword,
          role: cleanEmail === 'lekimlam2707@gmail.com' ? 'admin' : 'user',
          credits: config.defaultSignupCredits,
          balanceVnd: 0,
          totalDepositedVnd: 0,
          totalDownloadedFiles: 0,
          status: 'active',
          emailVerified: true,
          authProvider: 'password',
          createdAt: new Date().toISOString(),
        };
        setUsers((prev) => [recoveredUser, ...prev]);
        return { success: true };
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.email.toLowerCase() === cleanEmail
            ? { ...u, password: newPassword, emailVerified: true }
            : u
        )
      );
      return { success: true };
    },
    [users, config.defaultSignupCredits]
  );

  const logout = useCallback(() => {
    setCurrentUserId(null);
    auth.signOut().catch(() => {});
  }, []);

  const switchQuickAccount = useCallback((userId: string) => {
    setCurrentUserId(userId);
  }, []);

  const updateSystemConfig = useCallback((partial: Partial<SystemConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetSystemConfig = useCallback(() => {
    setConfig(DEFAULT_SYSTEM_CONFIG);
  }, []);

  const savePricingPackage = useCallback((pkg: PricingPackage) => {
    setConfig((prev) => {
      const exists = prev.packages.some((p) => p.id === pkg.id);
      const nextPackages = exists
        ? prev.packages.map((p) => (p.id === pkg.id ? pkg : p))
        : [...prev.packages, pkg];
      return { ...prev, packages: nextPackages };
    });
  }, []);

  const deletePricingPackage = useCallback((pkgId: string) => {
    setConfig((prev) => ({
      ...prev,
      packages: prev.packages.filter((p) => p.id !== pkgId),
    }));
  }, []);

  const adminUpdateUser = useCallback((userId: string, updates: Partial<UserAccount>) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...updates } : u)));
  }, []);

  const adminAdjustCredits = useCallback((userId: string, deltaCredits: number) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, credits: Math.max(0, u.credits + deltaCredits) } : u
      )
    );
  }, []);

  const adminAdjustBalanceVnd = useCallback((userId: string, deltaVnd: number, isSetAbsolute = false) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        const currentVnd = u.balanceVnd ?? u.totalDepositedVnd ?? 0;
        const nextVnd = isSetAbsolute ? Math.max(0, deltaVnd) : Math.max(0, currentVnd + deltaVnd);
        const diff = nextVnd - currentVnd;
        return {
          ...u,
          balanceVnd: nextVnd,
          totalDepositedVnd: diff > 0 ? u.totalDepositedVnd + diff : u.totalDepositedVnd,
        };
      })
    );
  }, []);

  const adminCreateUser = useCallback(
    (newUser: Omit<UserAccount, 'id' | 'createdAt' | 'totalDepositedVnd' | 'totalDownloadedFiles'>) => {
      const cleanUser = newUser.username.trim();
      if (!cleanUser) {
        return { success: false, error: 'Tên tài khoản không được để trống' };
      }
      if (users.some((u) => u.username.toLowerCase() === cleanUser.toLowerCase())) {
        return { success: false, error: 'Tên đăng nhập đã tồn tại' };
      }
      const created: UserAccount = {
        ...newUser,
        username: cleanUser,
        id: `usr-${Date.now()}`,
        balanceVnd: newUser.balanceVnd ?? 0,
        totalDepositedVnd: newUser.balanceVnd ?? 0,
        totalDownloadedFiles: 0,
        emailVerified: true,
        authProvider: 'password',
        createdAt: new Date().toISOString(),
      };
      setUsers((prev) => [created, ...prev]);
      return { success: true };
    },
    [users]
  );

  const adminDeleteUser = useCallback((userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  }, []);

  const recordDownloadJob = useCallback(
    (job: Omit<DownloadHistoryItem, 'id' | 'createdAt'>) => {
      const newItem: DownloadHistoryItem = {
        ...job,
        id: `hist-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      setHistory((prev) => [newItem, ...prev]);
      if (job.creditsUsed > 0 || job.fileCount > 0) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === job.userId
              ? {
                  ...u,
                  credits: Math.max(0, u.credits - job.creditsUsed),
                  totalDownloadedFiles: u.totalDownloadedFiles + job.fileCount,
                }
              : u
          )
        );
      }
      return newItem;
    },
    []
  );

  const createPaymentOrder = useCallback(
    (amountVnd: number) => {
      if (!currentUser) {
        return { success: false, error: 'Vui lòng đăng nhập để tạo giao dịch' };
      }
      if (!Number.isFinite(amountVnd) || amountVnd < config.minTopupVnd) {
        return {
          success: false,
          error: `Số tiền nạp tối thiểu là ${config.minTopupVnd.toLocaleString()} VNĐ`,
        };
      }
      const calc = calculateTopupCredits(amountVnd, config);
      const randomDigits = Math.floor(100000 + Math.random() * 900000);
      const payment: PaymentTransaction = {
        id: `pay-${Date.now()}`,
        userId: currentUser.id,
        username: currentUser.username,
        amount: amountVnd,
        credits: calc.totalCredits,
        bonusCredits: calc.bonusCredits,
        transactionCode: `${config.transferPrefix}${randomDigits}`,
        bankName: config.bankName,
        bankAcc: config.bankAccountNo,
        bankAccountName: config.bankAccountName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      setPayments((prev) => [payment, ...prev]);
      return { success: true, payment };
    },
    [currentUser, config]
  );

  const confirmPaymentOrder = useCallback((paymentId: string) => {
    setPayments((prev) => {
      const target = prev.find((p) => p.id === paymentId);
      if (!target || target.status === 'completed') return prev;

      setUsers((uPrev) =>
        uPrev.map((u) =>
          u.id === target.userId
            ? {
                ...u,
                credits: u.credits + target.credits,
                balanceVnd: (u.balanceVnd ?? u.totalDepositedVnd ?? 0) + target.amount,
                totalDepositedVnd: u.totalDepositedVnd + target.amount,
              }
            : u
        )
      );

      return prev.map((p) => (p.id === paymentId ? { ...p, status: 'completed' } : p));
    });
  }, []);

  const cancelPaymentOrder = useCallback((paymentId: string) => {
    setPayments((prev) =>
      prev.map((p) => (p.id === paymentId ? { ...p, status: 'cancelled' } : p))
    );
  }, []);

  return (
    <AppContext.Provider
      value={{
        config,
        users,
        currentUser,
        history,
        payments,
        login,
        loginWithGoogle,
        checkUserCanRegister,
        register,
        resetPasswordByEmail,
        logout,
        switchQuickAccount,
        updateSystemConfig,
        resetSystemConfig,
        savePricingPackage,
        deletePricingPackage,
        adminUpdateUser,
        adminAdjustCredits,
        adminAdjustBalanceVnd,
        adminCreateUser,
        adminDeleteUser,
        recordDownloadJob,
        createPaymentOrder,
        confirmPaymentOrder,
        cancelPaymentOrder,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppStore must be used within AppProvider');
  }
  return ctx;
}
