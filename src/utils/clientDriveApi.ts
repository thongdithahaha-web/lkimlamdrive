import { DriveFileItem, parseDriveUrl } from './systemRules';
import {
  extractDriveFolderFilesFromHtml,
  decodeHtmlEntities,
  formatBytesVi,
  computeFileCredits,
} from './driveScraper';

export interface ProcessedDriveFile extends DriveFileItem {
  proxyDownloadUrl: string;
  viewerUnlockUrl?: string;
  driveViewUrl: string;
}

export interface ListFilesApiResponse {
  type: 'file' | 'folder';
  resourceId: string;
  folderTitle: string;
  files: DriveFileItem[];
}

export async function fetchDriveFilesReal(
  driveUrl: string,
  costPerSingleFileCredit = 1,
  costPerGbCredit = 1
): Promise<ListFilesApiResponse> {
  // 1. Primary path: call our Express backend /api/list-files
  try {
    const res = await fetch('/api/list-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driveUrl,
        costPerSingleFileCredit,
        costPerGbCredit,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể lấy danh sách file từ Google Drive');
      }
      if (data && Array.isArray(data.files) && data.files.length > 0) {
        return data as ListFilesApiResponse;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Google Drive')) {
      throw err;
    }
    // Fallback to CORS proxy if backend route is unavailable
  }

  // 2. Fallback path: fetch real Google Drive HTML via CORS relay
  const parsed = parseDriveUrl(driveUrl);
  if (!parsed.isValid) {
    throw new Error('Link Google Drive không hợp lệ. Vui lòng kiểm tra lại đường dẫn.');
  }

  if (parsed.type === 'folder') {
    const embedUrl = `https://drive.google.com/embeddedfolderview?id=${parsed.resourceId}`;
    const mainUrl = `https://drive.google.com/drive/folders/${parsed.resourceId}?hl=vi`;

    const [embedHtml, mainHtml] = await Promise.all([
      fetchViaCorsRelay(embedUrl),
      fetchViaCorsRelay(mainUrl),
    ]);

    const result = extractDriveFolderFilesFromHtml(
      embedHtml,
      mainHtml,
      costPerSingleFileCredit,
      costPerGbCredit
    );

    if (result.files.length === 0) {
      throw new Error(
        'Không tìm thấy file trong thư mục này. Hãy đảm bảo thư mục Google Drive được chia sẻ công khai.'
      );
    }

    return {
      type: 'folder',
      resourceId: parsed.resourceId,
      folderTitle: result.folderTitle,
      files: result.files,
    };
  }

  const previewUrl = `https://drive.google.com/file/d/${parsed.resourceId}/preview`;
  const html = await fetchViaCorsRelay(previewUrl);
  let name = '';
  let sizeBytes = 0;
  let mimeType = 'application/octet-stream';

  const itemJsonMatch = html.match(/itemJson:\s*(\[[\s\S]*?\])\};/);
  if (itemJsonMatch) {
    try {
      const itemJson = JSON.parse(itemJsonMatch[1]);
      if (typeof itemJson[1] === 'string') name = itemJson[1].trim();
      if (typeof itemJson[11] === 'string') mimeType = itemJson[11].trim();
      for (const entry of itemJson) {
        if (Array.isArray(entry) && typeof entry[2] === 'string' && /^\d+$/.test(entry[2])) {
          sizeBytes = parseInt(entry[2], 10);
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  if (!name) {
    const metaMatch =
      html.match(/<meta itemprop="name" content="([^"]+)"/i) ||
      html.match(/<meta property="og:title" content="([^"]+)"/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    if (metaMatch && metaMatch[1]) {
      name = decodeHtmlEntities(metaMatch[1]).replace(/\s*-\s*Google Drive$/i, '').trim();
    }
  }

  if (!name) {
    name = `Drive_File_${parsed.resourceId.slice(0, 8)}`;
  }

  const singleFile: DriveFileItem = {
    id: parsed.resourceId,
    name,
    sizeBytes,
    sizeFormatted: sizeBytes > 0 ? formatBytesVi(sizeBytes) : 'Tệp Google Drive',
    mimeType,
    credits: computeFileCredits(sizeBytes, costPerSingleFileCredit, costPerGbCredit),
  };

  return {
    type: 'file',
    resourceId: parsed.resourceId,
    folderTitle: singleFile.name,
    files: [singleFile],
  };
}

async function fetchViaCorsRelay(targetUrl: string): Promise<string> {
  const cleanUrl = targetUrl.split('#')[0];
  const relays = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(cleanUrl)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(cleanUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(cleanUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(cleanUrl)}`,
  ];

  const attemptRelay = async (relayUrl: string): Promise<string> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(relayUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (relayUrl.includes('/get?url=')) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.contents === 'string' && parsed.contents.length > 100) {
          return parsed.contents;
        }
        throw new Error('Empty JSON contents');
      }
      if (text && text.length > 100) return text;
      throw new Error('Empty response');
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    return await Promise.any(relays.map((r) => attemptRelay(r)));
  } catch {
    return '';
  }
}
