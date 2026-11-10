export interface PricingPackage {
  id: string;
  name: string;
  targetAudience: string;
  priceVnd: number;
  credits: number;
  bonusCredits: number;
  maxFileSizeGb: number;
  popular?: boolean;
  description: string;
}

export interface SystemConfig {
  brandName: string;
  heroBadge: string;
  heroTitlePrefix: string;
  heroTitleHighlight: string;
  heroSubtitle: string;
  inputPlaceholder: string;
  ctaButtonText: string;
  stat1Value: string;
  stat1Label: string;
  stat2Value: string;
  stat2Label: string;
  stat3Value: string;
  stat3Label: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  announcementBanner: string;
  // Pricing & Credit rules
  creditPer10kVnd: number;
  minTopupVnd: number;
  defaultSignupCredits: number;
  costPerSingleFileCredit: number;
  costPerGbCredit: number;
  vipDiscountPercent: number;
  // Bank / VietQR config
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  transferPrefix: string;
  // Proxy / Drive Engine config
  proxyRegions: string[];
  activeProxyRegion: string;
  maxConcurrentJobs: number;
  // Gmail SMTP / Auth Notification config
  smtpEmail?: string;
  smtpAppPassword?: string;
  packages: PricingPackage[];
}

export type UserRole = 'admin' | 'vip' | 'user';
export type AccountStatus = 'active' | 'banned';

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  password?: string;
  role: UserRole;
  credits: number;
  balanceVnd?: number;
  totalDepositedVnd: number;
  totalDownloadedFiles: number;
  status: AccountStatus;
  emailVerified?: boolean;
  authProvider?: 'google' | 'password';
  createdAt: string;
}

export interface DriveFileItem {
  id: string;
  name: string;
  sizeBytes: number;
  sizeFormatted: string;
  mimeType: string;
  credits: number;
}

export interface DownloadHistoryItem {
  id: string;
  userId: string;
  username: string;
  fileName: string;
  driveUrl: string;
  fileType: 'file' | 'folder';
  fileCount: number;
  sizeFormatted: string;
  creditsUsed: number;
  status: 'completed' | 'processing' | 'error';
  destinationFolderLink: string;
  createdAt: string;
}

export interface PaymentTransaction {
  id: string;
  userId: string;
  username: string;
  amount: number;
  credits: number;
  bonusCredits: number;
  transactionCode: string;
  bankName: string;
  bankAcc: string;
  bankAccountName: string;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
}

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  brandName: 'LKIMLAMDRIVE',
  heroBadge: 'Hệ thống Get Link VIP',
  heroTitlePrefix: 'Tải File Drive ',
  heroTitleHighlight: 'Không Giới Hạn',
  heroSubtitle:
    'Hệ thống proxy download an toàn, vượt qua mọi giới hạn tải xuống của Google Drive. Tốc độ cực nhanh, bảo mật 100%.',
  inputPlaceholder: 'https://drive.google.com/file/d/.../view',
  ctaButtonText: 'Tiến Hành',
  stat1Value: '100K+',
  stat1Label: 'File Đã Tải',
  stat2Value: '99.9%',
  stat2Label: 'Thành Công',
  stat3Value: '24/7',
  stat3Label: 'Hoạt Động',
  maintenanceMode: false,
  maintenanceMessage: 'Hệ thống LKimLamDrive đang bảo trì nâng cấp máy chủ Proxy VIP. Vui lòng quay lại sau ít phút.',
  announcementBanner: '',
  creditPer10kVnd: 10,
  minTopupVnd: 10000,
  defaultSignupCredits: 5,
  costPerSingleFileCredit: 1,
  costPerGbCredit: 1,
  vipDiscountPercent: 20,
  bankName: 'MBBank',
  bankAccountNo: '0987654321999',
  bankAccountName: 'LE KIM LAM',
  transferPrefix: 'LKLD',
  proxyRegions: ['Singapore VIP-01 (10Gbps)', 'Tokyo High-Speed-02 (10Gbps)', 'Vietnam Direct-VNPT (5Gbps)'],
  activeProxyRegion: 'Singapore VIP-01 (10Gbps)',
  maxConcurrentJobs: 50,
  packages: [
    {
      id: 'pkg-starter',
      name: 'Gói Cơ Bản',
      targetAudience: 'Cho nhu cầu tải lẻ cá nhân',
      priceVnd: 20000,
      credits: 20,
      bonusCredits: 2,
      maxFileSizeGb: 25,
      popular: false,
      description: 'Tải nhanh file lẻ và thư mục nhỏ qua cụm máy chủ Singapore VIP.',
    },
    {
      id: 'pkg-pro',
      name: 'Gói VIP Pro',
      targetAudience: 'Cho Designer, Editor & Studio',
      priceVnd: 50000,
      credits: 50,
      bonusCredits: 15,
      maxFileSizeGb: 100,
      popular: true,
      description: 'Băng thông ưu tiên 10Gbps, vượt mọi giới hạn quota 24h cho file nặng.',
    },
    {
      id: 'pkg-enterprise',
      name: 'Gói Doanh Nghiệp',
      targetAudience: 'Cho đội nhóm & hệ thống lưu trữ lớn',
      priceVnd: 200000,
      credits: 200,
      bonusCredits: 80,
      maxFileSizeGb: 500,
      popular: false,
      description: 'Tự động clone toàn bộ Folder sang Drive cá nhân, hỗ trợ API & ưu tiên luồng.',
    },
  ],
};

