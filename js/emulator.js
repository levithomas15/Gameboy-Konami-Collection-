/**
 * A friendly wrapper around the binjgb core.
 *
 * This module deliberately knows nothing about the DOM. It is handed a
 * renderer and an audio sink, so it can be driven headless and the console
 * chrome can be redesigned without touching emulation.
 */

import { BadRomError } from './rom.js';
import { AUDIO_FRAMES } from './audio.js';

const CPU_TICKS_PER_SECOND = 4194304;

/** Bit flags returned by _emulator_run_until_f64. */
const EVENT_NEW_FRAME = 1;
const EVENT_AUDIO_BUFFER_FULL = 2;
const EVENT_UNTIL_TICKS = 4;

/**
 * Never emulate more than this much wall-clock time in a single animation
 * frame. Without the clamp, returning to a backgrounded tab asks the core to
 * catch up by minutes and the page locks solid.
 */
const MAX_UPDATE_SEC = 5 / 60;

/** 0 = raw, 1 = SameBoy-style, 2 = Gambatte-style. 2 looks closest to the real screen. */
const CGB_COLOR_CURVE = 2;

/** How often to ask the core whether the save RAM changed. Per frame is wasteful. */
const EXT_RAM_POLL_MS = 1000;

export class Emulator extends EventTarget {
  /**
   * @param {object} module the instantiated binjgb module
   * @param {Uint8Array} romBytes
   * @param {{renderer: object, audioSink: object, sampleRate: number}} deps
   */
  constructor(module, romBytes, { renderer, audioSink, sampleRate }) {
    super();
    this.module = module;
    this.renderer = renderer;
    this.audioSink = audioSink;

    // The core wants the ROM padded up to a whole number of 32 KiB banks.
    const size = (romBytes.byteLength + 0x7fff) & ~0x7fff;
    this.romPtr = module._malloc(size);
    this.#heap(this.romPtr, size).fill(0);
    this.#heap(this.romPtr, size).set(romBytes);

    this.handle = module._emulator_new_simple(
      this.romPtr, size, sampleRate, AUDIO_FRAMES, CGB_COLOR_CURVE);

    if (this.handle === 0) {
      module._free(this.romPtr);
      this.romPtr = 0;
      throw new BadRomError('core-rejected',
        'The emulator could not start this cartridge.');
    }

    this.rafId = 0;
    this.lastMs = 0;
    this.destroyed = false;
    this.tick = this.#tick.bind(this);

    this.extRamTimer = setInterval(() => {
      if (this.destroyed || this.handle === 0) return;
      if (this.module._emulator_was_ext_ram_updated(this.handle)) {
        this.dispatchEvent(new Event('extram-dirty'));
      }
    }, EXT_RAM_POLL_MS);
  }

