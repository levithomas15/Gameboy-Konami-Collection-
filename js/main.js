/**
 * Application wiring.
 *
 * Owns the state machine and the lifetime of the Emulator instance. Every
 * other module is a leaf: they either compute something pure, draw something,
 * or raise an event for this file to act on.
 */

import { loadCore } from './core-loader.js';
import { createRenderer } from './renderer.js';
import { AudioEngine, AudioSink } from './audio.js';
import { parseRom, romId, BadRomError } from './rom.js';
import { Emulator } from './emulator.js';
import { Input } from './input.js';
import { SLOTS, findSlot, renderCartridge } from './cartridges.js';
import { playInsert, playEject } from './insert.js';
import * as store from './storage.js';

const DESIGN_W = 360;
const DESIGN_H = 616;

const $ = (id) => document.getElementById(id);

const el = {
  body: document.body,
  stage: $('stage'),
  console: $('console'),
  slot: $('slot'),
  screen: $('screen'),
  screenOff: $('screenOff'),
  shelf: $('shelf'),
  flight: $('flight'),
  dpad: $('dpad'),
  picker: $('filePicker'),
  toasts: $('toasts'),
  fatal: $('fatal'),
  fatalText: $('fatalText'),
  fatalRetry: $('fatalRetry'),
  volume: $('volume'),
};

const app = {
  state: 'boot',
  module: null,
  emulator: null,
  renderer: null,
  audio: null,
  sink: null,
  input: null,
  /** slotId -> {header, romId} for cartridges that have a file bound */
  bound: new Map(),
  activeSlotId: null,
  pendingSlotId: null,
  paletteIndex: 79,
  saveTimer: 0,
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

function setState(next) {
  app.state = next;
  el.body.dataset.state = next;
  const playing = next === 'running';
  app.input?.setEnabled(playing || next === 'paused');
  el.console.classList.toggle('is-on', playing || next === 'paused');
  el.console.style.setProperty('--backlight', playing || next === 'paused' ? '1' : '0');
  refreshToolbar();
}

function refreshToolbar() {
  const live = app.state === 'running' || app.state === 'paused';
  for (const [id, enabled] of [
    ['btnEject', live], ['btnPause', live], ['btnReset', live],
    ['btnSave', live], ['btnLoad', live],
  ]) $(id).disabled = !enabled;
  $('btnPause').textContent = app.state === 'paused' ? 'Weiter' : 'Pause';
}

// ---------------------------------------------------------------------------
// toasts
// ---------------------------------------------------------------------------

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast${kind ? ` toast--${kind}` : ''}`;
  node.textContent = message;
  el.toasts.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 200ms';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, 3200);
}

// ---------------------------------------------------------------------------
// shelf
// ---------------------------------------------------------------------------

function buildShelf() {
  el.shelf.replaceChildren();

  SLOTS.forEach((slot, index) => {
    const bound = app.bound.get(slot.id) ?? null;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slotbtn';
    button.dataset.slot = slot.id;
    button.style.setProperty('--float-delay', `${(index % 4) * 0.55}s`);
    button.append(renderCartridge(slot, bound?.header ?? null));

    const caption = document.createElement('span');
    caption.className = 'slotbtn__caption';
    caption.textContent = bound
      ? (bound.header.title || bound.header.filename || 'Cartridge')
      : (slot.generic ? 'Datei wählen' : `${slot.volume} — leer`);
    button.append(caption);

    button.setAttribute('aria-label', bound
      ? `${slot.volume} einstecken`
      : `${slot.volume}: Datei auswählen`);

    button.addEventListener('pointerdown', () => { app.audio?.unlock(); });
    button.addEventListener('click', () => onSlotClick(slot.id));

    // Dropping a file straight onto a cartridge binds it to that cartridge.
    button.addEventListener('dragover', (event) => {
      event.preventDefault();
      button.classList.add('is-dropping');
    });
    button.addEventListener('dragleave', () => button.classList.remove('is-dropping'));
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      button.classList.remove('is-dropping');
      const file = event.dataTransfer?.files?.[0];
      if (file) acceptFile(file, slot.id);
    });

    el.shelf.append(button);
  });
}

function onSlotClick(slotId) {
  if (app.state === 'inserting' || app.state === 'ejecting') return;

  if (!app.bound.has(slotId)) {
    app.pendingSlotId = slotId;
    el.picker.click();
    return;
  }
  if (app.state === 'running' || app.state === 'paused') {
    if (slotId === app.activeSlotId) return;
    eject().then(() => insert(slotId));
    return;
  }
  insert(slotId);
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

async function acceptFile(file, slotId) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = parseRom(bytes, file.name);

    if (!header.supported) {
      toast(`${header.mbc} wird von diesem Emulator nicht unterstützt.`, 'error');
      return;
    }

    const id = romId(header);
    await store.putRom(id, { header, bytes: bytes.buffer.slice(0), addedAt: Date.now() });
    await store.bindSlot(slotId, id);
    await store.requestPersistence();

    app.bound.set(slotId, { header, romId: id });
    buildShelf();
    toast(`„${header.title || file.name}" eingelegt.`);

    // Picking a file is a clear instruction to play it.
    if (app.state === 'idle') insert(slotId);
  } catch (error) {
    if (error instanceof BadRomError) toast(error.message, 'error');
    else {
      console.error(error);
      toast('Die Datei konnte nicht gelesen werden.', 'error');
    }
  }
}