/**
 * Pure calculation for converting VND deposit amount into base credits and bonus credits
 */
export function calculateTopupCredits(
  amountVnd: number,
  config: Pick<SystemConfig, 'creditPer10kVnd' | 'minTopupVnd' | 'packages'>
): { baseCredits: number; bonusCredits: number; totalCredits: number; matchedPackage: PricingPackage | null } {
  if (!Number.isFinite(amountVnd) || amountVnd < config.minTopupVnd) {
    return { baseCredits: 0, bonusCredits: 0, totalCredits: 0, matchedPackage: null };
  }

  const baseCredits = Math.floor(amountVnd / 10000) * config.creditPer10kVnd;

  // Find highest tier package whose priceVnd <= amountVnd
  const sortedPackages = [...(config.packages || [])].sort((a, b) => b.priceVnd - a.priceVnd);
  const matchedPackage = sortedPackages.find((pkg) => amountVnd >= pkg.priceVnd) || null;

  let bonusCredits = 0;
  if (matchedPackage && matchedPackage.priceVnd > 0) {
    const multiplier = Math.floor(amountVnd / matchedPackage.priceVnd);
    bonusCredits = multiplier * matchedPackage.bonusCredits;
  }

  return {
    baseCredits,
    bonusCredits,
    totalCredits: baseCredits + bonusCredits,
    matchedPackage,
  };
}

/**
 * Pure parser for Google Drive file or folder links
 */
export function parseDriveUrl(rawUrl: string): {
  isValid: boolean;
  type: 'file' | 'folder' | 'unknown';
  resourceId: string;
  normalizedUrl: string;
} {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { isValid: false, type: 'unknown', resourceId: '', normalizedUrl: '' };
  }

  // Match folder pattern
  const folderMatch =
    trimmed.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{8,})/) ||
    trimmed.match(/\/folders\/([a-zA-Z0-9_-]{8,})/);
  if (folderMatch) {
    const id = folderMatch[1];
    return {
      isValid: true,
      type: 'folder',
      resourceId: id,
      normalizedUrl: `https://drive.google.com/drive/folders/${id}`,
    };
  }

  // Match file pattern
  const fileMatch =
    trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{8,})/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]{8,})/) ||
    trimmed.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]{8,})/);
  if (fileMatch) {
    const id = fileMatch[1];
    return {
      isValid: true,
      type: 'file',
      resourceId: id,
      normalizedUrl: `https://drive.google.com/file/d/${id}/view`,
    };
  }

  // Allow any URL containing drive.google.com or docs.google.com with a plausible ID
  if (trimmed.includes('drive.google.com') || trimmed.includes('docs.google.com')) {
    const fallbackId = trimmed.replace(/[^a-zA-Z0-9]/g, '').slice(-16) || 'drive_item_01';
    return {
      isValid: true,
      type: trimmed.includes('folder') ? 'folder' : 'file',
      resourceId: fallbackId,
      normalizedUrl: trimmed,
    };
  }

  return { isValid: false, type: 'unknown', resourceId: '', normalizedUrl: trimmed };
}

