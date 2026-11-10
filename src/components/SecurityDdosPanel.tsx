import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Lock,
  Unlock,
  Zap,
  RefreshCw,
  Mail,
  Server,
  Layers,
  Cpu,
  AlertTriangle,
  Save,
  Trash2,
} from 'lucide-react';
import {
  DdosConfig,
  DEFAULT_DDOS_CONFIG,
  DdosSecurityEvent,
  IpReputationRecord,
} from '../utils/ddosProtection';
import { useAppStore } from '../context/AppContext';

interface TrackedIpItem extends IpReputationRecord {
  isBlacklisted: boolean;
  isWhitelisted: boolean;
  isAutoBanned: boolean;
  bannedRemainingSec: number;
}

interface OutboxMailItem {
  id: string;
  to: string;
  subject: string;
  code: string;
  purpose: 'register' | 'reset-password';
  sentViaSmtp: boolean;
  createdAt: string;
}

export const SecurityDdosPanel: React.FC<{ onToast: (msg: string) => void }> = ({ onToast }) => {
  const { config, updateSystemConfig } = useAppStore();

  const [ddosConfig, setDdosConfig] = useState<DdosConfig>(() => ({
    ...DEFAULT_DDOS_CONFIG,
  }));
  const [stats, setStats] = useState({
    totalRequests: 0,
    totalBlocked: 0,
    trackedIpsCount: 0,
    autoBannedCount: 0,
  });
  const [ips, setIps] = useState<TrackedIpItem[]>([]);
  const [events, setEvents] = useState<DdosSecurityEvent[]>([]);
  const [outbox, setOutbox] = useState<OutboxMailItem[]>([]);
  const [smtpEmail, setSmtpEmail] = useState(config.smtpEmail || 'lekimlam2707@gmail.com');
  const [smtpAppPassword, setSmtpAppPassword] = useState(config.smtpAppPassword || '');
  const [manualIp, setManualIp] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchSecurityData = useCallback(async () => {
    try {
      const [secRes, mailRes] = await Promise.all([
        fetch('/api/security/status'),
        fetch('/api/auth/outbox'),
      ]);
      const secType = secRes.headers.get('content-type') || '';
      if (secRes.ok && secType.includes('application/json')) {
        const data = await secRes.json();
        if (data.config) setDdosConfig(data.config);
        if (data.stats) setStats(data.stats);
        setIps(data.ips || []);
        setEvents(data.events || []);
      }
      const mailType = mailRes.headers.get('content-type') || '';
      if (mailRes.ok && mailType.includes('application/json')) {
        const mailData = await mailRes.json();
        setOutbox(mailData.emails || []);
      }
    } catch {
      // ignore transient poll error
    }
  }, []);

  useEffect(() => {
    fetchSecurityData();
    const timer = window.setInterval(fetchSecurityData, 3000);
    return () => window.clearInterval(timer);
  }, [fetchSecurityData]);

  const handleSaveDdosConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const cleanSmtpEmail = smtpEmail.trim();
      const cleanSmtpPass = smtpAppPassword.replace(/\s+/g, '');
      updateSystemConfig({ smtpEmail: cleanSmtpEmail, smtpAppPassword: cleanSmtpPass });
      try {
        const res = await fetch('/api/security/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...ddosConfig,
            smtpEmail: cleanSmtpEmail,
            smtpAppPassword: cleanSmtpPass,
          }),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = await res.json();
          if (data.config) setDdosConfig(data.config);
        }
      } catch {
        // saved in system config
      }
      onToast('Đã lưu cấu hình Gmail SMTP (Gửi mã OTP 6 số) & Tường lửa Anti-DDoS thành công!');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUnderAttack = async () => {
    if (!ddosConfig) return;
    const nextVal = !ddosConfig.underAttackMode;
    const updated = { ...ddosConfig, underAttackMode: nextVal };
    setDdosConfig(updated);
    await fetch('/api/security/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    onToast(
      nextVal
        ? '⚡ Đã BẬT chế độ Under Attack Mode! Mọi ngưỡng Rate Limit & Kết nối đồng thời được siết chặt 50%.'
        : 'Đã tắt chế độ Under Attack Mode, khôi phục ngưỡng tiêu chuẩn.'
    );
  };

  const handleIpAction = async (ip: string, action: 'blacklist' | 'unban' | 'whitelist' | 'simulate-attack' | 'clear-events') => {
    await fetch('/api/security/ip-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, action }),
    });
    const res = await fetch('/api/security/status');
    if (res.ok) {
      const data = await res.json();
      setDdosConfig(data.config);
      setStats(data.stats);
      setIps(data.ips || []);
      setEvents(data.events || []);
    }
    if (action === 'simulate-attack') {
      onToast('Đã mô phỏng đợt tấn công HTTP Flood & kích hoạt Auto-Ban thành công!');
    } else if (action === 'clear-events') {
      onToast('Đã xóa nhật ký cảnh báo DDoS.');
    } else {
      onToast(`Đã thực thi lệnh [${action.toUpperCase()}] cho IP ${ip}`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Top Emergency Control Banner */}
      <div
        className={`rounded-xl p-5 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
          ddosConfig?.underAttackMode
            ? 'bg-amber-500/15 border-amber-500/50'
            : 'bg-[#0F172A] border-slate-800'
        }`}
      >
        <div className="flex items-start gap-3.5">
          <div
            className={`p-3 rounded-xl shrink-0 ${
              ddosConfig?.underAttackMode
                ? 'bg-amber-500 text-black'
                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            }`}
          >
            {ddosConfig?.underAttackMode ? (
              <ShieldAlert className="w-6 h-6" />
            ) : (
              <ShieldCheck className="w-6 h-6" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-white">
                 Trung Tâm Phòng Thủ Anti-DDoS Đa Tầng & Rate Limiting (L3/L4/L7)
              </h2>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                  ddosConfig?.underAttackMode
                    ? 'bg-amber-400 text-black'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                {ddosConfig?.underAttackMode ? 'UNDER ATTACK MODE ACTIVE' : 'SHIELD ONLINE'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Bảo vệ máy chủ theo thời gian thực bằng thuật toán Sliding Window, Concurrency Guard chống
              Slowloris, WAF chống SQLi/XSS và Auto-Ban Penalty Box.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => handleIpAction('', 'simulate-attack')}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Test Mô Phỏng DDoS</span>
          </button>

          <button
            type="button"
            onClick={handleToggleUnderAttack}
            className={`px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              ddosConfig?.underAttackMode
                ? 'bg-amber-400 hover:bg-amber-300 text-black'
                : 'bg-rose-600 hover:bg-rose-500 text-white'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {ddosConfig?.underAttackMode
                ? 'Tắt Chế Độ Under Attack'
                : 'Bật Under Attack Mode'}
            </span>
          </button>
        </div>
      </div>

      {/* Live Telemetry Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Tổng Request API Đã Kiểm Duyệt</div>
          <div className="text-2xl font-bold text-white tabular-nums">
            {stats.totalRequests.toLocaleString()}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">Sliding Window 60 giây</div>
        </div>

        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Request Bị Chặn (429 / 403 WAF)</div>
          <div className="text-2xl font-bold text-rose-400 tabular-nums">
            {stats.totalBlocked.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Chặn tự động ở tầng Express Middleware</div>
        </div>

        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Số Địa Chỉ IP Đang Giám Sát</div>
          <div className="text-2xl font-bold text-indigo-400 tabular-nums">
            {stats.trackedIpsCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Theo dõi đồng thời & điểm uy tín</div>
        </div>

        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">IP Đang Bị Cách Ly (Jail / Blacklist)</div>
          <div className="text-2xl font-bold text-amber-400 tabular-nums">
            {stats.autoBannedCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Tự động khóa {ddosConfig?.autoBanDurationMinutes || 15} phút khi vượt ngưỡng
          </div>
        </div>
      </div>

      {/* Rate Limiting & Gmail SMTP Configuration Form */}
      <form
        onSubmit={handleSaveDdosConfig}
        className="bg-[#0F172A] border border-indigo-500/40 rounded-xl p-6 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-bold text-white">
              Cấu Hình Gửi Mã OTP 6 Số Qua Gmail (SMTP) & Ngưỡng Rate Limiting
            </h3>
            <p className="text-xs text-slate-400">
              Dán mã App Password 16 ký tự của Google vào ô bên dưới để hệ thống bắn mã OTP 6 số trực tiếp tới Gmail người dùng.
            </p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm inline-flex items-center gap-2 cursor-pointer self-start"
          >
            <Save className="w-4 h-4" />
            <span>Lưu Cấu Hình Gmail OTP & Bảo Mật</span>
          </button>
        </div>

        {/* Highlighted Gmail SMTP 6-Digit OTP Box */}
        <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-indigo-300 mb-1.5">
              1. Gmail Hệ Thống Gửi Mã OTP (Chủ Web)
            </label>
            <input
              type="email"
              placeholder="VD: lekimlam2707@gmail.com"
              value={smtpEmail}
              onChange={(e) => setSmtpEmail(e.target.value)}
              className="w-full bg-slate-900 border border-indigo-500/40 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-emerald-300 mb-1.5">
              2. Dán Mã App Password 16 Ký Tự Của Google Vào Đây
            </label>
            <input
              type="text"
              placeholder="Dán mã 16 ký tự (VD: abcd efgh ijkl mnop)"
              value={smtpAppPassword}
              onChange={(e) => setSmtpAppPassword(e.target.value)}
              className="w-full bg-slate-900 border border-emerald-500/40 rounded-lg px-3.5 py-2.5 text-sm text-emerald-300 font-mono focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Giới hạn API Chung (Requests / Phút / IP)
            </label>
            <input
              type="number"
              min="10"
              value={ddosConfig.maxRequestsPerWindow}
              onChange={(e) =>
                setDdosConfig({ ...ddosConfig, maxRequestsPerWindow: Number(e.target.value) })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Giới hạn Đăng Nhập & OTP (Req / Phút / IP)
            </label>
            <input
              type="number"
              min="3"
              value={ddosConfig.maxAuthRequestsPerWindow}
              onChange={(e) =>
                setDdosConfig({
                  ...ddosConfig,
                  maxAuthRequestsPerWindow: Number(e.target.value),
                })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Giới hạn Luồng Tải File VIP (Req / Phút / IP)
            </label>
            <input
              type="number"
              min="5"
              value={ddosConfig.maxDownloadRequestsPerWindow}
              onChange={(e) =>
                setDdosConfig({
                  ...ddosConfig,
                  maxDownloadRequestsPerWindow: Number(e.target.value),
                })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Kết nối đồng thời tối đa / IP (Chống Slowloris)
            </label>
            <input
              type="number"
              min="2"
              value={ddosConfig.maxConcurrentPerIp}
              onChange={(e) =>
                setDdosConfig({ ...ddosConfig, maxConcurrentPerIp: Number(e.target.value) })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Số lần vi phạm trước khi Auto-Ban IP
            </label>
            <input
              type="number"
              min="1"
              value={ddosConfig.autoBanThresholdViolations}
              onChange={(e) =>
                setDdosConfig({
                  ...ddosConfig,
                  autoBanThresholdViolations: Number(e.target.value),
                })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Thời gian cách ly Auto-Ban (Phút)
            </label>
            <input
              type="number"
              min="1"
              value={ddosConfig.autoBanDurationMinutes}
              onChange={(e) =>
                setDdosConfig({
                  ...ddosConfig,
                  autoBanDurationMinutes: Number(e.target.value),
                })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </div>
        </div>
      </form>

      {/* Active IP Reputation Table & Real-Time Attack Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: IP Reputation & Firewall Table */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                <span>Bảng Giám Sát IP & Quản Lý Blacklist / Whitelist</span>
              </h3>
              <button
                type="button"
                onClick={fetchSecurityData}
                className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Làm mới</span>
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Nhập IP (VD: 203.113.148.55)..."
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  if (manualIp.trim()) {
                    handleIpAction(manualIp.trim(), 'blacklist');
                    setManualIp('');
                  }
                }}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Chặn IP
              </button>
              <button
                type="button"
                onClick={() => {
                  if (manualIp.trim()) {
                    handleIpAction(manualIp.trim(), 'whitelist');
                    setManualIp('');
                  }
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Whitelist
              </button>
            </div>

            <div className="overflow-x-auto max-h-64 custom-scrollbar">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-2">Địa chỉ IP</th>
                    <th className="py-2 px-2">Req/Phút</th>
                    <th className="py-2 px-2">Trạng thái</th>
                    <th className="py-2 pl-2 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {ips.map((item) => (
                    <tr key={item.ip}>
                      <td className="py-2.5 pr-2 font-mono text-white">
                        <div>{item.ip}</div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[160px]">
                          {item.lastPath}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 font-mono tabular-nums text-slate-200">
                        {item.requestsInWindow} req (Auth: {item.authRequestsInWindow})
                      </td>
                      <td className="py-2.5 px-2">
                        {item.isBlacklisted ? (
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold">
                            Blacklisted
                          </span>
                        ) : item.isAutoBanned ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                            Auto-Jail ({item.bannedRemainingSec}s)
                          </span>
                        ) : item.isWhitelisted ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                            Whitelist
                          </span>
                        ) : (
                          <span className="text-slate-400">Bình thường</span>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 text-right space-x-1">
                        {item.isBlacklisted || item.isAutoBanned ? (
                          <button
                            type="button"
                            onClick={() => handleIpAction(item.ip, 'unban')}
                            className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Mở khóa</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleIpAction(item.ip, 'blacklist')}
                            className="px-2 py-1 rounded bg-rose-600/80 text-white hover:bg-rose-500 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Lock className="w-3 h-3" />
                            <span>Khóa</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Security Event Logs & Gmail OTP Outbox */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Nhật Ký Chặn Tấn Công DDoS / WAF ({events.length})</span>
            </h3>
            {events.length > 0 && (
              <button
                type="button"
                onClick={() => handleIpAction('', 'clear-events')}
                className="text-xs text-slate-400 hover:text-rose-400 inline-flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa log</span>
              </button>
            )}
          </div>

          <div className="max-h-40 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {events.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                Chưa có cuộc tấn công nào bị chặn. Nhấn "Test Mô Phỏng DDoS" ở trên để kiểm thử!
              </p>
            ) : (
              events.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2.5 rounded-lg bg-slate-900/90 border border-rose-500/20 text-xs flex items-start justify-between gap-2"
                >
                  <div>
                    <div className="font-mono text-rose-300 font-semibold">
                      [{ev.layer}] {ev.ip} → {ev.method} {ev.path}
                    </div>
                    <div className="text-slate-400 mt-0.5">{ev.reason}</div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString('vi-VN')}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Recent Gmail Verification & Password Reset Outbox */}
          <div className="pt-3 border-t border-slate-800">
            <h4 className="text-xs font-bold text-indigo-300 mb-2 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              <span>Lịch Sử Gửi Mã OTP Gmail Gần Đây ({outbox.length})</span>
            </h4>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
              {outbox.length === 0 ? (
                <p className="text-xs text-slate-500">Chưa có email xác thực nào được gửi.</p>
              ) : (
                outbox.map((m) => (
                  <div
                    key={m.id}
                    className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="truncate pr-2">
                      <span className="text-white font-medium">{m.to}</span>{' '}
                      <span className="text-slate-400">
                        ({m.purpose === 'register' ? 'Đăng ký' : 'Khôi phục MK'})
                      </span>
                    </div>
                    <span className="font-mono font-bold text-emerald-400 shrink-0">
                      OTP: {m.code}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Comprehensive Anti-DDoS Architecture & Knowledge Base Section */}
      <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-6 space-y-5">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            <span>
              Kiến Thức & Kiến Trúc Phòng Thủ Chống DDoS Đa Tầng (OSI Layer 3 / Layer 4 / Layer 7)
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Tổng hợp toàn bộ cơ chế kỹ thuật đang vận hành trên LKimLamDrive kết hợp tiêu chuẩn bảo
            mật đám mây hiện đại.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed">
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="font-bold text-indigo-300 flex items-center gap-2 text-sm">
              <Server className="w-4 h-4" />
              <span>1. Tầng Mạng & Giao Vận (L3 / L4)</span>
            </div>
            <p className="text-slate-300">
              • <strong>Chống SYN Flood & TCP Exhaustion:</strong> Sử dụng cơ chế{' '}
              <code>SYN Cookies</code> và giảm thời gian <code>tcp_fin_timeout</code> để giải phóng
              bảng <code>conntrack</code> khi botnet gửi hàng triệu gói SYN giả mạo IP.
            </p>
            <p className="text-slate-300">
              • <strong>Anycast BGP & Scrubbing Center:</strong> Phân tán lưu lượng tấn công UDP/ICMP
              Amplification qua mạng lưới Edge (Cloudflare / Google Cloud Armor) trước khi chạm tới
              Origin Server.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="font-bold text-emerald-300 flex items-center gap-2 text-sm">
              <Cpu className="w-4 h-4" />
              <span>2. Tầng Ứng Dụng & Rate Limiting (L7)</span>
            </div>
            <p className="text-slate-300">
              • <strong>Phân vùng Sliding Window Rate Limit:</strong> Tách biệt hạn mức giữa API
              chung (<code>120 req/phút</code>), Luồng tải file (<code>30 req/phút</code>) và Đăng
              nhập/OTP (<code>12 req/phút</code>) kèm chuẩn Header <code>X-RateLimit-*</code> &{' '}
              <code>Retry-After</code>.
            </p>
            <p className="text-slate-300">
              • <strong>Chống Slowloris & Connection Exhaustion:</strong> Giới hạn số kết nối đồng
              thời trên mỗi IP (<code>maxConcurrentPerIp = 15</code>) và giới hạn kích thước gói tin
              JSON tối đa <code>64KB</code> để ngăn tràn bộ nhớ RAM.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="font-bold text-amber-300 flex items-center gap-2 text-sm">
              <ShieldCheck className="w-4 h-4" />
              <span>3. WAF, Auto-Jail & Zero-Trust DB</span>
            </div>
            <p className="text-slate-300">
              • <strong>Tường lửa WAF & Auto-Ban Penalty Box:</strong> Tự động quét chữ ký độc hại
              (SQL Injection, XSS, Path Traversal, công cụ quét <code>sqlmap/nikto</code>) và tự
              động giam IP vi phạm liên tiếp vào <code>Penalty Box</code>.
            </p>
            <p className="text-slate-300">
              • <strong>In-Memory Caching & Denial-of-Wallet Guard:</strong> Lưu đệm file{' '}
              <code>.PPTX</code> đã giải mã trong bộ nhớ đệm (<code>pptxBufferCache</code>) và áp
              dụng quy tắc Firestore 8-Pillars chống tấn công cạn kiệt tài nguyên cơ sở dữ liệu.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
