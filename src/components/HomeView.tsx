import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Star,
  ArrowRight,
  Download,
  Link2,
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { useAppStore } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';
import { DiagonalRibbonsBackground } from './DiagonalRibbonsBackground';
import {
  parseDriveUrl,
  calculateDownloadCost,
  DriveFileItem,
} from '../utils/systemRules';
import {
  fetchDriveFilesReal,
  ProcessedDriveFile,
} from '../utils/clientDriveApi';
import { formatBytesVi } from '../utils/driveScraper';

export type AppRoute = 'home' | 'topup' | 'history' | 'login' | 'register' | 'admin';

interface HomeViewProps {
  onNavigate: (route: AppRoute) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  const { config, currentUser, logout, recordDownloadJob } = useAppStore();

  const [driveUrl, setDriveUrl] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [folderTitle, setFolderTitle] = useState('');
  const [folderFiles, setFolderFiles] = useState<DriveFileItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFolderList, setShowFolderList] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [jobState, setJobState] = useState<{
    status: 'processing' | 'completed' | 'error';
    progress: number;
    message: string;
    current?: number;
    total?: number;
    driveLink?: string;
    folderTitle?: string;
    files?: ProcessedDriveFile[];
  } | null>(null);

  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const parsedUrl = useMemo(() => parseDriveUrl(driveUrl), [driveUrl]);
  const isFolder = parsedUrl.type === 'folder' || driveUrl.includes('/folders/');

  const costSummary = useMemo(() => {
    if (isFolder && showFolderList) {
      return calculateDownloadCost(
        folderFiles,
        selectedIds,
        config,
        currentUser?.role || 'user'
      );
    }
    const singleItem: DriveFileItem = {
      id: 'single',
      name: 'File',
      sizeBytes: 100 * 1024 * 1024,
      sizeFormatted: '100 MB',
      mimeType: 'application/octet-stream',
      credits: config.costPerSingleFileCredit,
    };
    return calculateDownloadCost(
      [singleItem],
      new Set(['single']),
      config,
      currentUser?.role || 'user'
    );
  }, [isFolder, showFolderList, folderFiles, selectedIds, config, currentUser]);

  const handleLoadFolderFiles = async () => {
    if (!parsedUrl.isValid) {
      setJobState({
        status: 'error',
        progress: 0,
        message: 'Link Google Drive không hợp lệ. Vui lòng nhập đúng định dạng link Google Drive.',
      });
      return;
    }

    setLoadingFiles(true);
    setShowFolderList(true);
    setJobState(null);

    try {
      const result = await fetchDriveFilesReal(
        driveUrl,
        config.costPerSingleFileCredit,
        config.costPerGbCredit
      );
      setFolderTitle(result.folderTitle);
      setFolderFiles(result.files);
      setSelectedIds(new Set(result.files.map((f) => f.id)));
    } catch (err) {
      setShowFolderList(false);
      setJobState({
        status: 'error',
        progress: 0,
        message:
          err instanceof Error
            ? err.message
            : 'Lỗi tải danh sách files từ Google Drive. Vui lòng kiểm tra quyền chia sẻ.',
      });
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleStartDownload = async () => {
    if (config.maintenanceMode && currentUser?.role !== 'admin') {
      setJobState({
        status: 'error',
        progress: 0,
        message: config.maintenanceMessage,
      });
      return;
    }

    if (!parsedUrl.isValid) {
      setJobState({
        status: 'error',
        progress: 0,
        message: 'Link Google Drive không hợp lệ. Vui lòng kiểm tra lại đường dẫn.',
      });
      return;
    }

    const creditsRequired = costSummary.finalCredits;
    if (currentUser && currentUser.credits < creditsRequired) {
      setJobState({
        status: 'error',
        progress: 0,
        message: `Số dư không đủ (Cần ${creditsRequired} Credits, hiện có ${currentUser.credits} Credits). Vui lòng nạp thêm!`,
      });
      return;
    }

    const totalFilesCount = isFolder && showFolderList ? selectedIds.size : 1;
    if (totalFilesCount === 0) {
      setJobState({
        status: 'error',
        progress: 0,
        message: 'Vui lòng chọn ít nhất 1 file trong thư mục để tải xuống.',
      });
      return;
    }

    setDownloading(true);
    setJobState({
      status: 'processing',
      progress: 10,
      message: 'Đang khởi tạo & kết nối tới Google Drive...',
      current: 0,
      total: totalFilesCount,
    });

    if (timerRef.current) window.clearInterval(timerRef.current);

    try {
      const payload: {
        driveUrl: string;
        selectedFileIds?: string[];
        costPerSingleFileCredit: number;
        costPerGbCredit: number;
      } = {
        driveUrl,
        costPerSingleFileCredit: config.costPerSingleFileCredit,
        costPerGbCredit: config.costPerGbCredit,
      };
      if (isFolder && selectedIds.size > 0) {
        payload.selectedFileIds = Array.from(selectedIds);
      }

      const startRes = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const contentType = startRes.headers.get('content-type') || '';
      if (startRes.ok && contentType.includes('application/json')) {
        const startData = await startRes.json();
        const { job_id, job: immediateJob } = startData;

        if (immediateJob && (immediateJob.status === 'completed' || immediateJob.status === 'error')) {
          setJobState(immediateJob);
          setDownloading(false);

          if (immediateJob.status === 'completed' && currentUser) {
            const filesList: ProcessedDriveFile[] = immediateJob.files || [];
            const totalBytes = filesList.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
            const resolvedName =
              isFolder
                ? `${immediateJob.folderTitle || folderTitle || 'Google Drive Folder'} (${filesList.length} files)`
                : immediateJob.folderTitle || filesList[0]?.name || 'Google Drive File';

            recordDownloadJob({
              userId: currentUser.id,
              username: currentUser.username,
              fileName: resolvedName,
              driveUrl: parsedUrl.normalizedUrl,
              fileType: isFolder ? 'folder' : 'file',
              fileCount: filesList.length || totalFilesCount,
              sizeFormatted: totalBytes > 0 ? formatBytesVi(totalBytes) : 'Tệp Drive',
              creditsUsed: creditsRequired,
              status: 'completed',
              destinationFolderLink: immediateJob.driveLink || parsedUrl.normalizedUrl,
            });
          }
          return;
        }

        timerRef.current = window.setInterval(async () => {
          try {
            const progRes = await fetch(`/api/download/progress/${job_id}`);
            if (!progRes.ok) throw new Error('Progress check failed');
            const data = await progRes.json();
            setJobState(data);

            if (data.status === 'completed' || data.status === 'error') {
              if (timerRef.current) window.clearInterval(timerRef.current);
              setDownloading(false);

              if (data.status === 'completed' && currentUser) {
                const filesList: ProcessedDriveFile[] = data.files || [];
                const totalBytes = filesList.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
                const resolvedName =
                  isFolder
                    ? `${data.folderTitle || folderTitle || 'Google Drive Folder'} (${filesList.length} files)`
                    : data.folderTitle || filesList[0]?.name || 'Google Drive File';

                recordDownloadJob({
                  userId: currentUser.id,
                  username: currentUser.username,
                  fileName: resolvedName,
                  driveUrl: parsedUrl.normalizedUrl,
                  fileType: isFolder ? 'folder' : 'file',
                  fileCount: filesList.length || totalFilesCount,
                  sizeFormatted: totalBytes > 0 ? formatBytesVi(totalBytes) : 'Tệp Drive',
                  creditsUsed: creditsRequired,
                  status: 'completed',
                  destinationFolderLink: data.driveLink || parsedUrl.normalizedUrl,
                });
              }
            }
          } catch {
            if (timerRef.current) window.clearInterval(timerRef.current);
            setDownloading(false);
            setJobState((prev) => ({
              ...(prev || { progress: 0 }),
              status: 'error',
              message: 'Lỗi lấy thông tin tiến trình',
            }));
          }
        }, 450);
        return;
      }

      // Fallback if backend route is unavailable
      let targetFiles = folderFiles.filter((f) => selectedIds.has(f.id));
      let resolvedTitle = folderTitle;
      if (targetFiles.length === 0) {
        const fetched = await fetchDriveFilesReal(
          driveUrl,
          config.costPerSingleFileCredit,
          config.costPerGbCredit
        );
        resolvedTitle = fetched.folderTitle;
        targetFiles =
          isFolder && selectedIds.size > 0
            ? fetched.files.filter((f) => selectedIds.has(f.id))
            : fetched.files;
      }

      const enrichedFiles: ProcessedDriveFile[] = targetFiles.map((f) => ({
        ...f,
        proxyDownloadUrl: `/api/download/file/${encodeURIComponent(f.id)}?name=${encodeURIComponent(f.name)}`,
        driveViewUrl: `https://drive.google.com/file/d/${f.id}/view`,
      }));

      const totalBytes = enrichedFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
      if (currentUser) {
        recordDownloadJob({
          userId: currentUser.id,
          username: currentUser.username,
          fileName: isFolder
            ? `${resolvedTitle} (${enrichedFiles.length} files)`
            : resolvedTitle,
          driveUrl: parsedUrl.normalizedUrl,
          fileType: isFolder ? 'folder' : 'file',
          fileCount: enrichedFiles.length,
          sizeFormatted: totalBytes > 0 ? formatBytesVi(totalBytes) : 'Tệp Drive',
          creditsUsed: creditsRequired,
          status: 'completed',
          destinationFolderLink: parsedUrl.normalizedUrl,
        });
      }

      setDownloading(false);
      setJobState({
        status: 'completed',
        progress: 100,
        message: `Hoàn tất! Đã xử lý ${enrichedFiles.length} file từ "${resolvedTitle}"`,
        current: enrichedFiles.length,
        total: enrichedFiles.length,
        driveLink: parsedUrl.normalizedUrl,
        folderTitle: resolvedTitle,
        files: enrichedFiles,
      });
    } catch (err) {
      setDownloading(false);
      setJobState({
        status: 'error',
        progress: 0,
        message: err instanceof Error ? err.message : 'Không thể bắt đầu tải',
      });
    }
  };

  const toggleSelectFile = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="relative min-h-screen w-full overflow-y-auto bg-black pb-20 text-white">
      <DiagonalRibbonsBackground />

      {/* Top Navigation Bar - Matches ezdrive.id.vn */}
      <nav className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="flex items-center focus:outline-none cursor-pointer"
              aria-label="Trang Chủ LKimLamDrive"
            >
              <BrandLogo brandName={config.brandName} size="md" />
            </button>

            <div className="hidden md:flex items-center space-x-1 rounded-full bg-white/5 backdrop-blur-xl border border-white/10 p-1 -mr-6">
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Trang Chủ
              </button>
              <button
                type="button"
                onClick={() => onNavigate('topup')}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Nạp Tiền
              </button>
              <button
                type="button"
                onClick={() => onNavigate('history')}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Lịch Sử
              </button>
            </div>

            <div className="flex items-center space-x-4 shrink-0">
              {currentUser ? (
                <div className="flex items-center gap-4 text-white">
                  <button
                    type="button"
                    onClick={() => onNavigate('topup')}
                    className="text-sm font-medium inline-flex items-center gap-1.5 hover:text-gray-200 cursor-pointer tabular-nums"
                  >
                    <span>💎 {currentUser.credits}</span>
                  </button>
                  <button
                    type="button"
                    onClick={logout}
                    className="text-sm font-medium hover:text-gray-300 cursor-pointer"
                  >
                    Thoát
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onNavigate('register')}
                    className="hidden sm:inline-flex items-center px-4 py-2 rounded-full text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 border border-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Đăng Ký
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('login')}
                    className="bg-white text-black px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-200 inline-flex items-center transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Đăng Nhập
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Optional Announcement or Maintenance Notice */}
      {config.announcementBanner && (
        <div className="relative z-20 bg-[#5D45F5]/20 border-b border-[#5D45F5]/40 px-4 py-2 text-center text-xs sm:text-sm text-indigo-200">
          {config.announcementBanner}
        </div>
      )}

      {config.maintenanceMode && (
        <div className="relative z-20 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 text-center text-xs sm:text-sm text-amber-300 flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{config.maintenanceMessage}</span>
        </div>
      )}

      {/* Main Hero Section - Exact structure from ezdrive.id.vn */}
      <div className="relative z-10 flex min-h-[calc(100vh-4rem)] items-center py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 w-full">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-8 inline-flex items-center rounded-full bg-white/5 backdrop-blur-xl border border-white/10 px-4 py-2 text-sm text-white/90">
              <Star className="mr-2 h-4 w-4 text-white" />
              <span>{config.heroBadge}</span>
            </div>

            <h1 className="mb-6 text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
              {config.heroTitlePrefix}
              <span className="bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                {config.heroTitleHighlight}
              </span>
            </h1>

            <p className="mb-10 text-lg leading-8 text-white/80 sm:text-xl max-w-3xl mx-auto">
              {config.heroSubtitle}
            </p>

            {/* Drive Link Input & Primary Action */}
            <div className="w-full max-w-2xl mx-auto mb-12">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <input
                  type="text"
                  aria-label="Đường dẫn Google Drive"
                  value={driveUrl}
                  onChange={(e) => {
                    setDriveUrl(e.target.value);
                    if (showFolderList) {
                      setShowFolderList(false);
                      setFolderFiles([]);
                    }
                    if (jobState) {
                      setJobState(null);
                    }
                  }}
                  placeholder={config.inputPlaceholder}
                  className="w-full rounded-full border border-white/20 bg-white/5 px-6 py-4 text-white placeholder-white/50 backdrop-blur-xl focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <button
                  type="button"
                  onClick={isFolder && !showFolderList ? handleLoadFolderFiles : handleStartDownload}
                  disabled={!driveUrl.trim() || downloading || loadingFiles}
                  className="w-full sm:w-auto bg-white text-black rounded-full px-8 py-4 font-semibold shrink-0 shadow-2xl hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center transition-all cursor-pointer"
                >
                  {(downloading || loadingFiles) && (
                    <Loader2 className="animate-spin mr-2 h-5 w-5" />
                  )}
                  <span>
                    {isFolder && !showFolderList ? 'Xem Danh Sách' : config.ctaButtonText}
                  </span>
                  {!downloading && !loadingFiles && <ArrowRight className="ml-2 h-5 w-5" />}
                </button>
              </div>

              {/* Real Folder File Selector Card */}
              {showFolderList && (
                <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-xl text-left">
                  <div className="flex justify-between items-center mb-4 gap-2">
                    <div>
                      <h3 className="text-white font-medium">
                        Chọn files ({selectedIds.size}/{folderFiles.length})
                        {folderTitle ? (
                          <span className="ml-2 text-xs text-white/60 font-normal">
                            — Thư mục: {folderTitle}
                          </span>
                        ) : null}
                      </h3>
                    </div>
                    <div className="space-x-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set(folderFiles.map((f) => f.id)))}
                        className="text-xs bg-white/10 text-white px-2.5 py-1 rounded hover:bg-white/20 transition-colors cursor-pointer"
                      >
                        Chọn hết
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        className="text-xs bg-white/10 text-white px-2.5 py-1 rounded hover:bg-white/20 transition-colors cursor-pointer"
                      >
                        Bỏ chọn
                      </button>
                    </div>
                  </div>

                  {loadingFiles ? (
                    <div className="py-8 text-center text-white/50 flex flex-col justify-center items-center gap-2">
                      <Loader2 className="animate-spin h-6 w-6 text-white" />
                      <span className="text-xs text-white/60">
                        Đang quét danh sách file thật từ Google Drive...
                      </span>
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                      {folderFiles.map((file) => (
                        <div
                          key={file.id}
                          onClick={() => toggleSelectFile(file.id)}
                          className="flex items-center justify-between gap-3 p-2.5 hover:bg-white/5 rounded-lg border border-transparent hover:border-white/10 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(file.id)}
                              readOnly
                              className="h-4 w-4 rounded border-gray-300 accent-indigo-500 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white truncate">{file.name}</p>
                              <p className="text-xs text-white/50 tabular-nums">
                                {file.sizeFormatted} • {file.credits}💎
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={`/api/download/file/${encodeURIComponent(file.id)}?name=${encodeURIComponent(file.name)}`}
                              download={file.name}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg font-medium shrink-0 inline-flex items-center gap-1.5 transition-colors"
                              title={`Tải file ${file.name} (.PPTX kèm đầy đủ hiệu ứng)`}
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span>Tải .PPTX (Đủ Hiệu Ứng)</span>
                            </a>
                            <a
                              href={`/api/download/file/${encodeURIComponent(file.id)}?name=${encodeURIComponent(file.name)}&mode=viewer`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg font-medium shrink-0 inline-flex items-center gap-1 transition-colors"
                              title="Trình chiếu hiệu ứng trực tiếp hoặc xuất PDF"
                            >
                              <span>Slide / PDF</span>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-white/10 flex justify-between items-center">
                    <span className="text-sm text-white/80 tabular-nums">
                      Tổng credits cần: <strong className="text-white">{costSummary.finalCredits} 💎</strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleStartDownload}
                      disabled={selectedIds.size === 0 || downloading || loadingFiles}
                      className="bg-white text-black px-5 py-2 rounded-full text-xs font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      Tải {selectedIds.size} File Đã Chọn
                    </button>
                  </div>
                </div>
              )}

              {/* Active Download Progress & Unlocked Files Card */}
              {jobState && (
                <div className="mt-6 bg-white/10 border border-white/20 rounded-2xl p-6 backdrop-blur-xl text-left">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {jobState.status === 'processing' && (
                        <Loader2 className="animate-spin text-white h-6 w-6 shrink-0" />
                      )}
                      {jobState.status === 'completed' && (
                        <CheckCircle2 className="text-green-400 h-6 w-6 shrink-0" />
                      )}
                      {jobState.status === 'error' && (
                        <XCircle className="text-red-400 h-6 w-6 shrink-0" />
                      )}
                      <div>
                        <p className="text-white font-medium">{jobState.message || 'Đang xử lý'}</p>
                        {(jobState.total ?? 0) > 0 && (
                          <p className="text-white/50 text-xs mt-1 tabular-nums">
                            Copy {jobState.current} / {jobState.total} files
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-xl font-bold text-white tabular-nums">
                      {Math.round(jobState.progress || 0)}%
                    </span>
                  </div>

                  <div className="w-full bg-white/10 rounded-full h-3 mb-4 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        jobState.status === 'completed'
                          ? 'bg-green-400'
                          : jobState.status === 'error'
                          ? 'bg-red-400'
                          : 'bg-white'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, jobState.progress || 0))}%`,
                      }}
                    />
                  </div>

                  {/* Individual Unlocked Files Ready to Download */}
                  {jobState.status === 'completed' && jobState.files && jobState.files.length > 0 && (
                    <div className="mt-4 space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                      {jobState.files.map((f) => (
                        <div
                          key={f.id}
                          className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3 rounded-xl bg-black/40 border border-white/10"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <FileText className="h-4 w-4 text-emerald-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-white truncate">{f.name}</p>
                              <p className="text-xs text-white/50 tabular-nums">{f.sizeFormatted}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a
                              href={f.proxyDownloadUrl}
                              download={f.name}
                              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-3.5 py-1.5 rounded-lg text-xs inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span>Tải .PPTX (Đầy Đủ Hiệu Ứng)</span>
                            </a>
                            <a
                              href={`${f.proxyDownloadUrl}&mode=viewer`}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs inline-flex items-center gap-1 transition-colors"
                              title="Trình chiếu trực tiếp kèm hiệu ứng hoặc xuất PDF"
                            >
                              <span>Trình Chiếu / PDF</span>
                            </a>
                            <a
                              href={f.driveViewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg text-xs inline-flex items-center gap-1 transition-colors"
                              title="Xem trên Google Drive"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {jobState.status === 'completed' && jobState.driveLink && (
                    <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
                      <a
                        href={jobState.driveLink}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-2 text-green-400 hover:text-green-300 font-medium"
                      >
                        Mở trong Google Drive
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3 Hero Metrics - Exact match to ezdrive.id.vn */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-2xl mx-auto">
              <div className="text-center">
                <div className="flex justify-center mb-2">
                  <Download className="h-8 w-8 text-white" />
                </div>
                <div className="text-2xl font-bold text-white mb-1 tabular-nums">
                  {config.stat1Value}
                </div>
                <div className="text-white/60 text-sm">{config.stat1Label}</div>
              </div>

              <div className="text-center">
                <div className="flex justify-center mb-2">
                  <Link2 className="h-8 w-8 text-white" />
                </div>
                <div className="text-2xl font-bold text-white mb-1 tabular-nums">
                  {config.stat2Value}
                </div>
                <div className="text-white/60 text-sm">{config.stat2Label}</div>
              </div>

              <div className="text-center">
                <div className="flex justify-center mb-2">
                  <Shield className="h-8 w-8 text-white" />
                </div>
                <div className="text-2xl font-bold text-white mb-1 tabular-nums">
                  {config.stat3Value}
                </div>
                <div className="text-white/60 text-sm">{config.stat3Label}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
