/* react-native-ble-plx carries characteristic values as base64 strings. These
 * convert to/from bytes without pulling in Buffer or a polyfill — the packet path
 * is hot (up to ~15 notifications/s) so this stays allocation-light. */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < CHARS.length; i++) t[CHARS.charCodeAt(i)] = i;
  return t;
})();

export function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  if (len === 0) return new Uint8Array(0);
  let pad = 0;
  if (b64[len - 1] === '=') pad++;
  if (b64[len - 2] === '=') pad++;
  const outLen = (len * 3) / 4 - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = LOOKUP[b64.charCodeAt(i)]!;
    const b = LOOKUP[b64.charCodeAt(i + 1)]!;
    const c = LOOKUP[b64.charCodeAt(i + 2)]!;
    const d = LOOKUP[b64.charCodeAt(i + 3)]!;
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < outLen) out[o++] = (chunk >> 16) & 0xff;
    if (o < outLen) out[o++] = (chunk >> 8) & 0xff;
    if (o < outLen) out[o++] = chunk & 0xff;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < len ? bytes[i + 1]! : 0;
    const c = i + 2 < len ? bytes[i + 2]! : 0;
    const chunk = (a << 16) | (b << 8) | c;
    out += CHARS[(chunk >> 18) & 63];
    out += CHARS[(chunk >> 12) & 63];
    out += i + 1 < len ? CHARS[(chunk >> 6) & 63] : '=';
    out += i + 2 < len ? CHARS[chunk & 63] : '=';
  }
  return out;
}
