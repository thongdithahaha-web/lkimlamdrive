import zlib from 'zlib';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let cachedResvgClass: any = undefined;
async function getResvgClass(): Promise<any> {
  if (cachedResvgClass !== undefined) return cachedResvgClass;
  try {
    const mod = await import('@resvg/resvg-js');
    cachedResvgClass = mod.Resvg || (mod as any).default?.Resvg || null;
  } catch {
    cachedResvgClass = null;
  }
  return cachedResvgClass;
}

export interface AnimatedAction {
  targetId: string;
  durationMs: number;
  delayMs: number;
  triggerType: 'clickEffect' | 'withEffect' | 'afterEffect';
  isEntrance: boolean;
}

export interface SlideClickStep {
  actions: AnimatedAction[];
}

export interface ParsedPresentationSlide {
  slideId: string;
  index: number;
  baseSvg: string;
  animatedElements: Array<{
    targetId: string;
    svg: string;
    startsHidden: boolean;
  }>;
  clickSteps: SlideClickStep[];
  hasSlideTransition: boolean;
}

export interface ParsedPresentationDeck {
  title: string;
  slides: ParsedPresentationSlide[];
}

/**
 * Balanced <g ...>...</g> extractor for a specific id="..." inside an SVG string.
 */
export function extractSvgGroupById(
  svg: string,
  targetId: string
): { extractedGroup: string | null; remainingSvg: string } {
  const escaped = targetId.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const openRegex = new RegExp(`<g\\b[^>]*\\bid="${escaped}"[^>]*>`, 'i');
  const match = openRegex.exec(svg);
  if (!match || match.index === undefined) {
    return { extractedGroup: null, remainingSvg: svg };
  }

  const startIdx = match.index;
  const tagRegex = /<\/?g\b[^>]*>/gi;
  tagRegex.lastIndex = startIdx;

  let depth = 0;
  let endIdx = -1;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(svg)) !== null) {
    const tagText = tagMatch[0];
    const isSelfClosing = tagText.endsWith('/>');
    const isClosing = tagText.startsWith('</');

    if (isClosing) {
      depth -= 1;
      if (depth === 0) {
        endIdx = tagMatch.index + tagText.length;
        break;
      }
    } else if (!isSelfClosing) {
      depth += 1;
    }
  }

  if (endIdx === -1) {
    return { extractedGroup: null, remainingSvg: svg };
  }

  const extractedGroup = svg.slice(startIdx, endIdx);
  const remainingSvg = svg.slice(0, startIdx) + svg.slice(endIdx);
  return { extractedGroup, remainingSvg };
}

/**
 * Extracts all <clipPath> and <defs> blocks from the parent slide SVG so extracted layer SVGs retain clipping/gradients.
 */
function extractDefsFromSvg(svg: string): string {
  const clips = [...svg.matchAll(/<clipPath\b[\s\S]*?<\/clipPath>/gi)].map((m) => m[0]);
  const defs = [...svg.matchAll(/<defs\b[\s\S]*?<\/defs>/gi)].map((m) => m[0]);
  return [...defs, ...clips].join('\n');
}

function extractViewBox(svg: string): string {
  const m = svg.match(/viewBox="([^"]+)"/i);
  return m ? m[1] : '0.0 0.0 1280.0 720.0';
}

/**
 * Fetches and parses the full vector slides + animation timeline from Google Slides preview endpoint.
 */
