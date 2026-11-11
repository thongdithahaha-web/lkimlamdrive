import type { DriveFileItem } from './systemRules.ts';

export interface ScrapedDriveResult {
  folderTitle: string;
  type: 'file' | 'folder';
  resourceId: string;
  driveUrl: string;
  files: DriveFileItem[];
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr) return 0;
  const normalized = sizeStr.trim().replace(',', '.').toUpperCase();
  const match = normalized.match(/([\d.]+)\s*(TB|GB|MB|KB|B|BYTES?)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (!Number.isFinite(val)) return 0;
  const unit = match[2].toUpperCase();
  if (unit === 'TB') return Math.round(val * 1024 * 1024 * 1024 * 1024);
  if (unit === 'GB') return Math.round(val * 1024 * 1024 * 1024);
  if (unit === 'MB') return Math.round(val * 1024 * 1024);
  if (unit === 'KB') return Math.round(val * 1024);
  return Math.round(val);
}

export function formatBytesVi(bytes: number): string {
  if (!bytes || bytes <= 0) return 'Không rõ';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2).replace('.', ',')} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${Math.round(kb)} KB`;
  return `${bytes} B`;
}

export function computeFileCredits(
  sizeBytes: number,
  costPerSingleFileCredit = 1,
  costPerGbCredit = 1
): number {
  const sizeGb = sizeBytes / (1024 * 1024 * 1024);
  if (sizeGb <= 1) {
    return Math.max(1, costPerSingleFileCredit);
  }
  return Math.max(costPerSingleFileCredit, Math.ceil(sizeGb * costPerGbCredit));
}

export function extractDriveFolderFilesFromHtml(
  embedHtml: string,
  mainHtml: string,
  costPerSingleFileCredit = 1,
  costPerGbCredit = 1
): { folderTitle: string; files: DriveFileItem[] } {
  const titleMatch =
    embedHtml.match(/<title>([^<]+)<\/title>/i) ||
    mainHtml.match(/<title>([^<]+)<\/title>/i);
  const rawFolderTitle = titleMatch
    ? decodeHtmlEntities(titleMatch[1]).replace(/\s*-\s*Google Drive$/i, '').trim()
    : 'Google Drive Folder';

  const files: DriveFileItem[] = [];
  const seenIds = new Set<string>();

  // 1. Parse from embeddedfolderview (#list)
  const entryRegex =
    /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(embedHtml)) !== null) {
    const [, id, href, rawTitle] = match;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const name = decodeHtmlEntities(rawTitle.trim());
    const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    // Look up size in mainHtml table cells associated with this file ID
    let sizeFormatted = '';
    const cellRegex = new RegExp(
      `ssk='[^']*${escapedId}-0-1'><span class="WQJtxb"[^>]*>([^<]+)<\\/span>`,
      'i'
    );
    const cellMatch = mainHtml.match(cellRegex);
    if (cellMatch && cellMatch[1]) {
      sizeFormatted = decodeHtmlEntities(cellMatch[1].trim());
    } else {
      const ariaRegex = new RegExp(
        `aria-label="(?:Size|Kích cỡ|Kích thước):\\s*([^"]+?)\\s*(?:Storage|Bộ nhớ|$)"[^>]*ssk='[^']*${escapedId}`,
        'i'
      );
      const ariaMatch = mainHtml.match(ariaRegex);
      if (ariaMatch && ariaMatch[1]) {
        sizeFormatted = decodeHtmlEntities(ariaMatch[1].trim());
      }
    }

    const sizeBytes = parseSizeToBytes(sizeFormatted);
    const credits = computeFileCredits(sizeBytes, costPerSingleFileCredit, costPerGbCredit);
    const isSubFolder = href.includes('/folders/');

    files.push({
      id,
      name,
      sizeBytes,
      sizeFormatted: sizeFormatted || (isSubFolder ? 'Thư mục' : 'Tệp Drive'),
      mimeType: isSubFolder ? 'application/vnd.google-apps.folder' : guessMimeType(name),
      credits,
    });
  }

  // 2. Fallback: If embeddedfolderview returned 0 entries, parse rows from mainHtml
  if (files.length === 0 && mainHtml) {
    const rowRegex =
      /<tr[^>]*data-id="([^"]+)"[\s\S]*?<strong class="DNoYtb">([^<]+)<\/strong>[\s\S]*?<\/tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(mainHtml)) !== null) {
      const [fullRow, id, rawTitle] = rowMatch;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const name = decodeHtmlEntities(rawTitle.trim());
      const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const sizeCellRegex = new RegExp(
        `ssk='[^']*${escapedId}-0-1'><span class="WQJtxb"[^>]*>([^<]+)<\\/span>`,
        'i'
      );
      const sMatch = fullRow.match(sizeCellRegex);
      const sizeFormatted = sMatch ? decodeHtmlEntities(sMatch[1].trim()) : 'Tệp Drive';
      const sizeBytes = parseSizeToBytes(sizeFormatted);
      const credits = computeFileCredits(sizeBytes, costPerSingleFileCredit, costPerGbCredit);

      files.push({
        id,
        name,
        sizeBytes,
        sizeFormatted,
        mimeType: guessMimeType(name),
        credits,
      });
    }
  }

  return { folderTitle: rawFolderTitle || 'Google Drive Folder', files };
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt'))
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.docx') || lower.endsWith('.doc'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.mp4') || lower.endsWith('.mkv') || lower.endsWith('.mov'))
    return 'video/mp4';
  if (lower.endsWith('.mp3') || lower.endsWith('.wav')) return 'audio/mpeg';
  if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z'))
    return 'application/zip';
  return 'application/octet-stream';
}

