// pptx 組み立て (Python inkml.py/slide_xml.py/timing.py/builder.py の動的パートを JS 移植)。
// 静的骨格は skeleton.json(public) を使う。出力は Uint8Array (pptx zip)。
import { zipStore, toBytes } from "./zip.js";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const EMU_PER_CM = 360000, INK_PER_CM = 1000;
const BOLD_BRUSH_MULT = 1.45;
// python-pptx が生成するパート(presentation/rels)のXML宣言 (単一引用符+改行)
const DECL_PP = "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n";

// 4x4 透明PNG (Python transparent_png_bytes と同一バイト)
const TRANSPARENT_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAADElEQVR4nGNgoBwAAABEAAHX40j9AAAAAElFTkSuQmCC";

// Python round (偶数丸め) を再現
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
function cmToEmu(cm) { return pyRound(cm * EMU_PER_CM); }
function cmToInk(cm) { return pyRound(cm * INK_PER_CM); }
function normColor(c) { if (!c.startsWith("#")) c = "#" + c; return c.toUpperCase(); }
function fixed5(n) { return n.toFixed(5); }

function b64ToBytes(b64) {
  if (typeof atob === "function") {
    const bin = atob(b64); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function buildInkml(strokes, color, brushWidthCm, timestamp) {
  timestamp = timestamp || "2026-05-18T00:00:00.000";
  const defaultColor = normColor(color);
  const boldWidthCm = brushWidthCm * BOLD_BRUSH_MULT;
  const combos = new Map();
  for (const s of strokes) {
    if (!s.points_cm.length) continue;
    const c = s.color ? normColor(s.color) : defaultColor;
    const key = `${c}|${s.bold ? 1 : 0}`;
    if (!combos.has(key)) combos.set(key, { id: `br${combos.size}`, color: c, bold: !!s.bold });
  }
  if (combos.size === 0) combos.set(`${defaultColor}|0`, { id: "br0", color: defaultColor, bold: false });

  const p = [];
  p.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  p.push('<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">');
  p.push("<inkml:definitions>");
  p.push('<inkml:context xml:id="ctx0">');
  p.push('<inkml:inkSource xml:id="inkSrc0">');
  p.push("<inkml:traceFormat>");
  p.push('<inkml:channel name="X" type="integer" min="-2.14748E9" max="2.14748E9" units="cm"/>');
  p.push('<inkml:channel name="Y" type="integer" min="-2.14748E9" max="2.14748E9" units="cm"/>');
  p.push('<inkml:channel name="F" type="integer" max="32767" units="dev"/>');
  p.push("</inkml:traceFormat>");
  p.push("<inkml:channelProperties>");
  p.push('<inkml:channelProperty channel="X" name="resolution" value="1000" units="1/cm"/>');
  p.push('<inkml:channelProperty channel="Y" name="resolution" value="1000" units="1/cm"/>');
  p.push('<inkml:channelProperty channel="F" name="resolution" value="0" units="1/dev"/>');
  p.push("</inkml:channelProperties>");
  p.push("</inkml:inkSource>");
  p.push(`<inkml:timestamp xml:id="ts0" timeString="${timestamp}"/>`);
  p.push("</inkml:context>");
  for (const { id, color: c, bold } of combos.values()) {
    const w = bold ? boldWidthCm : brushWidthCm;
    p.push(`<inkml:brush xml:id="${id}">`);
    p.push(`<inkml:brushProperty name="width" value="${fixed5(w)}" units="cm"/>`);
    p.push(`<inkml:brushProperty name="height" value="${fixed5(w)}" units="cm"/>`);
    p.push(`<inkml:brushProperty name="color" value="${c}"/>`);
    p.push("</inkml:brush>");
  }
  p.push("</inkml:definitions>");
  for (const s of strokes) {
    if (!s.points_cm.length) continue;
    const triples = [];
    for (let i = 0; i < s.points_cm.length; i++) {
      const [x, y] = s.points_cm[i];
      let f = 16384;
      if (s.pressures && i < s.pressures.length) f = pyRound(Math.max(0, Math.min(1, s.pressures[i])) * 32767);
      triples.push(`${cmToInk(x)} ${cmToInk(y)} ${f}`);
    }
    const c = s.color ? normColor(s.color) : defaultColor;
    const ref = combos.get(`${c}|${s.bold ? 1 : 0}`).id;
    p.push(`<inkml:trace contextRef="#ctx0" brushRef="#${ref}">${triples.join(", ")}</inkml:trace>`);
  }
  p.push("</inkml:ink>");
  return p.join("");
}

// blocks: [{sp_id, inner_id, name, x_cm, y_cm, w_cm, h_cm, ink_rel_id, fallback_rel_id}]
export function buildSlideXml(blocks, slideWCm, slideHCm) {
  const p = [];
  p.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  p.push(`<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">`);
  p.push("<p:cSld><p:spTree>");
  p.push("<p:nvGrpSpPr>");
  p.push('<p:cNvPr id="1" name=""/>');
  p.push("<p:cNvGrpSpPr/><p:nvPr/>");
  p.push("</p:nvGrpSpPr>");
  p.push("<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>");
  for (const blk of blocks) {
    const ox = cmToEmu(blk.x_cm), oy = cmToEmu(blk.y_cm);
    const ex = Math.max(cmToEmu(blk.w_cm), 1), ey = Math.max(cmToEmu(blk.h_cm), 1);
    const groupName = `グループ化 ${blk.sp_id}`;
    p.push("<p:grpSp>");
    p.push("<p:nvGrpSpPr>");
    p.push(`<p:cNvPr id="${blk.sp_id}" name="${groupName}"/>`);
    p.push("<p:cNvGrpSpPr/><p:nvPr/>");
    p.push("</p:nvGrpSpPr>");
    p.push("<p:grpSpPr><a:xfrm>");
    p.push(`<a:off x="${ox}" y="${oy}"/>`);
    p.push(`<a:ext cx="${ex}" cy="${ey}"/>`);
    p.push(`<a:chOff x="${ox}" y="${oy}"/>`);
    p.push(`<a:chExt cx="${ex}" cy="${ey}"/>`);
    p.push("</a:xfrm></p:grpSpPr>");
    p.push(`<mc:AlternateContent xmlns:mc="${MC}" xmlns:p14="${P14}">`);
    p.push('<mc:Choice Requires="p14">');
    p.push(`<p:contentPart xmlns:r="${R}" p14:bwMode="auto" r:id="${blk.ink_rel_id}">`);
    p.push("<p14:nvContentPartPr>");
    p.push(`<p14:cNvPr id="${blk.inner_id}" name="${blk.name}"/>`);
    p.push("<p14:cNvContentPartPr/><p14:nvPr/>");
    p.push("</p14:nvContentPartPr>");
    p.push("<p14:xfrm>");
    p.push(`<a:off x="${ox}" y="${oy}"/>`);
    p.push(`<a:ext cx="${ex}" cy="${ey}"/>`);
    p.push("</p14:xfrm>");
    p.push("</p:contentPart>");
    p.push("</mc:Choice>");
    p.push('<mc:Fallback xmlns="">');
    p.push("<p:pic>");
    p.push("<p:nvPicPr>");
    p.push(`<p:cNvPr id="${blk.inner_id}" name="${blk.name}"/>`);
    p.push("<p:cNvPicPr/><p:nvPr/>");
    p.push("</p:nvPicPr>");
    p.push("<p:blipFill>");
    p.push(`<a:blip r:embed="${blk.fallback_rel_id}"/>`);
    p.push("<a:stretch><a:fillRect/></a:stretch>");
    p.push("</p:blipFill>");
    p.push("<p:spPr><a:xfrm>");
    p.push(`<a:off x="${ox}" y="${oy}"/>`);
    p.push(`<a:ext cx="${ex}" cy="${ey}"/>`);
    p.push("</a:xfrm>");
    p.push('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>');
    p.push("</p:spPr>");
    p.push("</p:pic>");
    p.push("</mc:Fallback>");
    p.push("</mc:AlternateContent>");
    p.push("</p:grpSp>");
  }
  p.push("</p:spTree></p:cSld>");
  p.push("<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>");
  return p.join("");
}

export function buildTiming(spIds, durationMs) {
  durationMs = durationMs || 1000;
  const groups = spIds.map((x) => (Array.isArray(x) ? x : [x]));
  const p = [];
  p.push("<p:timing><p:tnLst><p:par>");
  p.push('<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">');
  p.push("<p:childTnLst>");
  p.push('<p:seq concurrent="1" nextAc="seek">');
  p.push('<p:cTn id="2" dur="indefinite" nodeType="mainSeq">');
  p.push("<p:childTnLst>");
  let nextId = 3;
  for (const group of groups) {
    const outer = nextId, mid = nextId + 1, click = nextId + 2;
    nextId += 3;
    p.push("<p:par>");
    p.push(`<p:cTn id="${outer}" fill="hold">`);
    p.push('<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>');
    p.push("<p:childTnLst>");
    p.push("<p:par>");
    p.push(`<p:cTn id="${mid}" fill="hold">`);
    p.push('<p:stCondLst><p:cond delay="0"/></p:stCondLst>');
    p.push("<p:childTnLst>");
    p.push("<p:par>");
    p.push(`<p:cTn id="${click}" presetID="63" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect">`);
    p.push('<p:stCondLst><p:cond delay="0"/></p:stCondLst>');
    p.push("<p:childTnLst>");
    for (const spId of group) {
      const setId = nextId, animId = nextId + 1;
      nextId += 2;
      p.push("<p:set>");
      p.push("<p:cBhvr>");
      p.push(`<p:cTn id="${setId}" dur="1" fill="hold">`);
      p.push('<p:stCondLst><p:cond delay="0"/></p:stCondLst>');
      p.push("</p:cTn>");
      p.push(`<p:tgtEl><p:spTgt spid="${spId}"/></p:tgtEl>`);
      p.push("<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>");
      p.push("</p:cBhvr>");
      p.push('<p:to><p:strVal val="visible"/></p:to>');
      p.push("</p:set>");
      p.push('<p:anim calcmode="lin" valueType="num">');
      p.push("<p:cBhvr>");
      p.push(`<p:cTn id="${animId}" dur="${durationMs}" fill="hold"/>`);
      p.push(`<p:tgtEl><p:spTgt spid="${spId}"/></p:tgtEl>`);
      p.push("<p:attrNameLst><p:attrName>drawProgress</p:attrName></p:attrNameLst>");
      p.push("</p:cBhvr>");
      p.push("<p:tavLst>");
      p.push('<p:tav tm="0"><p:val><p:fltVal val="0"/></p:val></p:tav>');
      p.push('<p:tav tm="100000"><p:val><p:fltVal val="1"/></p:val></p:tav>');
      p.push("</p:tavLst>");
      p.push("</p:anim>");
    }
    p.push("</p:childTnLst></p:cTn></p:par>");
    p.push("</p:childTnLst></p:cTn></p:par>");
    p.push("</p:childTnLst></p:cTn></p:par>");
  }
  p.push("</p:childTnLst></p:cTn>");
  p.push('<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>');
  p.push('<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>');
  p.push("</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>");
  return p.join("");
}

function slideRels(blockCount) {
  const r = [];
  r.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  r.push('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">');
  r.push(`<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout7.xml"/>`);
  // ink rels (全block) → image rels (全block) の順 (builder.py 準拠)。グローバルファイル番号は呼び出し側で付与
  return r; // 続きは buildPptx で組み立て
}

export function buildPptx(slidesBlocks, opts, skeletonParts) {
  const color = (opts && opts.color) || "#000000";
  const brushWidthCm = (opts && opts.brushWidthCm) || 0.06;
  const slideWCm = (opts && opts.slideWCm) || 33.867;
  const slideHCm = (opts && opts.slideHCm) || 19.05;

  const files = [];
  // 静的骨格
  for (const [path, part] of Object.entries(skeletonParts)) {
    if (part.t !== undefined) files.push({ name: path, data: part.t });
    else files.push({ name: path, data: b64ToBytes(part.b) });
  }

  const pngBytes = b64ToBytes(TRANSPARENT_PNG_B64);
  let globalCounter = 0; // ink/image 共通の通し番号
  const nSlides = slidesBlocks.length;

  for (let s = 0; s < nSlides; s++) {
    const blocks = slidesBlocks[s];
    const blockInputs = [];
    const spIds = [];
    const inkRefs = []; // {rid, file}
    const imgRefs = [];
    for (let i = 0; i < blocks.length; i++) {
      globalCounter += 1;
      const g = globalCounter;
      const inkRid = `rId${1000 + 2 * i}`;
      const imgRid = `rId${1000 + 2 * i + 1}`;
      const spId = 100 + i, innerId = 1000 + i;
      spIds.push(spId);
      // bbox: w/h は Block 由来
      blockInputs.push({
        sp_id: spId, inner_id: innerId, name: `インク ${i + 1}`,
        x_cm: blocks[i].x_cm, y_cm: blocks[i].y_cm,
        w_cm: Math.max(blocks[i].w_cm, 0.1), h_cm: Math.max(blocks[i].h_cm, 0.1),
        ink_rel_id: inkRid, fallback_rel_id: imgRid,
      });
      files.push({ name: `ppt/ink/ink${g}.xml`, data: buildInkml(blocks[i].placed, color, brushWidthCm) });
      files.push({ name: `ppt/media/image${g}.png`, data: pngBytes });
      inkRefs.push({ rid: inkRid, file: g });
      imgRefs.push({ rid: imgRid, file: g });
    }
    let slideXml = buildSlideXml(blockInputs, slideWCm, slideHCm);
    slideXml += "</p:sld>";
    const timing = buildTiming(spIds);
    slideXml = slideXml.replace("</p:sld>", timing + "</p:sld>");
    files.push({ name: `ppt/slides/slide${s + 1}.xml`, data: slideXml });

    const rel = ['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      `<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout7.xml"/>`];
    for (const ir of inkRefs) rel.push(`<Relationship Id="${ir.rid}" Type="${R}/customXml" Target="../ink/ink${ir.file}.xml"/>`);
    for (const ig of imgRefs) rel.push(`<Relationship Id="${ig.rid}" Type="${R}/image" Target="../media/image${ig.file}.png"/>`);
    rel.push("</Relationships>");
    files.push({ name: `ppt/slides/_rels/slide${s + 1}.xml.rels`, data: DECL_PP + rel.join("") });
  }
  const totalInk = globalCounter;

  // presentation.xml
  files.push({ name: "ppt/presentation.xml", data: buildPresentation(nSlides, slideWCm, slideHCm) });
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: buildPresentationRels(nSlides) });
  files.push({ name: "[Content_Types].xml", data: buildContentTypes(nSlides, totalInk) });

  return zipStore(files);
}

function buildPresentation(nSlides, slideWCm, slideHCm) {
  const cx = cmToEmu(slideWCm), cy = cmToEmu(slideHCm);
  let sldIds = "";
  for (let i = 0; i < nSlides; i++) sldIds += `<p:sldId id="${256 + i}" r:id="rId${7 + i}"/>`;
  const dts = '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' +
    [0, 457200, 914400, 1371600, 1828800, 2286000, 2743200, 3200400, 3657600].map((marL, k) =>
      `<a:lvl${k + 1}pPr marL="${marL}" algn="l" defTabSz="457200" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${k + 1}pPr>`).join("") +
    "</p:defaultTextStyle>";
  // python-pptx 準拠: XML宣言は単一引用符+改行、sldSz に type 属性
  return DECL_PP +
    `<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1" autoCompressPictures="0">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${sldIds}</p:sldIdLst>` +
    `<p:sldSz cx="${cx}" cy="${cy}" type="screen4x3"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/>${dts}</p:presentation>`;
}

function buildPresentationRels(nSlides) {
  const r = ['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    `<Relationship Id="rId1" Type="${R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    `<Relationship Id="rId2" Type="${R}/printerSettings" Target="printerSettings/printerSettings1.bin"/>`,
    `<Relationship Id="rId3" Type="${R}/presProps" Target="presProps.xml"/>`,
    `<Relationship Id="rId4" Type="${R}/viewProps" Target="viewProps.xml"/>`,
    `<Relationship Id="rId5" Type="${R}/theme" Target="theme/theme1.xml"/>`,
    `<Relationship Id="rId6" Type="${R}/tableStyles" Target="tableStyles.xml"/>`];
  for (let i = 0; i < nSlides; i++) r.push(`<Relationship Id="rId${7 + i}" Type="${R}/slide" Target="slides/slide${i + 1}.xml"/>`);
  r.push("</Relationships>");
  return DECL_PP + r.join("");
}

function buildContentTypes(nSlides, totalInk) {
  const CT = "application/vnd.openxmlformats-officedocument.presentationml.";
  const p = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.presentationml.printerSettings"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    `<Override PartName="/ppt/presProps.xml" ContentType="${CT}presProps+xml"/>`,
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT}presentation.main+xml"/>`,
    `<Override PartName="/ppt/tableStyles.xml" ContentType="${CT}tableStyles+xml"/>`,
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    `<Override PartName="/ppt/viewProps.xml" ContentType="${CT}viewProps+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}slideMaster+xml"/>`];
  for (let i = 1; i <= 11; i++) p.push(`<Override PartName="/ppt/slideLayouts/slideLayout${i}.xml" ContentType="${CT}slideLayout+xml"/>`);
  for (let i = 1; i <= nSlides; i++) p.push(`<Override PartName="/ppt/slides/slide${i}.xml" ContentType="${CT}slide+xml"/>`);
  for (let i = 1; i <= totalInk; i++) p.push(`<Override PartName="/ppt/ink/ink${i}.xml" ContentType="application/inkml+xml"/>`);
  p.push("</Types>");
  return p.join("");
}