el.picker.addEventListener('change', () => {
  const file = el.picker.files?.[0];
  const slotId = app.pendingSlotId;
  el.picker.value = '';
  app.pendingSlotId = null;
  if (file && slotId) acceptFile(file, slotId);
});

// Dropping anywhere else goes to the first free cartridge.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  if (event.target.closest?.('.slotbtn')) return;
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const free = SLOTS.find((slot) => !app.bound.has(slot.id)) ?? SLOTS.at(-1);
  acceptFile(file, free.id);
});

// ---------------------------------------------------------------------------
// insert / eject
// ---------------------------------------------------------------------------

async function insert(slotId) {
  const bound = app.bound.get(slotId);
  if (!bound || app.state === 'inserting') return;

  const button = el.shelf.querySelector(`[data-slot="${slotId}"]`);
  const sourceCart = button?.querySelector('.cart');
  if (!sourceCart) return;

  setState('inserting');
  button.classList.add('is-flying');
  await app.audio?.unlock();

  try {
    await playInsert({
      sourceCart, slot: el.slot, flight: el.flight,
      consoleEl: el.console, sfx: app.audio,
    });

    // The cartridge now lives in the console, so its shelf place is ghosted
    // rather than left as a hole in the grid.
    button.classList.remove('is-flying');
    button.classList.add('is-inserted');

    app.activeSlotId = slotId;
    app.audio?.powerClunk();
    await boot(bound);
  } catch (error) {
    console.error(error);
    toast('Die Cartridge konnte nicht gestartet werden.', 'error');
    button.classList.remove('is-flying');
    el.slot.classList.remove('is-loaded');
    setState('idle');
  }
}

async function boot(bound) {
  const record = await store.getRom(bound.romId);
  if (!record) throw new Error('rom missing from storage');

  destroyEmulator();

  const bytes = new Uint8Array(record.bytes);
  app.emulator = new Emulator(app.module, bytes, {
    renderer: app.renderer,
    audioSink: app.sink,
    sampleRate: app.audio.sampleRate,
  });

  const save = await store.getSave(bound.romId);
  if (save) app.emulator.writeExtRam(save);

  app.emulator.setPalette(app.paletteIndex);
  app.emulator.addEventListener('extram-dirty', scheduleSave);
  app.emulator.start();

  setState('running');
  toast(`${bound.header.title || 'Cartridge'} läuft.`);
}

async function eject() {
  if (!app.activeSlotId || app.state === 'ejecting') return;
  const slotId = app.activeSlotId;
  setState('ejecting');

  await flushSave();
  destroyEmulator();

  const button = el.shelf.querySelector(`[data-slot="${slotId}"]`);
  const sourceCart = button?.querySelector('.cart');

  if (sourceCart) {
    // Hide the ghost while its double flies home, or both are on screen.
    button.classList.remove('is-inserted');
    button.classList.add('is-flying');
    await playEject({
      sourceCart, slot: el.slot, flight: el.flight,
      consoleEl: el.console, sfx: app.audio,
    });
  }

  button?.classList.remove('is-flying', 'is-inserted');
  el.slot.classList.remove('is-loaded');
  app.activeSlotId = null;
  setState('idle');
}

function destroyEmulator() {
  if (!app.emulator) return;
  app.emulator.removeEventListener('extram-dirty', scheduleSave);
  app.emulator.destroy();
  app.emulator = null;
}

// ---------------------------------------------------------------------------
// saving
// ---------------------------------------------------------------------------

function scheduleSave() {
  clearTimeout(app.saveTimer);
  // Debounced: games rewrite save RAM in bursts, and there is no reason to
  // hit IndexedDB for each one.
  app.saveTimer = setTimeout(flushSave, 2000);
}

async function flushSave() {
  clearTimeout(app.saveTimer);
  if (!app.emulator || !app.activeSlotId) return;
  const bound = app.bound.get(app.activeSlotId);
  if (!bound) return;
  const bytes = app.emulator.readExtRam();
  if (bytes?.length) {
    try { await store.putSave(bound.romId, bytes); }
    catch (error) { console.warn('could not write save', error); }
  }
}

// ---------------------------------------------------------------------------
// toolbar
// ---------------------------------------------------------------------------

$('btnEject').addEventListener('click', () => eject());

$('btnPause').addEventListener('click', () => {
  if (app.state === 'running') {
    app.emulator?.pause();
    app.audio?.suspend();
    setState('paused');
  } else if (app.state === 'paused') {
    app.audio?.unlock();
    app.emulator?.resume();
    setState('running');
  }
});

