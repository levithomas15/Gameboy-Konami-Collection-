/**
 * Game Boy cartridge header parsing and validation.
 *
 * Everything here is a pure function over the ROM bytes — no DOM, no storage.
 *
 * Header layout (all offsets into the ROM image):
 *   0x0134-0x0143  title (0x013F-0x0142 double as a manufacturer code on later
 *                  carts, and 0x0143 doubles as the CGB flag)
 *   0x0143         CGB flag: 0x80 = colour-enhanced, 0xC0 = colour-only
 *   0x0147         cartridge type (which memory bank controller, and whether
 *                  there is battery-backed RAM)
 *   0x0148         ROM size
 *   0x0149         RAM size
 *   0x014D         header checksum
 *   0x014E-0x014F  global checksum, big endian
 */

export class BadRomError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BadRomError';
    this.code = code;
  }
}

const MIN_SIZE = 0x8000;          // 32 KiB, the smallest possible cartridge
const MAX_SIZE = 8 * 1024 * 1024; // generous; real GB carts top out at 8 MiB

/** Cartridge type byte -> controller name and whether it has a save battery. */
const CART_TYPES = new Map([
  [0x00, ['ROM only', false]],
  [0x01, ['MBC1', false]],
  [0x02, ['MBC1+RAM', false]],
  [0x03, ['MBC1+RAM+Battery', true]],
  [0x05, ['MBC2', false]],
  [0x06, ['MBC2+Battery', true]],
  [0x08, ['ROM+RAM', false]],
  [0x09, ['ROM+RAM+Battery', true]],
  [0x0B, ['MMM01', false]],
  [0x0C, ['MMM01+RAM', false]],
  [0x0D, ['MMM01+RAM+Battery', true]],
  [0x0F, ['MBC3+Timer+Battery', true]],
  [0x10, ['MBC3+Timer+RAM+Battery', true]],
  [0x11, ['MBC3', false]],
  [0x12, ['MBC3+RAM', false]],
  [0x13, ['MBC3+RAM+Battery', true]],
  [0x19, ['MBC5', false]],
  [0x1A, ['MBC5+RAM', false]],
  [0x1B, ['MBC5+RAM+Battery', true]],
  [0x1C, ['MBC5+Rumble', false]],
  [0x1D, ['MBC5+Rumble+RAM', false]],
  [0x1E, ['MBC5+Rumble+RAM+Battery', true]],
  [0x20, ['MBC6', false]],
  [0x22, ['MBC7+Sensor+Rumble+RAM+Battery', true]],
  [0xFC, ['Pocket Camera', true]],
  [0xFD, ['Bandai TAMA5', true]],
  [0xFE, ['HuC3', true]],
  [0xFF, ['HuC1+RAM+Battery', true]],
]);

/** Controllers the vendored core does not implement. */
const UNSUPPORTED = new Set([0x20, 0x22, 0xFC, 0xFD, 0xFE]);

/**
 * The header checksum covers 0x0134-0x014C. Verifying it is how the real
 * hardware's boot ROM decides a cartridge is readable, and it is a far better
 * validity test than sniffing the file extension.
 */
export function headerChecksum(bytes) {
  let sum = 0;
  for (let i = 0x134; i <= 0x14c; i++) sum = (sum - bytes[i] - 1) & 0xff;
  return sum;
}

function readTitle(bytes) {
  // On colour cartridges the title field was shortened to make room for the
  // CGB flag and manufacturer code.
  const isCgb = bytes[0x143] === 0x80 || bytes[0x143] === 0xc0;
  const end = isCgb ? 0x143 : 0x144;
  let title = '';
  for (let i = 0x134; i < end; i++) {
    const c = bytes[i];
    if (c === 0) break;
    // Keep printable ASCII only; padding bytes vary between dumps.
    if (c >= 0x20 && c < 0x7f) title += String.fromCharCode(c);
  }
  return title.trim();
}

/**
 * @param {Uint8Array} bytes the whole ROM image
 * @param {string} [filename] only used for reporting
 * @returns {object} parsed header
 * @throws {BadRomError}
 */
export function parseRom(bytes, filename = '') {
  if (bytes.length < MIN_SIZE) {
    throw new BadRomError('too-small',
      'That file is too small to be a Game Boy cartridge.');
  }
  if (bytes.length > MAX_SIZE) {
    throw new BadRomError('too-large',
      'That file is far larger than any Game Boy cartridge.');
  }
  if (headerChecksum(bytes) !== bytes[0x14d]) {
    throw new BadRomError('bad-header',
      'This file does not contain a valid Game Boy cartridge header.');
  }

  const typeByte = bytes[0x147];
  const [mbc, hasBattery] = CART_TYPES.get(typeByte) ?? [`Unknown (0x${typeByte.toString(16)})`, false];
  const cgbFlag = bytes[0x143];

  return {
    title: readTitle(bytes),
    filename,
    size: bytes.length,
    cgbFlag,
    isColour: cgbFlag === 0x80 || cgbFlag === 0xc0,
    colourOnly: cgbFlag === 0xc0,
    typeByte,
    mbc,
    hasBattery,
    supported: !UNSUPPORTED.has(typeByte),
    globalChecksum: (bytes[0x14e] << 8) | bytes[0x14f],
  };
}

/**
 * A stable identity for a ROM, used as the storage key.
 *
 * Title, byte length and the cartridge's own global checksum together are
 * ample to tell two games apart, and unlike hashing they cost nothing — no
 * need to run megabytes through SHA on the main thread.
 */
export function romId(header) {
  const title = header.title || 'untitled';
  const checksum = header.globalChecksum.toString(16).padStart(4, '0');
  return `${title}:${header.size}:${checksum}`;
}
