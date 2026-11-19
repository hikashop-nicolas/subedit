// Rename a static font face so libass finds it by its family. libass matches the family
// (name ID 1) and full name only, and a SemiBold file usually says "Klee One SemiBold" in
// ID 1 (the family only in ID 16, if at all). We rewrite ID 1 to the family and ID 2 to the RIBBI
// style. Collections and broken files come back as is.

const RIBBI = (bold: boolean, italic: boolean): string => (bold ? (italic ? "Bold Italic" : "Bold") : italic ? "Italic" : "Regular");

const utf16 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) >> 8;
    b[i * 2 + 1] = s.charCodeAt(i) & 0xff;
  }
  return b;
};
const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));

function checksum(b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) sum = (sum + ((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  return sum;
}

export function renameFace(bytes: Uint8Array, family: string, bold: boolean, italic: boolean): Uint8Array {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = dv.getUint32(0);
    if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return bytes; // TTF, OTTO, true
    const numTables = dv.getUint16(4);
    let rec = -1;
    for (let i = 0; i < numTables; i++) if (dv.getUint32(12 + i * 16) === 0x6e616d65) rec = 12 + i * 16;
    if (rec < 0) return bytes;
    const nameOff = dv.getUint32(rec + 8);
    const count = dv.getUint16(nameOff + 2);
    const storage = nameOff + dv.getUint16(nameOff + 4);
    const style = RIBBI(bold, italic);
    // Rebuild the name table: same records, ID 1 and ID 2 strings replaced.
    const strings: Uint8Array[] = [];
    const records: number[][] = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12;
      const [pid, eid, lid, nid, len, off] = [0, 2, 4, 6, 8, 10].map((k) => dv.getUint16(r + k));
      let str = bytes.subarray(storage + off, storage + off + len);
      if (nid === 1 || nid === 2) {
        const text = nid === 1 ? family : style;
        str = pid === 3 || pid === 0 ? utf16(text) : latin1(text);
      }
      records.push([pid, eid, lid, nid, str.length, at]);
      strings.push(str);
      at += str.length;
    }
    const head = 6 + count * 12;
    const name = new Uint8Array(head + at);
    const nv = new DataView(name.buffer);
    nv.setUint16(0, 0);
    nv.setUint16(2, count);
    nv.setUint16(4, head);
    records.forEach((r, i) => r.forEach((v, k) => nv.setUint16(6 + i * 12 + k * 2, v)));
    let p = head;
    for (const s of strings) {
      name.set(s, p);
      p += s.length;
    }
    // Append the new table (4-byte aligned) and point the directory at it.
    const base = (bytes.length + 3) & ~3;
    const out = new Uint8Array(base + ((name.length + 3) & ~3));
    out.set(bytes);
    out.set(name, base);
    const ov = new DataView(out.buffer);
    ov.setUint32(rec + 4, checksum(name));
    ov.setUint32(rec + 8, base);
    ov.setUint32(rec + 12, name.length);
    return out;
  } catch {
    return bytes;
  }
}
