function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function tiffRange(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xff) { offset++; continue; }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const end = offset + 2 + length;
      if (length < 2 || end > bytes.length) break;
      const data = offset + 4;
      if (marker === 0xe1 && ascii(bytes, data, 6) === 'Exif\0\0') return [data + 6, end];
      offset = end;
    }
  }

  if (ascii(bytes, 1, 3) === 'PNG') {
    let offset = 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) break;
      if (ascii(bytes, offset + 4, 4) === 'eXIf') return [offset + 8, offset + 8 + length];
      offset = end;
    }
  }

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    let offset = 12;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset + 4, true);
      const end = offset + 8 + length;
      if (end > bytes.length) break;
      if (ascii(bytes, offset, 4) === 'EXIF') {
        const start = offset + 8;
        return ascii(bytes, start, 6) === 'Exif\0\0' ? [start + 6, end] : [start, end];
      }
      offset = end + (length % 2);
    }
  }
  return null;
}

function parseTiff(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endian = ascii(bytes, start, 2);
  if (endian !== 'II' && endian !== 'MM') return { date: null, gps: null };
  const little = endian === 'II';
  const within = (offset, length) => offset >= 0 && start + offset + length <= end;
  const u16 = (offset) => { if (!within(offset, 2)) throw new Error('EXIF inválido'); return view.getUint16(start + offset, little); };
  const u32 = (offset) => { if (!within(offset, 4)) throw new Error('EXIF inválido'); return view.getUint32(start + offset, little); };
  if (u16(2) !== 42) return { date: null, gps: null };

  function ifd(offset) {
    const entries = new Map();
    const count = u16(offset);
    if (count > 512 || !within(offset + 2, count * 12)) throw new Error('EXIF inválido');
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const amount = u32(entry + 4);
      const unit = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 }[type];
      if (!unit || amount > 4096) continue;
      const size = unit * amount;
      const position = size <= 4 ? entry + 8 : u32(entry + 8);
      if (within(position, size)) entries.set(tag, { type, amount, position });
    }
    return entries;
  }

  function text(entry) {
    if (!entry || entry.type !== 2) return null;
    return ascii(bytes, start + entry.position, entry.amount).split('\0')[0].trim() || null;
  }

  function pointer(entry) {
    if (!entry || entry.type !== 4 || entry.amount !== 1) return null;
    return u32(entry.position);
  }

  function coordinate(entry, ref) {
    if (!entry || entry.type !== 5 || entry.amount < 3 || !ref) return null;
    const values = [];
    for (let i = 0; i < 3; i++) {
      const numerator = u32(entry.position + i * 8);
      const denominator = u32(entry.position + i * 8 + 4);
      if (!denominator) return null;
      values.push(numerator / denominator);
    }
    const decimal = values[0] + values[1] / 60 + values[2] / 3600;
    return ['S', 'W'].includes(ref.toUpperCase()) ? -decimal : decimal;
  }

  const main = ifd(u32(4));
  const exifOffset = pointer(main.get(0x8769));
  const exif = exifOffset === null ? new Map() : ifd(exifOffset);
  const rawDate = text(exif.get(0x9003)) || text(exif.get(0x9004)) || text(main.get(0x0132));
  let date = null;
  if (rawDate && /^\d{4}:\d{2}:\d{2}/.test(rawDate)) {
    const candidate = rawDate.slice(0, 10).replaceAll(':', '-');
    const parsed = new Date(`${candidate}T12:00:00Z`);
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === candidate) date = candidate;
  }

  let gps = null;
  const gpsOffset = pointer(main.get(0x8825));
  if (gpsOffset !== null) {
    const fields = ifd(gpsOffset);
    const latitude = coordinate(fields.get(0x0002), text(fields.get(0x0001)));
    const longitude = coordinate(fields.get(0x0004), text(fields.get(0x0003)));
    if (latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) gps = { latitude, longitude };
  }
  return { date, gps };
}

export function readExif(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    const range = tiffRange(bytes);
    return range ? parseTiff(bytes, range[0], range[1]) : { date: null, gps: null };
  } catch {
    return { date: null, gps: null };
  }
}
