// ネイティブテキスト pptx 出力。textlayout.js / formulafont.js の RenderItem を
// PowerPoint ネイティブ図形に変換する (インク不使用＝本物の編集可能テキスト)。
//   text → テキストボックス (p:sp + a:txBody)
//   line → 直線コネクタ (p:cxnSp, prstGeom=line)
//   poly → フリーフォーム (p:sp + a:custGeom, 線のみ)
//   disc → 楕円 (p:sp, prstGeom=ellipse, 塗り)
// 静的骨格は skeleton.json を流用。出力は Uint8Array (pptx zip)。
import { zipStore } from "./zip.js";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const EMU_PER_CM = 360000;
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const DECL_PP = "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n";

const emu = (cm) => Math.round(cm * EMU_PER_CM);
const ptSz = (cm) => Math.max(100, Math.round((cm / 2.54) * 72 * 100)); // a:rPr sz (1/100 pt)
function srgb(c) { let s = (c || "#000000").replace("#", ""); if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]; return s.toUpperCase(); }
function escXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// テキスト字面上端の補正: SVG は baseline=item.y。pptx テキストボックスは
// 行頭の余白(行間)分だけ字が下がるので、ボックス上端を baseline - size*TOP に置く。
const TOP_RATIO = 0.92;

function textSp(it, id, fontName) {
  const size = it.size;
  const w = it._w != null ? it._w : size * (it.text ? it.text.length : 1) * 0.6;
  const ox = emu(it.x), oy = emu(it.y - size * TOP_RATIO);
  const cx = Math.max(emu(w) + emu(size * 0.3), 1), cy = Math.max(emu(size * 1.25), 1);
  const b = it.bold ? ' b="1"' : "", i = it.italic ? ' i="1"' : "";
  const col = srgb(it.color);
  const fn = escXml(it.font || fontName);
  return [
    "<p:sp>",
    `<p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>',
    '<p:txBody>',
    '<a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr>',
    '<a:p><a:pPr algn="l"/>',
    `<a:r><a:rPr lang="ja-JP" sz="${ptSz(size)}"${b}${i} dirty="0"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill>`,
    `<a:latin typeface="${fn}"/><a:ea typeface="${fn}"/></a:rPr><a:t>${escXml(it.text)}</a:t></a:r>`,
    '</a:p></p:txBody></p:sp>',
  ].join("");
}

function lineSp(it, id) {
  const x1 = it.x1, y1 = it.y1, x2 = it.x2, y2 = it.y2;
  const ox = Math.min(x1, x2), oy = Math.min(y1, y2);
  const cx = Math.max(emu(Math.abs(x2 - x1)), 1), cy = Math.max(emu(Math.abs(y2 - y1)), 1);
  const flipH = x2 < x1 ? ' flipH="1"' : "", flipV = y2 < y1 ? ' flipV="1"' : "";
  const wEmu = Math.max(emu(it.w || 0.05), 3175);
  const col = srgb(it.color);
  return [
    "<p:cxnSp>",
    `<p:nvCxnSpPr><p:cNvPr id="${id}" name="l${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`,
    `<p:spPr><a:xfrm${flipH}${flipV}><a:off x="${emu(ox)}" y="${emu(oy)}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
    '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>',
    `<a:ln w="${wEmu}" cap="rnd"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`,
  ].join("");
}

function discSp(it, id) {
  const r = it.r;
  const ox = emu(it.cx - r), oy = emu(it.cy - r), d = Math.max(emu(2 * r), 1);
  const col = srgb(it.color);
  return [
    "<p:sp>",
    `<p:nvSpPr><p:cNvPr id="${id}" name="d${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${d}" cy="${d}"/></a:xfrm>`,
    `<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${col}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>`,
    "<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>",
  ].join("");
}

function polySp(it, id) {
  const xs = it.pts.map((p) => p[0]), ys = it.pts.map((p) => p[1]);
  const ox = Math.min(...xs), oy = Math.min(...ys);
  const cxCm = Math.max(...xs) - ox, cyCm = Math.max(...ys) - oy;
  const cx = Math.max(emu(cxCm), 1), cy = Math.max(emu(cyCm), 1);
  const wEmu = Math.max(emu(it.w || 0.05), 3175);
  const col = srgb(it.color);
  const path = it.pts.map((p, k) => {
    const px = emu(p[0] - ox), py = emu(p[1] - oy);
    return k === 0 ? `<a:moveTo><a:pt x="${px}" y="${py}"/></a:moveTo>` : `<a:lnTo><a:pt x="${px}" y="${py}"/></a:lnTo>`;
  }).join("");
  return [
    "<p:sp>",
    `<p:nvSpPr><p:cNvPr id="${id}" name="p${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${emu(ox)}" y="${emu(oy)}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="0" b="0"/>`,
    `<a:pathLst><a:path w="${cx}" h="${cy}" fill="none">${path}</a:path></a:pathLst></a:custGeom>`,
    `<a:noFill/><a:ln w="${wEmu}" cap="rnd"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill></a:ln></p:spPr>`,
    "<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>",
  ].join("");
}

