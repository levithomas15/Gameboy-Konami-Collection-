/**
 * Audio output for the emulator, plus the synthesised mechanical sounds the
 * console makes (cartridge click, power clunk, eject pop). Nothing here loads
 * a file — every sound is generated from oscillators and noise, so the whole
 * site stays under a couple of hundred kilobytes.
 */

/** Emulator frames per pushed buffer. Must match what the core was built with. */
export const AUDIO_FRAMES = 4096;

/** How far ahead of the clock we schedule. Lower is tighter but risks gaps. */
const LATENCY_SEC = 0.1;

/**
 * A single AudioContext shared by the emulator and the sound effects.
 * Browsers start it suspended; it must be resumed from inside a user gesture.
 */
export class AudioEngine {
  constructor() {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    this.emulatorGain = this.ctx.createGain();
    this.emulatorGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.85;
    this.sfxGain.connect(this.master);

    this.noiseBuffer = this.#makeNoise(1.0);
  }

  get sampleRate() { return this.ctx.sampleRate; }
  get isRunning() { return this.ctx.state === 'running'; }

  /** Must be called from a user gesture (pointerdown, keydown, ...). */
  async unlock() {
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* browser said no; retry later */ }
    }
    return this.isRunning;
  }

  suspend() {
    if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  setVolume(value) {
    const v = Math.min(1, Math.max(0, value));
    // Perceived loudness is closer to the square of the slider position.
    this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.01);
  }

  #makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // -- mechanical sound effects ------------------------------------------

  #noiseBurst({ when, duration, frequency, q = 1.2, gain = 1, type = 'bandpass' }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    src.connect(filter).connect(env).connect(this.sfxGain);
    src.start(when);
    src.stop(when + duration + 0.02);
    return filter;
  }

  #tone({ when, duration, frequency, type = 'triangle', gain = 0.5 }) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(env).connect(this.sfxGain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  /** The cartridge seating: sharp plastic-on-plastic snap with a low body. */
  click() {
    const t = this.ctx.currentTime;
    this.#noiseBurst({ when: t, duration: 0.028, frequency: 2200, q: 1.2, gain: 0.9 });
    this.#noiseBurst({ when: t, duration: 0.008, frequency: 6000, q: 0.8, gain: 0.5 });
    this.#tone({ when: t, duration: 0.07, frequency: 160, gain: 0.45 });
  }

  /** Cartridge sliding against the shell during the descent. */
  scrape() {
    const t = this.ctx.currentTime;
    const filter = this.#noiseBurst({
      when: t, duration: 0.09, frequency: 800, q: 0.7, gain: 0.22, type: 'lowpass',
    });
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.09);
  }

  /** The power switch. Softer and lower than the cartridge click. */
  powerClunk() {
    const t = this.ctx.currentTime;
    this.#noiseBurst({ when: t, duration: 0.02, frequency: 1400, q: 1, gain: 0.5 });
    this.#tone({ when: t, duration: 0.09, frequency: 120, gain: 0.4 });
  }

  /** Cartridge springing back out of the slot. */
  pop() {
    const t = this.ctx.currentTime;
    this.#noiseBurst({ when: t, duration: 0.02, frequency: 3000, q: 1, gain: 0.5 });
    this.#tone({ when: t, duration: 0.06, frequency: 220, gain: 0.4 });
  }
}

/**
 * Schedules emulator audio buffers back to back. binjgb hands us interleaved
 * stereo bytes; we convert to float and queue them just ahead of the clock.
 */
export class AudioSink {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.startSec = 0;
  }

  /** @param {Uint8Array} bytes interleaved stereo, 2 bytes per frame */
  push(bytes) {
    if (!this.engine.isRunning) return;

    const ctx = this.ctx;
    const buffer = ctx.createBuffer(2, AUDIO_FRAMES, ctx.sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    for (let i = 0; i < AUDIO_FRAMES; i++) {
      // Bytes are unsigned and centred on 128.
      left[i] = (bytes[2 * i] - 128) / 128;
      right[i] = (bytes[2 * i + 1] - 128) / 128;
    }

    const now = ctx.currentTime;
    // If we ever fall behind the clock, resync instead of scheduling into the
    // past — otherwise a single hitch desynchronises playback permanently.
    if (this.startSec < now) this.startSec = now + LATENCY_SEC;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.engine.emulatorGain);
    source.start(this.startSec);
    this.startSec += buffer.duration;
  }

  /** Called when the emulator stops, so the next start does not schedule stale. */
  reset() {
    this.startSec = 0;
  }
}
