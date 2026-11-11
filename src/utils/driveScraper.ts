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

  const lookupSizeInMainHtml = (id: string, contextHtml: string): string => {
    const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const cellRegex = new RegExp(
      `ssk=['"][^'"]*${escapedId}-0-1['"]><span class="WQJtxb"[^>]*>([^<]+)<\\/span>`,
      'i'
    );
    const cellMatch = contextHtml.match(cellRegex) || mainHtml.match(cellRegex);
    if (cellMatch && cellMatch[1]) {
      return decodeHtmlEntities(cellMatch[1].trim());
    }
    const ariaRegex = new RegExp(
      `aria-label="(?:Size|Kích cỡ|Kích thước):\\s*([^"]+?)\\s*(?:Storage|Bộ nhớ|$)"[^>]*ssk=['"][^'"]*${escapedId}`,
      'i'
    );
    const ariaMatch = contextHtml.match(ariaRegex) || mainHtml.match(ariaRegex);
    if (ariaMatch && ariaMatch[1]) {
      return decodeHtmlEntities(ariaMatch[1].trim());
    }
    return '';
  };

  // 1. Parse from embeddedfolderview (#list or #grid)
  const entryRegex =
    /<div[^>]*class="[^"]*flip-entry[^"]*"[^>]*id="entry-([^"]+)"[\s\S]*?<a[^>]*href="([^"]+)"[\s\S]*?<div[^>]*class="[^"]*flip-entry-title[^"]*"[^>]*>([^<]+)<\/div>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(embedHtml)) !== null) {
    const [, id, href, rawTitle] = match;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const name = decodeHtmlEntities(rawTitle.trim());
    const sizeFormatted = lookupSizeInMainHtml(id, mainHtml);
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

  // 2. Fallback: Parse table rows or data-id blocks from mainHtml
  if (files.length === 0 && mainHtml) {
    const rowRegex =
      /<tr[^>]*data-id="([^"]+)"[\s\S]*?<strong class="DNoYtb">([^<]+)<\/strong>[\s\S]*?<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(mainHtml)) !== null) {
      const [fullRow, id, rawTitle] = rowMatch;
      if (!id || id.startsWith('_') || seenIds.has(id)) continue;
      seenIds.add(id);

      const name = decodeHtmlEntities(rawTitle.trim());
      const sizeFormatted = lookupSizeInMainHtml(id, fullRow) || 'Tệp Drive';
      const sizeBytes = parseSizeToBytes(sizeFormatted);
      const credits = computeFileCredits(sizeBytes, costPerSingleFileCredit, costPerGbCredit);
      const isSubFolder =
        fullRow.includes('application/vnd.google-apps.folder') ||
        (!name.includes('.') && sizeFormatted === 'Tệp Drive');

      files.push({
        id,
        name,
        sizeBytes,
        sizeFormatted: isSubFolder && sizeBytes === 0 ? 'Thư mục' : sizeFormatted,
        mimeType: isSubFolder ? 'application/vnd.google-apps.folder' : guessMimeType(name),
        credits,
      });
    }
  }

  // 3. Fallback: Parse modern Google Drive data-id cards/rows with KL4NAf or data-tooltip
  if (files.length === 0 && mainHtml) {
    const dataIdRegex =
      /data-id="([a-zA-Z0-9_-]{15,})"[\s\S]{1,1500}?(?:<div[^>]*class="[^"]*KL4NAf[^"]*"[^>]*><span[^>]*>([^<]+)<\/span>|data-tooltip="(?:[^"]*?:\s*)?([^"]+)")/gi;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = dataIdRegex.exec(mainHtml)) !== null) {
      const id = dMatch[1];
      const rawTitle = dMatch[2] || dMatch[3];
      if (!id || !rawTitle || id.startsWith('_') || seenIds.has(id)) continue;
      seenIds.add(id);

      const name = decodeHtmlEntities(rawTitle.trim());
      const sizeFormatted = lookupSizeInMainHtml(id, mainHtml);
      const sizeBytes = parseSizeToBytes(sizeFormatted);
      const credits = computeFileCredits(sizeBytes, costPerSingleFileCredit, costPerGbCredit);
      const isSubFolder = !name.includes('.') && sizeBytes === 0;

      files.push({
        id,
        name,
        sizeBytes,
        sizeFormatted: sizeFormatted || (isSubFolder ? 'Thư mục' : 'Tệp Drive'),
        mimeType: isSubFolder ? 'application/vnd.google-apps.folder' : guessMimeType(name),
        credits,
      });
    }
  }

  // 4. Fallback: Parse Google Drive _drive_ivd / AF_initDataCallback escaped JSON payload
  if (files.length === 0 && mainHtml) {
    const unescaped = mainHtml
      .replace(/\\x22/g, '"')
      .replace(/\\x5b/g, '[')
      .replace(/\\x5d/g, ']')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/');

    const ivdRegex =
      /\["([a-zA-Z0-9_-]{15,})",\["[a-zA-Z0-9_-]{10,}"\],"([^"\\]*(?:\\.[^"\\]*)*)","([^"]+)"/g;
    let ivdMatch: RegExpExecArray | null;
    while ((ivdMatch = ivdRegex.exec(unescaped)) !== null) {
      const [, id, rawName, mime] = ivdMatch;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      let name = rawName;
      try {
        name = JSON.parse(`"${rawName.replace(/"/g, '\\"')}"`);
      } catch {
        name = decodeHtmlEntities(rawName);
      }

      const sizeFormatted = lookupSizeInMainHtml(id, mainHtml);
      const sizeBytes = parseSizeToBytes(sizeFormatted);
      const isSubFolder = mime === 'application/vnd.google-apps.folder';
      const credits = computeFileCredits(sizeBytes, costPerSingleFileCredit, costPerGbCredit);

      files.push({
        id,
        name,
        sizeBytes,
        sizeFormatted: sizeFormatted || (isSubFolder ? 'Thư mục' : 'Tệp Drive'),
        mimeType: isSubFolder ? 'application/vnd.google-apps.folder' : mime || guessMimeType(name),
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
  costPerGbCredit = 1,
  resourceKey?: string,
  depth = 0
): Promise<{ folderTitle: string; files: DriveFileItem[] }> {
  const rkParamEmbed = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : '';
  const rkParamMain = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : '';

  const [embedRes, mainRes] = await Promise.all([
    fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}${rkParamEmbed}#list`, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    }),
    fetch(`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}?hl=vi${rkParamMain}`, {
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

  // If this parent folder contains subfolders (e.g. UNIT 1, UNIT 2, UNIT 3...), crawl up to 6 subfolders at depth 0
  // so the user immediately sees all files inside nested folders too.
  if (depth === 0 && parsed.files.length > 0) {
    const subFolders = parsed.files.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    const directFiles = parsed.files.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');

    if (subFolders.length > 0 && directFiles.length === 0) {
      const crawledSubFolders = await Promise.all(
        subFolders.slice(0, 6).map(async (sf) => {
          try {
            const subResult = await fetchRealDriveFolder(
              sf.id,
              costPerSingleFileCredit,
              costPerGbCredit,
               undefined,
              depth + 1
            );
            return subResult.files
              .filter((child) => child.mimeType !== 'application/vnd.google-apps.folder')
              .map((child) => ({
                ...child,
                name: `[${sf.name}] ${child.name}`,
              }));
          } catch {
            return [];
          }
        })
      );
      const flattened = crawledSubFolders.flat();
      if (flattened.length > 0) {
        parsed.files = [...flattened, ...subFolders];
      }
    }
  }

  // If any file (not folder) did not have size in mainHtml, enrich up to 8 files via preview endpoint
  const missingSizeFiles = parsed.files
    .filter((f) => f.sizeBytes === 0 && f.mimeType !== 'application/vnd.google-apps.folder')
    .slice(0, 8);
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