/**
 * Pure calculation for download credit cost based on selected files, user role, and system pricing
 */
export function calculateDownloadCost(
  files: Pick<DriveFileItem, 'id' | 'sizeBytes' | 'credits'>[],
  selectedIds: Set<string> | string[],
  config: Pick<SystemConfig, 'costPerSingleFileCredit' | 'costPerGbCredit' | 'vipDiscountPercent'>,
  userRole: UserRole = 'user'
): { rawCredits: number; finalCredits: number; discountApplied: number } {
  const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  let rawCredits = 0;

  for (const file of files) {
    if (selectedSet.has(file.id)) {
      const sizeGb = file.sizeBytes / (1024 * 1024 * 1024);
      const fileCost = Math.max(
        config.costPerSingleFileCredit,
        Math.ceil(sizeGb * config.costPerGbCredit)
      );
      rawCredits += fileCost;
    }
  }

  if (rawCredits === 0) {
    return { rawCredits: 0, finalCredits: 0, discountApplied: 0 };
  }

  if (userRole === 'admin') {
    return { rawCredits, finalCredits: 0, discountApplied: rawCredits };
  }

  if (userRole === 'vip' && config.vipDiscountPercent > 0) {
    const discounted = Math.max(
      1,
      Math.floor(rawCredits * ((100 - config.vipDiscountPercent) / 100))
    );
    return {
      rawCredits,
      finalCredits: discounted,
      discountApplied: rawCredits - discounted,
    };
  }

  return { rawCredits, finalCredits: rawCredits, discountApplied: 0 };
}

/**
 * Generates deterministic mock files inside a Google Drive folder URL
 */
export function generateFolderFiles(
  resourceId: string,
  config: Pick<SystemConfig, 'costPerSingleFileCredit' | 'costPerGbCredit'>
): DriveFileItem[] {
  const suffix = resourceId.slice(0, 6).toUpperCase();
  const templates = [
    { name: `LKimLamDrive_Source_Master_${suffix}.zip`, sizeGb: 4.2, mime: 'application/zip' },
    { name: `Project_4K_Render_Final_${suffix}.mp4`, sizeGb: 2.8, mime: 'video/mp4' },
    { name: `Database_Backup_Production_${suffix}.sql.gz`, sizeGb: 1.5, mime: 'application/gzip' },
    { name: `Assets_UI_Design_Bundle_${suffix}.fig`, sizeGb: 0.85, mime: 'application/octet-stream' },
    { name: `Documentation_VIP_Guide_${suffix}.pdf`, sizeGb: 0.12, mime: 'application/pdf' },
  ];

  return templates.map((tpl, idx) => {
    const sizeBytes = Math.round(tpl.sizeGb * 1024 * 1024 * 1024);
    const credits = Math.max(
      config.costPerSingleFileCredit,
      Math.ceil(tpl.sizeGb * config.costPerGbCredit)
    );
    return {
      id: `file_${resourceId}_${idx + 1}`,
      name: tpl.name,
      sizeBytes,
      sizeFormatted: tpl.sizeGb >= 1 ? `${tpl.sizeGb.toFixed(2)} GB` : `${Math.round(tpl.sizeGb * 1024)} MB`,
      mimeType: tpl.mime,
      credits,
    };
  });
}
