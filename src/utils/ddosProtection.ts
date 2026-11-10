export interface DdosConfig {
  enabled: boolean;
  underAttackMode: boolean;
  windowMs: number;
  maxRequestsPerWindow: number;
  maxAuthRequestsPerWindow: number;
  maxDownloadRequestsPerWindow: number;
  maxConcurrentPerIp: number;
  autoBanThresholdViolations: number;
  autoBanDurationMinutes: number;
  maxPayloadBytes: number;
  wafSqlXssProtection: boolean;
  whitelistedIps: string[];
  blacklistedIps: string[];
}

export interface DdosSecurityEvent {
  id: string;
  timestamp: string;
  ip: string;
  method: string;
  path: string;
  reason: string;
  layer: 'L7-RateLimit' | 'L7-Concurrency' | 'WAF-Payload' | 'IP-Blacklist' | 'Auto-Jail' | 'Auth-Bruteforce';
  action: 'throttled-429' | 'blocked-403' | 'auto-banned';
}

export interface IpReputationRecord {
  ip: string;
  requestsInWindow: number;
  authRequestsInWindow: number;
  downloadRequestsInWindow: number;
  windowStartMs: number;
  activeConcurrent: number;
  violations: number;
  bannedUntilMs: number;
  lastSeenAt: string;
  lastPath: string;
  userAgent: string;
}

export const DEFAULT_DDOS_CONFIG: DdosConfig = {
  enabled: true,
  underAttackMode: false,
  windowMs: 60_000, // 1 minute sliding window
  maxRequestsPerWindow: 120,
  maxAuthRequestsPerWindow: 12,
  maxDownloadRequestsPerWindow: 30,
  maxConcurrentPerIp: 15,
  autoBanThresholdViolations: 5,
  autoBanDurationMinutes: 15,
  maxPayloadBytes: 65_536, // 64 KB
  wafSqlXssProtection: true,
  whitelistedIps: ['127.0.0.1', '::1'],
  blacklistedIps: [],
};

const MALICIOUS_PAYLOAD_PATTERNS = [
  /<script\b[^>]*>[\s\S]*?<\/script>/i,
  /javascript:\s*[a-z0-9_]+\(/i,
  /(\bunion\s+select\b|\bdrop\s+table\b|\bor\s+1\s*=\s*1\b|--\s*$)/i,
  /(\.\.\/|\.\.\\){2,}/,
  /\b(etc\/passwd|cmd\.exe|\/bin\/sh)\b/i,
];

const BAD_BOT_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /masscan/i,
  /zgrab/i,
  /nmap/i,
  /dirbuster/i,
  /gobuster/i,
];

/**
 * Pure WAF inspector that checks URL query, path, body string, and User-Agent for L7 attack vectors.
 */
export function inspectWafRequest(
  pathAndQuery: string,
  rawBodyStr: string,
  userAgent: string
): { blocked: boolean; reason?: string } {
  for (const botRe of BAD_BOT_USER_AGENTS) {
    if (botRe.test(userAgent)) {
      return { blocked: true, reason: `Phát hiện công cụ quét lỗ hổng tự động (${userAgent.slice(0, 32)})` };
    }
  }

  const combined = `${pathAndQuery} ${rawBodyStr}`;
  for (const pattern of MALICIOUS_PAYLOAD_PATTERNS) {
    if (pattern.test(combined)) {
      return { blocked: true, reason: 'WAF chặn chuỗi tấn công SQLi / XSS / Path Traversal trong gói tin' };
    }
  }

  return { blocked: false };
}

/**
 * Pure rate-limit decision evaluator for unit testing and server enforcement.
 */
export function evaluateRateLimitDecision(
  record: IpReputationRecord,
  config: DdosConfig,
  bucket: 'general' | 'auth' | 'download',
  nowMs: number
): {
  allowed: boolean;
  statusCode: 200 | 403 | 429;
  reason?: string;
  layer?: DdosSecurityEvent['layer'];
  limit: number;
  remaining: number;
  resetSeconds: number;
} {
  if (!config.enabled) {
    return {
      allowed: true,
      statusCode: 200,
      limit: config.maxRequestsPerWindow,
      remaining: config.maxRequestsPerWindow,
      resetSeconds: 60,
    };
  }

  // 1. Check manual Blacklist
  if (config.blacklistedIps.includes(record.ip)) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'IP nằm trong danh sách khóa vĩnh viễn (Blacklist)',
      layer: 'IP-Blacklist',
      limit: 0,
      remaining: 0,
      resetSeconds: 3600,
    };
  }

  // 2. Check Auto-Ban Penalty Box
  if (record.bannedUntilMs > nowMs && !config.whitelistedIps.includes(record.ip)) {
    const waitSec = Math.ceil((record.bannedUntilMs - nowMs) / 1000);
    return {
      allowed: false,
      statusCode: 403,
      reason: `IP bị khóa tự động do vượt ngưỡng tấn công (${waitSec}s còn lại)`,
      layer: 'Auto-Jail',
      limit: 0,
      remaining: 0,
      resetSeconds: waitSec,
    };
  }

  // 3. Check Concurrency limit
  const effectiveConcurrentLimit = config.underAttackMode
    ? Math.max(3, Math.floor(config.maxConcurrentPerIp / 2))
    : config.maxConcurrentPerIp;

  if (record.activeConcurrent > effectiveConcurrentLimit && !config.whitelistedIps.includes(record.ip)) {
    return {
      allowed: false,
      statusCode: 429,
      reason: `Vượt giới hạn kết nối đồng thời (${record.activeConcurrent}/${effectiveConcurrentLimit} kết nối)`,
      layer: 'L7-Concurrency',
      limit: effectiveConcurrentLimit,
      remaining: 0,
      resetSeconds: 10,
    };
  }

  // 4. Determine bucket limit (Under Attack Mode tightens limits by 50%)
  const multiplier = config.underAttackMode ? 0.5 : 1;
  let limit = Math.max(10, Math.floor(config.maxRequestsPerWindow * multiplier));
  let count = record.requestsInWindow;
  let layer: DdosSecurityEvent['layer'] = 'L7-RateLimit';

  if (bucket === 'auth') {
    limit = Math.max(3, Math.floor(config.maxAuthRequestsPerWindow * multiplier));
    count = record.authRequestsInWindow;
    layer = 'Auth-Bruteforce';
  } else if (bucket === 'download') {
    limit = Math.max(5, Math.floor(config.maxDownloadRequestsPerWindow * multiplier));
    count = record.downloadRequestsInWindow;
    layer = 'L7-RateLimit';
  }

  const resetSeconds = Math.max(
    1,
    Math.ceil((record.windowStartMs + config.windowMs - nowMs) / 1000)
  );

  if (count > limit && !config.whitelistedIps.includes(record.ip)) {
    return {
      allowed: false,
      statusCode: 429,
      reason: `Vượt quá giới hạn Rate Limit (${count}/${limit} yêu cầu/phút ở phân vùng ${bucket.toUpperCase()})`,
      layer,
      limit,
      remaining: 0,
      resetSeconds,
    };
  }

  return {
    allowed: true,
    statusCode: 200,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds,
  };
}