$('btnReset').addEventListener('click', async () => {
  const slotId = app.activeSlotId;
  const bound = slotId && app.bound.get(slotId);
  if (!bound) return;
  await flushSave();
  await boot(bound);
  toast('Neu gestartet.');
});

$('btnSave').addEventListener('click', () => saveState());
$('btnLoad').addEventListener('click', () => loadState());

$('btnFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else el.stage.requestFullscreen?.().catch(() => {});
});

el.volume.addEventListener('input', () => {
  const value = Number(el.volume.value) / 100;
  app.audio?.setVolume(value);
  store.putPref('volume', value).catch(() => {});
});

async function saveState() {
  const bound = app.activeSlotId && app.bound.get(app.activeSlotId);
  if (!app.emulator || !bound) return;
  try {
    await store.putState(bound.romId, 0, app.emulator.saveState());
    toast('Spielstand gesichert.');
  } catch (error) {
    console.error(error);
    toast('Spielstand konnte nicht gesichert werden.', 'error');
  }
}

async function loadState() {
  const bound = app.activeSlotId && app.bound.get(app.activeSlotId);
  if (!app.emulator || !bound) return;
  const bytes = await store.getState(bound.romId, 0);
  if (!bytes) { toast('Kein Spielstand vorhanden.', 'error'); return; }
  toast(app.emulator.loadState(bytes) ? 'Spielstand geladen.'
                                      : 'Spielstand passt nicht zu dieser Cartridge.');
}

// ---------------------------------------------------------------------------
// scaling
// ---------------------------------------------------------------------------

function fitConsole() {
  const box = el.stage.getBoundingClientRect();
  if (!box.width || !box.height) return;

  // The stage reserves --headroom above the console for the cartridge to arc
  // through, and getBoundingClientRect includes that padding — so it has to
  // come off before working out how much room the console actually has.
  const headroom = parseFloat(
    getComputedStyle(el.stage).getPropertyValue('padding-top')) || 0;

  const fit = Math.min(
    box.width / DESIGN_W,
    (box.height - headroom) / DESIGN_H,
    1.6);
  el.console.style.setProperty('--fit', Math.max(0.35, fit).toFixed(4));
}

new ResizeObserver(fitConsole).observe(el.stage);
window.addEventListener('orientationchange', () => setTimeout(fitConsole, 120));

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushSave();
    if (app.state === 'running') { app.emulator?.pause(); app.audio?.suspend(); }
  } else if (app.state === 'running') {
    app.audio?.unlock();
    app.emulator?.resume();
  }
});

// pagehide is the one that actually fires reliably on iOS.
window.addEventListener('pagehide', () => { flushSave(); });

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

async function start() {
  el.fatal.hidden = true;
  setState('boot');

  app.audio = new AudioEngine();
  app.sink = new AudioSink(app.audio);
  app.renderer = createRenderer(el.screen);

  app.input = new Input({ dpad: el.dpad, root: el.console });
  app.input.addEventListener('button', (event) => {
    const { button, pressed } = event.detail;
    app.emulator?.setButton(button, pressed);
  });
  app.input.addEventListener('shortcut', (event) => {
    switch (event.detail) {
      case 'save': saveState(); break;
      case 'load': loadState(); break;
      case 'pause': $('btnPause').click(); break;
      case 'palette-prev': shiftPalette(-1); break;
      case 'palette-next': shiftPalette(+1); break;
    }
  });

  const storedVolume = await store.getPref('volume');
  if (typeof storedVolume === 'number') {
    el.volume.value = String(Math.round(storedVolume * 100));
  }
  app.audio.setVolume(Number(el.volume.value) / 100);

  // Restore which cartridges already have a file bound to them.
  try {
    const bindings = await store.allSlotBindings();
    for (const [slotId, id] of bindings) {
      const record = await store.getRom(id);
      if (record) app.bound.set(slotId, { header: record.header, romId: id });
    }
  } catch (error) {
    console.warn('could not read stored cartridges', error);
  }

  buildShelf();
  fitConsole();

  try {
    app.module = await loadCore();
  } catch (error) {
    console.error(error);
    el.fatalText.textContent =
      `${error.message}. Wird die Seite über file:// geöffnet? Dann braucht ` +
      'sie einen lokalen Server, etwa: python3 -m http.server 8000';
    el.fatal.hidden = false;
    return;
  }

  setState('idle');
  gamepadLoop();
}

function shiftPalette(direction) {
  app.paletteIndex = (app.paletteIndex + direction + 84) % 84;
  app.emulator?.setPalette(app.paletteIndex);
  toast(`Palette ${app.paletteIndex}`);
}

function gamepadLoop() {
  app.input?.pollGamepad();
  requestAnimationFrame(gamepadLoop);
}

el.fatalRetry.addEventListener('click', () => start());

start();
