import { type DriveFileItem, parseDriveUrl } from './systemRules.ts';
import {
  extractDriveFolderFilesFromHtml,
  decodeHtmlEntities,
  formatBytesVi,
  computeFileCredits,
} from './driveScraper.ts';

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
  costPerGbCredit = 1,
  userId?: string
): Promise<ListFilesApiResponse> {
  // 1. Primary path: call our Express backend /api/list-files
  try {
    const res = await fetch('/api/list-files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'x-user-id': userId } : {}),
      },
      body: JSON.stringify({
        driveUrl,
        costPerSingleFileCredit,
        costPerGbCredit,
        userId,
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

// ============================================================================
// Client-Side Blob Downloader & Browser OpenXML .PPTX Fallback Builder
// ============================================================================
const CLIENT_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Uint8(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CLIENT_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createBrowserZipBlob(entries: Array<{ name: string; data: Uint8Array }>): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32Uint8(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // STORE (0)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, eocd] as unknown as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}

async function renderSvgStringToPngBytes(svgText: string, titleFallback: string, slideIdx: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array();

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1280, 720);

  if (svgText) {
    try {
      // Remove external http image hrefs that might taint canvas if not CORS-enabled
      const sanitizedSvg = svgText.replace(
        /<image\b[^>]*xlink:href="https?:\/\/[^"]*"[^>]*\/?>/gi,
        ''
      );
      const svgBlob = new Blob([sanitizedSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      try {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          const timer = window.setTimeout(() => reject(new Error('SVG load timeout')), 2500);
          img.onload = () => {
            window.clearTimeout(timer);
            ctx.drawImage(img, 0, 0, 1280, 720);
            resolve();
          };
          img.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error('SVG load error'));
          };
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      // Draw styled slide card if SVG had external resources
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.fillText(titleFallback, 80, 320);
      ctx.fillStyle = '#34d399';
      ctx.font = '28px system-ui, sans-serif';
      ctx.fillText(`Slide ${slideIdx + 1}`, 80, 380);
    }
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText(titleFallback, 80, 320);
    ctx.fillStyle = '#34d399';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText(`Slide ${slideIdx + 1} — LKimLamDrive VIP Unlocked`, 80, 380);
  }

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

function buildBrowserPptxFromPngs(slidePngs: Uint8Array[]): Blob {
  const encoder = new TextEncoder();
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const addXml = (name: string, xml: string) => {
    entries.push({ name, data: encoder.encode(xml.trim()) });
  };

  const count = slidePngs.length;
  const slideOverrides = slidePngs
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join('\n  ');

  addXml(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`
  );

  addXml(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );

  const sldIds = slidePngs.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdSlide${i + 1}"/>`).join('\n    ');
  const sldRels = slidePngs
    .map(
      (_, i) =>
        `<Relationship Id="rIdSlide${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    )
    .join('\n  ');

  addXml(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster1"/></p:sldMasterIdLst>
  <p:sldIdLst>${sldIds}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle>
</p:presentation>`
  );

  addXml(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  ${sldRels}
</Relationships>`
  );

  addXml(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`
  );

  addXml(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
  );

  addXml(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`
  );

  addXml(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
  );

  addXml(
    'ppt/theme/theme1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`
  );

  for (let i = 0; i < count; i++) {
    const slideNum = i + 1;
    const pngName = `image${slideNum}.png`;
    entries.push({ name: `ppt/media/${pngName}`, data: slidePngs[i] });

    addXml(
      `ppt/slides/slide${slideNum}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="2" name="Slide_${slideNum}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdImg${slideNum}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
  <p:transition spd="med"><p:push dir="l"/></p:transition>
</p:sld>`
    );

    addXml(
      `ppt/slides/_rels/slide${slideNum}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rIdImg${slideNum}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${pngName}"/>
</Relationships>`
    );
  }

  return createBrowserZipBlob(entries);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const cleanName = filename.replace(/\.(pptx|ppt)?$/i, '') + '.pptx';
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = cleanName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}

/**
 * Downloads a Google Drive presentation/file as the 100% original binary file (.PPTX)
 * directly streaming from Google Drive via backend proxy, preserving all media, animations,
 * audio, and full original file size (35.5 MB, 89 MB, etc.).
 */
export async function downloadDriveFileAsPptx(
  fileId: string,
  fileName: string
): Promise<void> {
  const cleanName = (fileName || `Presentation_${fileId}`).replace(/\.(pptx|ppt)?$/i, '') + '.pptx';
  const downloadUrl = `/api/download/file/${encodeURIComponent(fileId)}?name=${encodeURIComponent(cleanName)}`;

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = cleanName;
  a.target = '_blank';
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