export async function fetchGoogleSlidesAnimatedDeck(
  fileId: string
): Promise<ParsedPresentationDeck | null> {
  const res = await fetch(`https://docs.google.com/presentation/d/${fileId}/preview`, {
    headers: {
      'User-Agent': CHROME_UA,
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  if (!res.ok) return null;
  const html = await res.text();

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const viewerScript = scripts.find((s) => s.includes('var viewerData ='));
  if (!viewerScript) return null;

  const titleMatch = viewerScript.match(/title:\s*'([^']+)'/);
  const title = titleMatch ? titleMatch[1] : `Presentation_${fileId.slice(0, 8)}`;

  const docDataIdx = viewerScript.indexOf('docData:');
  if (docDataIdx === -1) return null;

  const startBracket = viewerScript.indexOf('[', docDataIdx);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let endBracket = startBracket;

  for (let i = startBracket; i < viewerScript.length; i++) {
    const ch = viewerScript[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          endBracket = i + 1;
          break;
        }
      }
    }
  }

  const docData = JSON.parse(viewerScript.slice(startBracket, endBracket));
  const rawSlides: any[] = Array.isArray(docData[1]) ? docData[1] : [];
  if (rawSlides.length === 0) return null;

  // Decode all SK_svgData scripts
  const rawSvgStrings = scripts
    .filter((s) => s.includes('SK_svgData'))
    .map((s) => {
      const m = s.match(/SK_svgData\s*=\s*'([\s\S]*?)';/);
      const encoded = m ? m[1] : s;
      return encoded
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\\//g, '/');
    });

  // Collect all unique external slides-images-rt URLs across all SVGs and inline them as base64 data URIs
  const imageUrls = new Set<string>();
  for (const svg of rawSvgStrings) {
    const matches = svg.matchAll(/xlink:href="(https:\/\/[^"]+)"/g);
    for (const m of matches) {
      if (m[1]) imageUrls.add(m[1]);
    }
  }

  const urlToDataUri = new Map<string, string>();
  await Promise.all(
    Array.from(imageUrls)
      .slice(0, 45)
      .map(async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2200);
        try {
          const imgRes = await fetch(url, {
            headers: { 'User-Agent': CHROME_UA },
            signal: controller.signal,
          });
          if (imgRes.ok) {
            const cType = imgRes.headers.get('content-type') || 'image/png';
            const buf = Buffer.from(await imgRes.arrayBuffer());
            urlToDataUri.set(url, `data:${cType};base64,${buf.toString('base64')}`);
          }
        } catch {
          // ignore single image failure or timeout
        } finally {
          clearTimeout(timer);
        }
      })
  );

  const slideSvgMap = new Map<string, string>();
  for (let svg of rawSvgStrings) {
    for (const [url, dataUri] of urlToDataUri.entries()) {
      svg = svg.split(url).join(dataUri);
    }
    const idMatch = svg.match(/<g id="(p\d+)"/);
    if (idMatch && idMatch[1]) {
      slideSvgMap.set(idMatch[1], svg);
    }
  }

  const slides: ParsedPresentationSlide[] = [];

  for (let idx = 0; idx < rawSlides.length; idx++) {
    const rawSlide = rawSlides[idx];
    const slideId = String(rawSlide[0] || `p${idx + 1}`);
    const fullSvg = slideSvgMap.get(slideId) || rawSvgStrings[idx + 1] || rawSvgStrings[idx] || '';
    if (!fullSvg) continue;

    const viewBox = extractViewBox(fullSvg);
    const sharedDefs = extractDefsFromSvg(fullSvg);

    const rawSteps: any[] = rawSlide[7]?.[0] || [];
    const clickSteps: SlideClickStep[] = [];
    const targetFirstState = new Map<string, boolean>(); // targetId -> startsHidden
    const orderedTargets: string[] = [];
    let hasSlideTransition = false;

    for (const group of rawSteps) {
      const subActions: any[] = Array.isArray(group[0]) ? group[0] : [];
      const stepActions: AnimatedAction[] = [];

      for (let aIdx = 0; aIdx < subActions.length; aIdx++) {
        const act = subActions[aIdx];
        const targetId = String(act[1] || '');
        const durationMs = Math.max(100, Number(act[2]) || 500);
        const delayMs = Math.max(0, Number(act[3]) || 0);
        const rawTrig = Number(act[4]);
        const isEntrance = Boolean(act[5]);
        const isSlideTrans = Boolean(act[6]);

        if (isSlideTrans || targetId === slideId) {
          hasSlideTransition = true;
          continue;
        }

        if (!targetFirstState.has(targetId)) {
          targetFirstState.set(targetId, isEntrance);
          orderedTargets.push(targetId);
        }

        let triggerType: 'clickEffect' | 'withEffect' | 'afterEffect' = 'withEffect';
        if (stepActions.length === 0) {
          triggerType = 'clickEffect';
        } else if (rawTrig === 0 && delayMs > 0) {
          triggerType = 'afterEffect';
        } else {
          triggerType = 'withEffect';
        }

        stepActions.push({
          targetId,
          durationMs,
          delayMs,
          triggerType,
          isEntrance,
        });
      }

      if (stepActions.length > 0) {
        clickSteps.push({ actions: stepActions });
      }
    }

    // Extract each animated targetId group from fullSvg into its own transparent overlay SVG
    let baseSvg = fullSvg;
    const animatedElements: Array<{
      targetId: string;
      svg: string;
      startsHidden: boolean;
    }> = [];

    for (const targetId of orderedTargets) {
      const { extractedGroup, remainingSvg } = extractSvgGroupById(baseSvg, targetId);
      if (extractedGroup) {
        baseSvg = remainingSvg;
        const layerSvg = `<svg version="1.1" width="1280" height="720" viewBox="${viewBox}" fill="none" stroke="none" stroke-linecap="square" stroke-miterlimit="10" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg">${sharedDefs}${extractedGroup}</svg>`;
        animatedElements.push({
          targetId,
          svg: layerSvg,
          startsHidden: targetFirstState.get(targetId) ?? true,
        });
      }
    }

    if (!baseSvg.includes('width="')) {
      baseSvg = baseSvg.replace('<svg ', '<svg width="1280" height="720" ');
    }

    slides.push({
      slideId,
      index: idx + 1,
      baseSvg,
      animatedElements,
      clickSteps,
      hasSlideTransition,
    });
  }

  return { title, slides };
}

