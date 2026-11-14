const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i += 1) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

function decodeBase64ToBytes(rawBase64: string): Uint8Array | null {
  const cleaned = rawBase64.replace(/\s+/g, '');
  if (!cleaned) return null;

  let pad = 0;
  if (cleaned.endsWith('==')) pad = 2;
  else if (cleaned.endsWith('=')) pad = 1;

  const outLen = Math.floor((cleaned.length * 3) / 4) - pad;
  if (outLen <= 0) return null;

  const out = new Uint8Array(outLen);
  let outIdx = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < cleaned.length; i += 1) {
    const code = cleaned.charCodeAt(i);
    if (code === 61 /* '=' */) break;
    const val = code < 128 ? B64_LOOKUP[code] : -1;
    if (val < 0) return null;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (outIdx < outLen) {
        out[outIdx] = (buffer >> bits) & 0xff;
        outIdx += 1;
      }
    }
  }

  return outIdx === outLen ? out : out.subarray(0, outIdx);
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkLimit = 12288; // multiple of 3 to avoid mid-chunk padding
  for (let offset = 0; offset < bytes.length; offset += chunkLimit) {
    const end = Math.min(bytes.length, offset + chunkLimit);
    let part = '';
    for (let i = offset; i < end; i += 3) {
      const b0 = bytes[i] ?? 0;
      const hasB1 = i + 1 < end;
      const hasB2 = i + 2 < end;
      const b1 = hasB1 ? (bytes[i + 1] ?? 0) : 0;
      const b2 = hasB2 ? (bytes[i + 2] ?? 0) : 0;
      const triplet = (b0 << 16) | (b1 << 8) | b2;

      part += B64_ALPHABET[(triplet >> 18) & 0x3f];
      part += B64_ALPHABET[(triplet >> 12) & 0x3f];
      part += hasB1 ? B64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
      part += hasB2 ? B64_ALPHABET[triplet & 0x3f] : '=';
    }
    chunks.push(part);
  }
  return chunks.join('');
}

function concatByteSlices(slices: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const s of slices) total += s.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const s of slices) {
    merged.set(s, offset);
    offset += s.length;
  }
  return merged;
}

function stripJpegSegments(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const kept: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  let pos = 2;
  let strippedAny = false;

  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) {
      return null;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) {
      pos += 1;
    }
    if (pos >= bytes.length) break;

    const marker = bytes[pos] ?? 0;
    pos += 1;

    // EOI
    if (marker === 0xd9) {
      kept.push(new Uint8Array([0xff, 0xd9]));
      break;
    }

    // SOS: copy header + compressed scan stream through EOI verbatim
    if (marker === 0xda) {
      if (pos + 2 > bytes.length) return null;
      kept.push(new Uint8Array([0xff, 0xda]));
      kept.push(bytes.subarray(pos));
      break;
    }

    // Standalone markers without payload length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      kept.push(new Uint8Array([0xff, marker]));
      continue;
    }

    if (pos + 2 > bytes.length) {
      return null;
    }
    const segLen = ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
    if (segLen < 2 || pos + segLen > bytes.length) {
      return null;
    }

    // Strip EXIF/GPS/XMP (APP1 0xE1), PictureInfo (APP12 0xEC), IPTC (APP13 0xED), APP15 (0xEF), and Comments (COM 0xFE)
    const isPrivateMetadata =
      marker === 0xe1 ||
      marker === 0xec ||
      marker === 0xed ||
      marker === 0xef ||
      marker === 0xfe;

    if (isPrivateMetadata) {
      strippedAny = true;
    } else {
      kept.push(new Uint8Array([0xff, marker]));
      kept.push(bytes.subarray(pos, pos + segLen));
    }

    pos += segLen;
  }

  return strippedAny ? concatByteSlices(kept) : bytes;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_PRIVATE_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPngMetadataChunks(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIG.length; i += 1) {
    if (bytes[i] !== PNG_SIG[i]) return null;
  }

  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let pos = 8;
  let strippedAny = false;

  while (pos + 12 <= bytes.length) {
    const dataLen =
      (((bytes[pos] ?? 0) << 24) >>> 0) +
      (((bytes[pos + 1] ?? 0) << 16) |
        ((bytes[pos + 2] ?? 0) << 8) |
        (bytes[pos + 3] ?? 0));
    const totalChunkLen = 12 + dataLen;
    if (dataLen < 0 || pos + totalChunkLen > bytes.length) {
      return null;
    }

    const type = String.fromCharCode(
      bytes[pos + 4] ?? 0,
      bytes[pos + 5] ?? 0,
      bytes[pos + 6] ?? 0,
      bytes[pos + 7] ?? 0
    );

    if (PNG_PRIVATE_CHUNKS.has(type)) {
      strippedAny = true;
    } else {
      kept.push(bytes.subarray(pos, pos + totalChunkLen));
    }

    pos += totalChunkLen;
    if (type === 'IEND') break;
  }

  return strippedAny ? concatByteSlices(kept) : bytes;
}

/**
 * Losslessly strips private image metadata (EXIF GPS coordinates, camera serials,
 * XMP, IPTC, comments, PNG text/EXIF chunks) from a base64-encoded image before
 * storing or transmitting to external AI providers.
 */
export function stripImageMetadataBase64(rawBase64: string): string {
  if (!rawBase64) return '';
  const commaIdx = rawBase64.startsWith('data:') ? rawBase64.indexOf(',') : -1;
  const payload = commaIdx >= 0 ? rawBase64.slice(commaIdx + 1) : rawBase64;
  const trimmed = payload.trim();
  if (!trimmed) return '';

  try {
    const bytes = decodeBase64ToBytes(trimmed);
    if (!bytes || bytes.length < 4) return trimmed;

    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const cleaned = stripJpegSegments(bytes);
      if (cleaned && cleaned !== bytes) {
        return encodeBytesToBase64(cleaned);
      }
      return trimmed;
    }

    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const cleaned = stripPngMetadataChunks(bytes);
      if (cleaned && cleaned !== bytes) {
        return encodeBytesToBase64(cleaned);
      }
      return trimmed;
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}
