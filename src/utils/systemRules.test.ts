import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SYSTEM_CONFIG,
  calculateTopupCredits,
  parseDriveUrl,
  calculateDownloadCost,
  generateFolderFiles,
} from './systemRules';
import {
  extractDriveFolderFilesFromHtml,
  parseSizeToBytes,
} from './driveScraper';
import { extractSvgGroupById } from './pptxAnimator';
import {
  DEFAULT_DDOS_CONFIG,
  evaluateRateLimitDecision,
  inspectWafRequest,
  IpReputationRecord,
} from './ddosProtection';

test('calculateTopupCredits computes base and package bonus credits accurately', () => {
  // Below minimum topup returns 0
  const belowMin = calculateTopupCredits(5000, DEFAULT_SYSTEM_CONFIG);
  assert.equal(belowMin.totalCredits, 0);

  // 10,000 VND -> 10 base credits, 0 bonus
  const tenK = calculateTopupCredits(10000, DEFAULT_SYSTEM_CONFIG);
  assert.equal(tenK.baseCredits, 10);
  assert.equal(tenK.bonusCredits, 0);
  assert.equal(tenK.totalCredits, 10);

  // 50,000 VND matches Gói VIP Pro (50 base + 15 bonus = 65 credits)
  const fiftyK = calculateTopupCredits(50000, DEFAULT_SYSTEM_CONFIG);
  assert.equal(fiftyK.baseCredits, 50);
  assert.equal(fiftyK.bonusCredits, 15);
  assert.equal(fiftyK.totalCredits, 65);
  assert.equal(fiftyK.matchedPackage?.id, 'pkg-pro');
});

test('parseDriveUrl distinguishes Google Drive file and folder URLs', () => {
  const fileRes = parseDriveUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing');
  assert.equal(fileRes.isValid, true);
  assert.equal(fileRes.type, 'file');
  assert.equal(fileRes.resourceId, '1AbCdEfGhIjKlMnOpQrStUvWxYz');

  const folderRes = parseDriveUrl('https://drive.google.com/drive/folders/1FolderXyZ987654321?usp=drive_link');
  assert.equal(folderRes.isValid, true);
  assert.equal(folderRes.type, 'folder');
  assert.equal(folderRes.resourceId, '1FolderXyZ987654321');

  const invalidRes = parseDriveUrl('https://example.com/not-a-drive-link');
  assert.equal(invalidRes.isValid, false);
});

test('calculateDownloadCost applies custom pricing and VIP/Admin role discounts', () => {
  const files = generateFolderFiles('TESTFOLDER', DEFAULT_SYSTEM_CONFIG);
  const allIds = new Set(files.map((f) => f.id));

  const userCost = calculateDownloadCost(files, allIds, DEFAULT_SYSTEM_CONFIG, 'user');
  assert.equal(userCost.rawCredits > 0, true);
  assert.equal(userCost.finalCredits, userCost.rawCredits);

  const vipCost = calculateDownloadCost(files, allIds, DEFAULT_SYSTEM_CONFIG, 'vip');
  assert.equal(vipCost.finalCredits < userCost.finalCredits, true);
  assert.equal(vipCost.discountApplied > 0, true);

  const adminCost = calculateDownloadCost(files, allIds, DEFAULT_SYSTEM_CONFIG, 'admin');
  assert.equal(adminCost.finalCredits, 0);
});

test('extractDriveFolderFilesFromHtml parses real Google Drive folder HTML entries and sizes', () => {
  const embedHtml = `
    <html><head><title>UNIT 4</title></head><body>
      <div class="flip-entry" id="entry-1w5p7Zu3wHWViraUnB0SgwagxvudEtunT">
        <a href="https://drive.google.com/file/d/1w5p7Zu3wHWViraUnB0SgwagxvudEtunT/view">
          <div class="flip-entry-title">Unit 4_Lesson 2_Language.pptx</div>
        </a>
      </div>
    </body></html>
  `;
  const mainHtml = `
    <div ssk='6:by9fbe37:1w5p7Zu3wHWViraUnB0SgwagxvudEtunT-0-1'><span class="WQJtxb">15,1 MB</span></div>
  `;
  const parsed = extractDriveFolderFilesFromHtml(embedHtml, mainHtml, 1, 1);
  assert.equal(parsed.folderTitle, 'UNIT 4');
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].id, '1w5p7Zu3wHWViraUnB0SgwagxvudEtunT');
  assert.equal(parsed.files[0].name, 'Unit 4_Lesson 2_Language.pptx');
  assert.equal(parsed.files[0].sizeFormatted, '15,1 MB');
  assert.equal(parsed.files[0].credits, 1);
  assert.equal(parseSizeToBytes('15,1 MB') > 15000000, true);
});

test('extractSvgGroupById extracts nested animated SVG group cleanly from base slide', () => {
  const sampleSvg = `<svg viewBox="0 0 1280 720"><g id="p7"><path d="M0 0"/><g id="p7_i5"><g><path d="M10 10"/></g></g><g id="p7_i6"><path d="M20 20"/></g></g></svg>`;
  const { extractedGroup, remainingSvg } = extractSvgGroupById(sampleSvg, 'p7_i5');
  assert.equal(extractedGroup, '<g id="p7_i5"><g><path d="M10 10"/></g></g>');
  assert.equal(remainingSvg.includes('id="p7_i5"'), false);
  assert.equal(remainingSvg.includes('id="p7_i6"'), true);
});

test('evaluateRateLimitDecision and inspectWafRequest block DDoS floods, brute-force, and SQLi/XSS payloads', () => {
  const now = Date.now();
  const baseRecord: IpReputationRecord = {
    ip: '203.113.10.99',
    requestsInWindow: 5,
    authRequestsInWindow: 15, // exceeds maxAuthRequestsPerWindow (12)
    downloadRequestsInWindow: 1,
    windowStartMs: now - 5000,
    activeConcurrent: 1,
    violations: 0,
    bannedUntilMs: 0,
    lastSeenAt: new Date(now).toISOString(),
    lastPath: '/api/auth/verify-otp',
    userAgent: 'Mozilla/5.0',
  };

  const authDecision = evaluateRateLimitDecision(baseRecord, DEFAULT_DDOS_CONFIG, 'auth', now);
  assert.equal(authDecision.allowed, false);
  assert.equal(authDecision.statusCode, 429);
  assert.equal(authDecision.layer, 'Auth-Bruteforce');

  const wafSql = inspectWafRequest('/api/list-files?id=1 UNION SELECT * FROM users', '', 'Mozilla/5.0');
  assert.equal(wafSql.blocked, true);

  const wafBot = inspectWafRequest('/api/list-files', '', 'sqlmap/1.7');
  assert.equal(wafBot.blocked, true);
});