// Valid 1x1 transparent PNG fallback in case native @resvg/resvg-js fails on a serverless runtime
const FALLBACK_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function renderSvgToPngBuffer(ResvgCtor: any, svg: string, width = 960): Buffer {
  if (!ResvgCtor) return FALLBACK_1X1_PNG;
  try {
    const resvg = new ResvgCtor(svg, {
      font: { loadSystemFonts: false },
      fitTo: { mode: 'width', value: width },
    });
    return resvg.render().asPng();
  } catch {
    return FALLBACK_1X1_PNG;
  }
}

function escapeXmlAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a complete, standard OpenXML .pptx Buffer with separate animated layers and <p:timing> click effects.
 */
export async function buildAnimatedPptxBuffer(deck: ParsedPresentationDeck): Promise<Buffer> {
  const zipEntries: Array<{ name: string; data: Buffer }> = [];
  const addXml = (name: string, xml: string) => {
    zipEntries.push({ name, data: Buffer.from(xml.trim(), 'utf-8') });
  };

  const slideCount = deck.slides.length;

  // 1. [Content_Types].xml
  const slideOverrides = deck.slides
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
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`
  );

  // 2. _rels/.rels
  addXml(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );

  // 3. ppt/presentation.xml & ppt/_rels/presentation.xml.rels
  const sldIdLst = deck.slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdSlide${i + 1}"/>`)
    .join('\n    ');

  addXml(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rIdMaster1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    ${sldIdLst}
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle>
    <a:defPPr>
      <a:defRPr lang="vi-VN"/>
    </a:defPPr>
  </p:defaultTextStyle>
</p:presentation>`
  );

  const presRels = deck.slides
    .map(
      (_, i) =>
        `<Relationship Id="rIdSlide${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    )
    .join('\n  ');

  addXml(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  ${presRels}
</Relationships>`
  );

  // 4. Slide Master, Slide Layout & Theme
  addXml(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rIdLayout1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle/>
    <p:bodyStyle/>
    <p:otherStyle/>
  </p:txStyles>
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
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
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

  // 5. Generate each slide and its media assets
  const ResvgCtor = await getResvgClass();
  let mediaCounter = 1;
  let rasterCount = 0;

  for (let sIdx = 0; sIdx < slideCount; sIdx++) {
    const slide = deck.slides[sIdx];
    const slideNum = sIdx + 1;
    const rels: string[] = [
      `<Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    ];

    const picShapesXml: string[] = [];

    // Base Slide Picture (spid = 2)
    const baseMediaId = mediaCounter++;
    const basePngName = `image${baseMediaId}.png`;
    const basePngBuf =
      rasterCount < 40
        ? (rasterCount++, renderSvgToPngBuffer(ResvgCtor, slide.baseSvg, 960))
        : FALLBACK_1X1_PNG;
    zipEntries.push({ name: `ppt/media/${basePngName}`, data: basePngBuf });

    const baseRIdPng = `rIdImg${baseMediaId}`;
    rels.push(
      `<Relationship Id="${baseRIdPng}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${basePngName}"/>`
    );

    picShapesXml.push(
      buildPicShapeXml(2, `Slide_${slideNum}_Base`, baseRIdPng)
    );

    // Animated Element Overlay Pictures (spid = 3, 4, ...)
    const targetToSpid = new Map<string, number>();
    let nextSpid = 3;

    for (const animEl of slide.animatedElements) {
      const spid = nextSpid++;
      targetToSpid.set(animEl.targetId, spid);

      const elMediaId = mediaCounter++;
      const elPngName = `image${elMediaId}.png`;
      const elPngBuf =
        rasterCount < 40
          ? (rasterCount++, renderSvgToPngBuffer(ResvgCtor, animEl.svg, 640))
          : FALLBACK_1X1_PNG;
      zipEntries.push({ name: `ppt/media/${elPngName}`, data: elPngBuf });

      const rIdPng = `rIdImg${elMediaId}`;
      rels.push(
        `<Relationship Id="${rIdPng}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${elPngName}"/>`
      );

      picShapesXml.push(
        buildPicShapeXml(spid, `Anim_${animEl.targetId}`, rIdPng)
      );
    }

    // Build <p:timing> if this slide has clickSteps
    const timingXml = buildSlideTimingXml(slide.clickSteps, targetToSpid);
    const transitionXml = slide.hasSlideTransition
      ? `<p:transition spd="med"><p:push dir="l"/></p:transition>`
      : '';

    addXml(
      `ppt/slides/slide${slideNum}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${picShapesXml.join('\n      ')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
  ${transitionXml}
  ${timingXml}
</p:sld>`
    );

    addXml(
      `ppt/slides/_rels/slide${slideNum}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join('\n  ')}
</Relationships>`
    );
  }

  return createZipArchive(zipEntries);
}