function itemsBbox(items) {
  let xn = Infinity, yn = Infinity, xx = -Infinity, yx = -Infinity;
  for (const it of items) {
    if (it.t === "text") { const w = it._w != null ? it._w : 0; xn = Math.min(xn, it.x); xx = Math.max(xx, it.x + w); yn = Math.min(yn, it.y - it.size * TOP_RATIO); yx = Math.max(yx, it.y + it.size * 0.3); }
    else if (it.t === "line") { xn = Math.min(xn, it.x1, it.x2); xx = Math.max(xx, it.x1, it.x2); yn = Math.min(yn, it.y1, it.y2); yx = Math.max(yx, it.y1, it.y2); }
    else if (it.t === "poly") { for (const [x, y] of it.pts) { xn = Math.min(xn, x); xx = Math.max(xx, x); yn = Math.min(yn, y); yx = Math.max(yx, y); } }
    else if (it.t === "disc") { xn = Math.min(xn, it.cx - it.r); xx = Math.max(xx, it.cx + it.r); yn = Math.min(yn, it.cy - it.r); yx = Math.max(yx, it.cy + it.r); }
  }
  if (!isFinite(xn)) return null;
  return [xn, yn, xx, yx];
}

// 連続する同スタイル・隣接のテキスト item を1つに再結合 (1文字=1itemで来るため、
// 未編集の文字列を1テキストボックスに戻してネイティブ編集性を保つ)。
function canMerge(a, b) {
  if (a.t !== "text" || b.t !== "text") return false;
  if (!!a.bold !== !!b.bold || !!a.italic !== !!b.italic) return false;
  if ((a.color || "") !== (b.color || "")) return false;
  if ((a.font || "") !== (b.font || "")) return false;
  if (Math.abs(a.size - b.size) > 1e-4 || Math.abs(a.y - b.y) > 1e-4) return false;
  const aw = a._w != null ? a._w : 0;
  return Math.abs(b.x - (a.x + aw)) <= a.size * 0.3; // ほぼ連続
}
function mergeTextItems(items) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && canMerge(last, it)) { last.text += it.text; last._w = (last._w || 0) + (it._w || 0); }
    else out.push({ ...it });
  }
  return out;
}

// 各ブロックを <p:grpSp> でまとめ、ブロック単位でアニメ対象にできるようにする。
// 返り値: { xml, spids } (spids = [{gid, dir}], dir = 登場方向 or null)
function buildSlideXml(blocks, defaultColor, fontName) {
  const p = [];
  p.push(DECL);
  p.push(`<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">`);
  p.push("<p:cSld><p:spTree>");
  p.push('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>');
  p.push('<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>');
  let id = 1;
  const spids = [];
  for (const blk of blocks) {
    const items = mergeTextItems((blk.items || []).filter((it) => it.t !== "text" || it.text));
    if (!items.length) continue;
    const bb = itemsBbox(items);
    const gid = ++id;
    spids.push({ gid, dir: blk.anim || null });
    const ox = emu(bb[0]), oy = emu(bb[1]), cx = Math.max(emu(bb[2] - bb[0]), 1), cy = Math.max(emu(bb[3] - bb[1]), 1);
    p.push("<p:grpSp>");
    p.push(`<p:nvGrpSpPr><p:cNvPr id="${gid}" name="ブロック ${gid}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`);
    p.push(`<p:grpSpPr><a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="${ox}" y="${oy}"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm></p:grpSpPr>`);
    for (const it of items) {
      const c = { ...it, color: it.color || defaultColor };
      if (it.t === "text") p.push(textSp(c, ++id, fontName));
      else if (it.t === "line") p.push(lineSp(c, ++id));
      else if (it.t === "poly") p.push(polySp(c, ++id));
      else if (it.t === "disc") p.push(discSp(c, ++id));
    }
    p.push("</p:grpSp>");
  }
  p.push("</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>");
  return { xml: p.join(""), spids };
}