  /**
   * A view onto wasm memory.
   *
   * This must be re-derived on every single access. Emscripten swaps the
   * underlying ArrayBuffer whenever wasm memory grows, which silently detaches
   * any view held from before — the symptom is a black screen with no error.
   */
  #heap(ptr, length) {
    return new Uint8Array(this.module.HEAPU8.buffer, ptr, length);
  }

  get isRunning() { return this.rafId !== 0; }

  // -- lifecycle ---------------------------------------------------------

  start() {
    if (this.destroyed || this.rafId !== 0) return;
    this.lastMs = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.audioSink?.reset();
  }

  pause() { this.stop(); }

  resume() {
    // lastMs is reset inside start(), which is what stops the paused interval
    // from being emulated all at once.
    this.start();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    clearInterval(this.extRamTimer);
    if (this.handle !== 0) {
      this.module._emulator_delete(this.handle);
      this.handle = 0;
    }
    if (this.romPtr !== 0) {
      this.module._free(this.romPtr);
      this.romPtr = 0;
    }
  }

  // -- the run loop ------------------------------------------------------

  #tick(nowMs) {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.tick);

    if (this.lastMs === 0) this.lastMs = nowMs;
    const delta = Math.min((nowMs - this.lastMs) / 1000, MAX_UPDATE_SEC);
    this.lastMs = nowMs;

    const module = this.module;
    const target = module._emulator_get_ticks_f64(this.handle)
                 + delta * CPU_TICKS_PER_SECOND;

    // run_until returns at the *first* event, not at the target. Looping until
    // EVENT_UNTIL_TICKS is what keeps video and audio from starving.
    for (;;) {
      const event = module._emulator_run_until_f64(this.handle, target);
      if (event & EVENT_NEW_FRAME) this.#present();
      if (event & EVENT_AUDIO_BUFFER_FULL) this.#pushAudio();
      if (event & EVENT_UNTIL_TICKS) break;
    }
  }

  #present() {
    const ptr = this.module._get_frame_buffer_ptr(this.handle);
    const size = this.module._get_frame_buffer_size(this.handle);
    this.renderer.upload(this.#heap(ptr, size));
    this.renderer.present();
  }

  #pushAudio() {
    if (!this.audioSink) return;
    const ptr = this.module._get_audio_buffer_ptr(this.handle);
    const capacity = this.module._get_audio_buffer_capacity(this.handle);
    this.audioSink.push(this.#heap(ptr, capacity));
  }

  // -- input -------------------------------------------------------------

  setButton(name, pressed) {
    if (this.destroyed || this.handle === 0) return;
    const fn = BUTTON_SETTERS[name];
    if (fn) this.module[fn](this.handle, pressed ? 1 : 0);
  }

  // -- save data ---------------------------------------------------------

  /** Runs `callback(pointer, bytes)` against a freshly allocated file-data blob. */
  #withFileData(makePointer, callback) {
    const pointer = makePointer();
    try {
      const dataPtr = this.module._get_file_data_ptr(pointer);
      const size = this.module._get_file_data_size(pointer);
      return callback(pointer, this.#heap(dataPtr, size));
    } finally {
      this.module._file_data_delete(pointer);
    }
  }

  /** @returns {Uint8Array|null} battery-backed save RAM, or null if the cart has none */
  readExtRam() {
    if (this.destroyed) return null;
    return this.#withFileData(
      () => this.module._ext_ram_file_data_new(this.handle),
      (pointer, bytes) => {
        if (bytes.length === 0) return null;
        this.module._emulator_write_ext_ram(this.handle, pointer);
        return new Uint8Array(bytes); // copy out before the blob is freed
      });
  }

  /** @param {Uint8Array} saved @returns {boolean} whether it was accepted */
  writeExtRam(saved) {
    if (this.destroyed || !saved?.length) return false;
    return this.#withFileData(
      () => this.module._ext_ram_file_data_new(this.handle),
      (pointer, bytes) => {
        if (bytes.length !== saved.length) return false; // different cartridge
        bytes.set(saved);
        this.module._emulator_read_ext_ram(this.handle, pointer);
        return true;
      });
  }

  /** @returns {Uint8Array} a complete snapshot of the machine */
  saveState() {
    return this.#withFileData(
      () => this.module._state_file_data_new(this.handle),
      (pointer, bytes) => {
        this.module._emulator_write_state(this.handle, pointer);
        return new Uint8Array(bytes);
      });
  }

  /** @param {Uint8Array} state @returns {boolean} */
  loadState(state) {
    if (this.destroyed || !state?.length) return false;
    return this.#withFileData(
      () => this.module._state_file_data_new(this.handle),
      (pointer, bytes) => {
        if (bytes.length !== state.length) return false;
        bytes.set(state);
        this.module._emulator_read_state(this.handle, pointer);
        return true;
      });
  }

  // -- display -----------------------------------------------------------

  /** Only affects original (non-colour) games. 0-83. */
  setPalette(index) {
    if (this.destroyed) return;
    this.module._emulator_set_builtin_palette(this.handle, index);
  }
}

const BUTTON_SETTERS = {
  up: '_set_joyp_up',
  down: '_set_joyp_down',
  left: '_set_joyp_left',
  right: '_set_joyp_right',
  a: '_set_joyp_A',
  b: '_set_joyp_B',
  start: '_set_joyp_start',
  select: '_set_joyp_select',
};

export const BUTTONS = Object.keys(BUTTON_SETTERS);