/**
 * Fallback OpenXML .pptx builder from slide PNG buffers (used when a Drive file only exposes viewer page images).
 */
export function buildPptxFromSlidePngs(slideBuffers: Buffer[]): Buffer {
  const validBuffers = slideBuffers.length > 0 ? slideBuffers : [FALLBACK_1X1_PNG];
  const zipEntries: Array<{ name: string; data: Buffer }> = [];
  const addXml = (name: string, xml: string) => {
    zipEntries.push({ name, data: Buffer.from(xml.trim(), 'utf-8') });
  };

  const slideOverrides = validBuffers
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

  const sldIdLst = validBuffers
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdSlide${i + 1}"/>`)
    .join('\n    ');

  addXml(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rIdMaster1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    ${sldIdLst}
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle><a:defPPr><a:defRPr lang="vi-VN"/></a:defPPr></p:defaultTextStyle>
</p:presentation>`
  );

  const presRels = validBuffers
    .map(
      (_, i) =>
        `<Relationship Id="rIdSlide${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    )
    .join('\n  ');

  addXml(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  ${presRels}
</Relationships>`
  );

  addXml(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
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

  for (let i = 0; i < validBuffers.length; i++) {
    const slideNum = i + 1;
    const pngName = `image${slideNum}.png`;
    zipEntries.push({ name: `ppt/media/${pngName}`, data: validBuffers[i] });

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

  return createZipArchive(zipEntries);
}

function buildPicShapeXml(
  spid: number,
  name: string,
  rIdPng: string
): string {
  const safeName = escapeXmlAttr(name);
  return `<p:pic>
        <p:nvPicPr>
          <p:cNvPr id="${spid}" name="${safeName}"/>
          <p:cNvPicPr>
            <a:picLocks noChangeAspect="1"/>
          </p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="${rIdPng}"/>
          <a:stretch>
            <a:fillRect/>
          </a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="12192000" cy="6858000"/>
          </a:xfrm>
          <a:prstGeom prst="rect">
            <a:avLst/>
          </a:prstGeom>
        </p:spPr>
      </p:pic>`;
}

function buildSlideTimingXml(
  clickSteps: SlideClickStep[],
  targetToSpid: Map<string, number>
): string {
  if (clickSteps.length === 0 || targetToSpid.size === 0) return '';

  let cTnId = 3;
  const clickPars: string[] = [];
  const animatedSpids = new Set<number>();

  for (const step of clickSteps) {
    const actionPars: string[] = [];

    for (const act of step.actions) {
      const spid = targetToSpid.get(act.targetId);
      if (!spid) continue;
      animatedSpids.add(spid);

      const effectNodeId = cTnId++;
      const setNodeId = cTnId++;
      const fadeNodeId = cTnId++;
      const dur = Math.max(100, act.durationMs);
      const delay = Math.max(0, act.delayMs);

      if (act.isEntrance) {
        actionPars.push(`<p:par>
                              <p:cTn id="${effectNodeId}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="${act.triggerType}">
                                <p:stCondLst>
                                  <p:cond delay="${delay}"/>
                                </p:stCondLst>
                                <p:childTnLst>
                                  <p:set>
                                    <p:cBhvr>
                                      <p:cTn id="${setNodeId}" dur="1" fill="hold">
                                        <p:stCondLst>
                                          <p:cond delay="0"/>
                                        </p:stCondLst>
                                      </p:cTn>
                                      <p:tgtEl>
                                        <p:spTgt spid="${spid}"/>
                                      </p:tgtEl>
                                      <p:attrNameLst>
                                        <p:attrName>style.visibility</p:attrName>
                                      </p:attrNameLst>
                                    </p:cBhvr>
                                    <p:to>
                                      <p:strVal val="visible"/>
                                    </p:to>
                                  </p:set>
                                  <p:animEffect transition="in" filter="fade">
                                    <p:cBhvr>
                                      <p:cTn id="${fadeNodeId}" dur="${dur}"/>
                                      <p:tgtEl>
                                        <p:spTgt spid="${spid}"/>
                                      </p:tgtEl>
                                    </p:cBhvr>
                                  </p:animEffect>
                                </p:childTnLst>
                              </p:cTn>
                            </p:par>`);
      } else {
        actionPars.push(`<p:par>
                              <p:cTn id="${effectNodeId}" presetID="10" presetClass="exit" presetSubtype="0" fill="hold" grpId="0" nodeType="${act.triggerType}">
                                <p:stCondLst>
                                  <p:cond delay="${delay}"/>
                                </p:stCondLst>
                                <p:childTnLst>
                                  <p:animEffect transition="out" filter="fade">
                                    <p:cBhvr>
                                      <p:cTn id="${fadeNodeId}" dur="${dur}"/>
                                      <p:tgtEl>
                                        <p:spTgt spid="${spid}"/>
                                      </p:tgtEl>
                                    </p:cBhvr>
                                  </p:animEffect>
                                  <p:set>
                                    <p:cBhvr>
                                      <p:cTn id="${setNodeId}" dur="1" fill="hold">
                                        <p:stCondLst>
                                          <p:cond delay="${dur - 1}"/>
                                        </p:stCondLst>
                                      </p:cTn>
                                      <p:tgtEl>
                                        <p:spTgt spid="${spid}"/>
                                      </p:tgtEl>
                                      <p:attrNameLst>
                                        <p:attrName>style.visibility</p:attrName>
                                      </p:attrNameLst>
                                    </p:cBhvr>
                                    <p:to>
                                      <p:strVal val="hidden"/>
                                    </p:to>
                                  </p:set>
                                </p:childTnLst>
                              </p:cTn>
                            </p:par>`);
      }
    }

    if (actionPars.length > 0) {
      const outerParId = cTnId++;
      const innerParId = cTnId++;
      clickPars.push(`<p:par>
                  <p:cTn id="${outerParId}" fill="hold">
                    <p:stCondLst>
                      <p:cond delay="indefinite"/>
                    </p:stCondLst>
                    <p:childTnLst>
                      <p:par>
                        <p:cTn id="${innerParId}" fill="hold">
                          <p:stCondLst>
                            <p:cond delay="0"/>
                          </p:stCondLst>
                          <p:childTnLst>
                            ${actionPars.join('\n                            ')}
                          </p:childTnLst>
                        </p:cTn>
                      </p:par>
                    </p:childTnLst>
                  </p:cTn>
                </p:par>`);
    }
  }

  if (clickPars.length === 0) return '';

  const bldLstXml = Array.from(animatedSpids)
    .map((spid) => `<p:bldP spid="${spid}" grpId="0"/>`)
    .join('\n    ');

  return `<p:timing>
    <p:tnLst>
      <p:par>
        <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
          <p:childTnLst>
            <p:seq concurrent="1" nextAc="seek">
              <p:cTn id="2" dur="indefinite" nodeType="mainSeq">
                <p:childTnLst>
                  ${clickPars.join('\n                  ')}
                </p:childTnLst>
              </p:cTn>
              <p:prevCondLst>
                <p:cond evt="onPrev" delay="0">
                  <p:tgtEl><p:sldTgt/></p:tgtEl>
                </p:cond>
              </p:prevCondLst>
              <p:nextCondLst>
                <p:cond evt="onNext" delay="0">
                  <p:tgtEl><p:sldTgt/></p:tgtEl>
                </p:cond>
              </p:nextCondLst>
            </p:seq>
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:tnLst>
    <p:bldLst>
      ${bldLstXml}
    </p:bldLst>
  </p:timing>`;
}

// Precomputed CRC32 table for standard ZIP archive creation
const CRC_TABLE = (() => {
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

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localFileParts: Buffer[] = [];
  const centralDirParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const uncompressed = entry.data;
    const crc = crc32(uncompressed);

    // Use STORE (0) for already-compressed PNGs and DEFLATE (8) for XML/SVG
    const isPng = entry.name.endsWith('.png');
    const method = isPng ? 0 : 8;
    const compressed = isPng ? uncompressed : zlib.deflateRawSync(uncompressed);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8); // compression method
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(localHeader, 30);

    localFileParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk
    centralHeader.writeUInt16LE(0, 36); // int attr
    centralHeader.writeUInt32LE(0, 38); // ext attr
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralDirParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralDirParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localFileParts, centralDirBuf, eocd]);
}
