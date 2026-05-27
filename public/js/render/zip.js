// 最小 ZIP ライター (store=無圧縮 + CRC32)。外部依存なし。node/ブラウザ両対応。
// pptx は無圧縮 zip でも PowerPoint が開ける。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
export function toBytes(data) {
  if (typeof data === "string") return enc.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function w16(arr, off, v) { arr[off] = v & 0xff; arr[off + 1] = (v >>> 8) & 0xff; }
function w32(arr, off, v) { arr[off] = v & 0xff; arr[off + 1] = (v >>> 8) & 0xff; arr[off + 2] = (v >>> 16) & 0xff; arr[off + 3] = (v >>> 24) & 0xff; }

// files: [{ name: string, data: string|Uint8Array }]
export function zipStore(files) {
  const entries = files.map((f) => {
    const nameBytes = enc.encode(f.name);
    const data = toBytes(f.data);
    return { nameBytes, data, crc: crc32(data) };
  });

  // 各エントリの local header サイズ = 30 + name + data
  let total = 0;
  for (const e of entries) total += 30 + e.nameBytes.length + e.data.length;
  // central directory = 46 + name (各), + EOCD 22
  let cdSize = 0;
  for (const e of entries) cdSize += 46 + e.nameBytes.length;
  const out = new Uint8Array(total + cdSize + 22);

  let off = 0;
  const offsets = [];
  for (const e of entries) {
    offsets.push(off);
    w32(out, off, 0x04034b50); // local file header sig
    w16(out, off + 4, 20);      // version needed
    w16(out, off + 6, 0);       // flags
    w16(out, off + 8, 0);       // method = store
    w16(out, off + 10, 0);      // mod time
    w16(out, off + 12, 0);      // mod date
    w32(out, off + 14, e.crc);
    w32(out, off + 18, e.data.length); // comp size
    w32(out, off + 22, e.data.length); // uncomp size
    w16(out, off + 26, e.nameBytes.length);
    w16(out, off + 28, 0);      // extra len
    out.set(e.nameBytes, off + 30);
    out.set(e.data, off + 30 + e.nameBytes.length);
    off += 30 + e.nameBytes.length + e.data.length;
  }

  const cdStart = off;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    w32(out, off, 0x02014b50); // central dir header sig
    w16(out, off + 4, 20);      // version made by
    w16(out, off + 6, 20);      // version needed
    w16(out, off + 8, 0);       // flags
    w16(out, off + 10, 0);      // method
    w16(out, off + 12, 0);      // mod time
    w16(out, off + 14, 0);      // mod date
    w32(out, off + 16, e.crc);
    w32(out, off + 20, e.data.length);
    w32(out, off + 24, e.data.length);
    w16(out, off + 28, e.nameBytes.length);
    w16(out, off + 30, 0);      // extra
    w16(out, off + 32, 0);      // comment
    w16(out, off + 34, 0);      // disk number
    w16(out, off + 36, 0);      // internal attrs
    w32(out, off + 38, 0);      // external attrs
    w32(out, off + 42, offsets[i]); // local header offset
    out.set(e.nameBytes, off + 46);
    off += 46 + e.nameBytes.length;
  }

  // End of central directory
  w32(out, off, 0x06054b50);
  w16(out, off + 4, 0);
  w16(out, off + 6, 0);
  w16(out, off + 8, entries.length);
  w16(out, off + 10, entries.length);
  w32(out, off + 12, cdSize);
  w32(out, off + 16, cdStart);
  w16(out, off + 20, 0);

  return out;
}