export async function fetchRealSingleDriveFile(
  fileId: string,
  costPerSingleFileCredit = 1,
  costPerGbCredit = 1
): Promise<DriveFileItem> {
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  const res = await fetch(previewUrl, {
    headers: {
      'User-Agent': CHROME_UA,
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  const html = await res.text();

  let name = '';
  let sizeBytes = 0;
  let mimeType = 'application/octet-stream';

  const itemJsonMatch = html.match(/itemJson:\s*(\[[\s\S]*?\])\};/);
  if (itemJsonMatch) {
    try {
      const itemJson = JSON.parse(itemJsonMatch[1]);
      if (typeof itemJson[1] === 'string' && itemJson[1].trim()) {
        name = itemJson[1].trim();
      }
      if (typeof itemJson[11] === 'string' && itemJson[11].trim()) {
        mimeType = itemJson[11].trim();
      }
      for (const entry of itemJson) {
        if (
          Array.isArray(entry) &&
          typeof entry[2] === 'string' &&
          /^\d+$/.test(entry[2])
        ) {
          sizeBytes = parseInt(entry[2], 10);
          break;
        }
      }
    } catch {
      // Fallback to meta tag extraction
    }
  }

  if (!name) {
    const metaName =
      html.match(/<meta itemprop="name" content="([^"]+)"/i) ||
      html.match(/<meta property="og:title" content="([^"]+)"/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    if (metaName && metaName[1]) {
      name = decodeHtmlEntities(metaName[1])
        .replace(/\s*-\s*Google Drive$/i, '')
        .trim();
    }
  }

  if (!name || name === 'Google Drive' || name.includes('Sign in')) {
    name = `Drive_File_${fileId.slice(0, 8)}`;
  }

  const sizeFormatted = sizeBytes > 0 ? formatBytesVi(sizeBytes) : 'Tệp Google Drive';
  const credits = computeFileCredits(sizeBytes, costPerSingleFileCredit, costPerGbCredit);

  return {
    id: fileId,
    name,
    sizeBytes,
    sizeFormatted,
    mimeType: mimeType || guessMimeType(name),
    credits,
  };
}

export async function fetchRealDriveFolder(
  folderId: string,
  costPerSingleFileCredit = 1,
  costPerGbCredit = 1
): Promise<{ folderTitle: string; files: DriveFileItem[] }> {
  const [embedRes, mainRes] = await Promise.all([
    fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    }),
    fetch(`https://drive.google.com/drive/folders/${folderId}?hl=vi`, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    }),
  ]);

  const embedHtml = await embedRes.text();
  const mainHtml = await mainRes.text();

  const parsed = extractDriveFolderFilesFromHtml(
    embedHtml,
    mainHtml,
    costPerSingleFileCredit,
    costPerGbCredit
  );

  // If any file did not have size in mainHtml, enrich up to 8 files via preview endpoint
  const missingSizeFiles = parsed.files.filter((f) => f.sizeBytes === 0).slice(0, 8);
  if (missingSizeFiles.length > 0) {
    await Promise.all(
      missingSizeFiles.map(async (f) => {
        try {
          const single = await fetchRealSingleDriveFile(
            f.id,
            costPerSingleFileCredit,
            costPerGbCredit
          );
          if (single.sizeBytes > 0) {
            f.sizeBytes = single.sizeBytes;
            f.sizeFormatted = single.sizeFormatted;
            f.credits = single.credits;
          }
        } catch {
          // Ignore enrichment error
        }
      })
    );
  }

  return parsed;
}