// 左→右ワイプ (entr)。手書き版 timing.py で実機検証済みの seq/mainSeq/clickEffect 構造を
// 流用し、葉を drawProgress→animEffect(filter="wipe(left)") に差し替え。ブロック=1クリック。
function buildTimingWipe(spids, durMs) {
  durMs = durMs || 500;
  const p = [];
  p.push("<p:timing><p:tnLst><p:par>");
  p.push('<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>');
  p.push('<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>');
  const WIPE = { left: "left", right: "right", up: "up", down: "down" };
  let nid = 3;
  for (const e of spids) {
    const sp = e.gid, dir = WIPE[e.dir] || "left";
    const outer = nid, mid = nid + 1, click = nid + 2; nid += 3;
    p.push("<p:par>");
    p.push(`<p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>`);
    p.push("<p:par>");
    p.push(`<p:cTn id="${mid}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`);
    p.push("<p:par>");
    p.push(`<p:cTn id="${click}" presetID="22" presetClass="entr" presetSubtype="8" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`);
    const setId = nid, effId = nid + 1; nid += 2;
    p.push(`<p:set><p:cBhvr><p:cTn id="${setId}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${sp}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`);
    p.push(`<p:animEffect transition="in" filter="wipe(${dir})"><p:cBhvr><p:cTn id="${effId}" dur="${durMs}"/><p:tgtEl><p:spTgt spid="${sp}"/></p:tgtEl></p:cBhvr></p:animEffect>`);
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

function buildPresentation(nSlides, wCm, hCm) {
  let sldIds = "";
  for (let i = 0; i < nSlides; i++) sldIds += `<p:sldId id="${256 + i}" r:id="rId${7 + i}"/>`;
  return DECL_PP +
    `<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1" autoCompressPictures="0">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${sldIds}</p:sldIdLst>` +
    `<p:sldSz cx="${emu(wCm)}" cy="${emu(hCm)}" type="screen4x3"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
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
function buildContentTypes(nSlides) {
  const CT = "application/vnd.openxmlformats-officedocument.presentationml.";
  const p = [DECL,
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.presentationml.printerSettings"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
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
  p.push("</Types>");
  return p.join("");
}

// slidesBlocks: [[block,...], ...]  opts: { color, slideWCm, slideHCm, fontName }
export function buildPptxText(slidesBlocks, opts, skeletonParts) {
  const color = (opts && opts.color) || "#000000";
  const wCm = (opts && opts.slideWCm) || 33.867;
  const hCm = (opts && opts.slideHCm) || 19.05;
  const fontName = (opts && opts.fontName) || "Noto Sans JP";
  const anim = !(opts && opts.anim === false);
  const nSlides = slidesBlocks.length;
  const files = [];
  for (const [path, part] of Object.entries(skeletonParts)) {
    if (part.t !== undefined) files.push({ name: path, data: part.t });
    else files.push({ name: path, data: b64ToBytes(part.b) });
  }
  for (let s = 0; s < nSlides; s++) {
    const { xml, spids } = buildSlideXml(slidesBlocks[s], color, fontName);
    let slideXml = xml;
    if (anim && spids.length) slideXml += buildTimingWipe(spids);
    slideXml += "</p:sld>";
    files.push({ name: `ppt/slides/slide${s + 1}.xml`, data: slideXml });
    const rel = ['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      `<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout7.xml"/>`,
      "</Relationships>"];
    files.push({ name: `ppt/slides/_rels/slide${s + 1}.xml.rels`, data: DECL_PP + rel.join("") });
  }
  files.push({ name: "ppt/presentation.xml", data: buildPresentation(nSlides, wCm, hCm) });
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: buildPresentationRels(nSlides) });
  files.push({ name: "[Content_Types].xml", data: buildContentTypes(nSlides) });
  return zipStore(files);
}

function b64ToBytes(b64) {
  if (typeof atob === "function") { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  return new Uint8Array(Buffer.from(b64, "base64"));
}
