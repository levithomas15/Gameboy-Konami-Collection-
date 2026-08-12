/**
 * Everything that can press a button: the on-screen controls, the keyboard
 * and a physical gamepad.
 *
 * The on-screen controls use Pointer Events rather than touch events, so a
 * mouse, a finger and a stylus all behave identically, and pointer capture
 * means dragging off a button releases it properly instead of leaving it
 * stuck down.
 */

const DIRECTIONS = ['up', 'down', 'left', 'right'];

/**
 * Default keyboard map.
 *
 * B and A sit on A and S rather than the more common Z and X: on a German
 * keyboard Z and Y are swapped, so `KeyZ` is physically where Y is printed
 * and the hint text would be wrong. A/S is in the same place on every layout.
 */
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyA: 'b', KeyS: 'a',
  KeyZ: 'b', KeyX: 'a',            // the QWERTY habit, kept as an alias
  Enter: 'start', ShiftRight: 'select', Tab: 'select',
};

export class Input extends EventTarget {
  /**
   * @param {{dpad: HTMLElement, root: HTMLElement}} elements
   */
  constructor({ dpad, root }) {
    super();
    this.dpad = dpad;
    this.root = root;

    /**
     * Whether presses should reach a game.
     *
     * Note this does NOT gate the controls themselves: they always depress
     * and always raise an event, even with no cartridge in the machine. A
     * console whose buttons do nothing at all reads as broken, so the
     * feedback is unconditional and only the forwarding is conditional.
     */
    this.enabled = false;

    /** button name -> how many sources are holding it down */
    this.held = new Map();
    /** pointerId -> Set of buttons that pointer is holding */
    this.pointers = new Map();

    this.gamepadPrevious = new Set();

    this.#bindPointer();
    this.#bindKeyboard();
  }

  setEnabled(value) {
    this.enabled = value;
    if (!value) this.releaseAll();
  }

  // -- button bookkeeping ------------------------------------------------

  #press(button, on) {
    const before = this.held.get(button) ?? 0;
    const after = Math.max(0, before + (on ? 1 : -1));
    this.held.set(button, after);

    if ((before > 0) !== (after > 0)) {
      this.#paint(button, after > 0);
      this.dispatchEvent(new CustomEvent('button', {
        detail: { button, pressed: after > 0 },
      }));
    }
  }

  #paint(button, pressed) {
    if (DIRECTIONS.includes(button)) {
      this.dpad.dataset[button] = pressed ? '1' : '0';
      return;
    }
    const el = this.root.querySelector(`[data-button="${button}"]`);
    el?.classList.toggle('is-pressed', pressed);
  }

  releaseAll() {
    for (const [button, count] of this.held) {
      if (count > 0) {
        this.held.set(button, 0);
        this.#paint(button, false);
        this.dispatchEvent(new CustomEvent('button', {
          detail: { button, pressed: false },
        }));
      }
    }
    this.pointers.clear();
    this.gamepadPrevious.clear();
  }

  /** Replaces everything a single pointer is holding with a new set. */
  #setPointer(pointerId, buttons) {
    const previous = this.pointers.get(pointerId) ?? new Set();
    for (const button of previous) if (!buttons.has(button)) this.#press(button, false);
    for (const button of buttons) if (!previous.has(button)) this.#press(button, true);
    if (buttons.size === 0) this.pointers.delete(pointerId);
    else this.pointers.set(pointerId, buttons);
  }

  // -- pointer -----------------------------------------------------------

  #bindPointer() {
    // Face buttons and pills: one button each.
    for (const el of this.root.querySelectorAll('[data-button]')) {
      const button = el.dataset.button;

      el.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        el.setPointerCapture(event.pointerId);
        this.#setPointer(event.pointerId, new Set([button]));
      });

      const release = (event) => {
        if (this.pointers.has(event.pointerId)) this.#setPointer(event.pointerId, new Set());
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    }

    // The d-pad is one control, hit-tested into a 3x3 grid so that corners
    // give diagonals and a thumb can roll between directions without lifting.
    const track = (event) => {
      event.preventDefault();
      this.#setPointer(event.pointerId, this.#dpadHit(event));
    };

    this.dpad.addEventListener('pointerdown', (event) => {
      this.dpad.setPointerCapture(event.pointerId);
      track(event);
    });
    this.dpad.addEventListener('pointermove', (event) => {
      if (this.pointers.has(event.pointerId)) track(event);
    });

    const releaseDpad = (event) => {
      if (this.pointers.has(event.pointerId)) this.#setPointer(event.pointerId, new Set());
    };
    this.dpad.addEventListener('pointerup', releaseDpad);
    this.dpad.addEventListener('pointercancel', releaseDpad);
    this.dpad.addEventListener('lostpointercapture', releaseDpad);
  }

  #dpadHit(event) {
    const rect = this.dpad.getBoundingClientRect();
    // -1, 0 or +1 on each axis, with a generous dead zone in the middle.
    const nx = (event.clientX - rect.left) / rect.width * 2 - 1;
    const ny = (event.clientY - rect.top) / rect.height * 2 - 1;
    const dead = 0.28;

    const out = new Set();
    if (nx < -dead) out.add('left');
    else if (nx > dead) out.add('right');
    if (ny < -dead) out.add('up');
    else if (ny > dead) out.add('down');

    // A press dead in the centre should still do something predictable.
    if (out.size === 0) {
      if (Math.abs(nx) > Math.abs(ny)) out.add(nx < 0 ? 'left' : 'right');
      else out.add(ny < 0 ? 'up' : 'down');
    }
    return out;
  }

  // -- keyboard ----------------------------------------------------------

  #bindKeyboard() {
    const isTyping = (event) =>
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' || event.target.isContentEditable);

    window.addEventListener('keydown', (event) => {
      if (isTyping(event)) return;

      // Shortcuts work whenever the page is focused, not only while playing.
      const shortcut = SHORTCUTS[event.code];
      if (shortcut) {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('shortcut', { detail: shortcut }));
        return;
      }

      const button = KEYMAP[event.code];
      if (!button || event.repeat) return;
      event.preventDefault();
      this.#press(button, true);
    });

    window.addEventListener('keyup', (event) => {
      if (isTyping(event)) return;
      const button = KEYMAP[event.code];
      if (!button) return;
      event.preventDefault();
      this.#press(button, false);
    });

    // A window that loses focus must not leave buttons stuck down.
    window.addEventListener('blur', () => this.releaseAll());
  }

  // -- gamepad -----------------------------------------------------------

  /** Called once per animation frame by the app. */
  pollGamepad() {
    if (!navigator.getGamepads) return;

    const pad = [...navigator.getGamepads()].find(Boolean);
    if (!pad) {
      if (this.gamepadPrevious.size) {
        for (const button of this.gamepadPrevious) this.#press(button, false);
        this.gamepadPrevious.clear();
      }
      return;
    }

    const now = new Set();
    const on = (index) => pad.buttons[index]?.pressed;

    // Right face button is A, bottom is B — this matches the diagonal
    // arrangement of the real console rather than a modern pad's labels.
    if (on(1)) now.add('a');
    if (on(0)) now.add('b');
    if (on(9)) now.add('start');
    if (on(8)) now.add('select');
    if (on(12)) now.add('up');
    if (on(13)) now.add('down');
    if (on(14)) now.add('left');
    if (on(15)) now.add('right');

    const [x = 0, y = 0] = pad.axes;
    const dead = 0.5;
    if (x < -dead) now.add('left');
    if (x > dead) now.add('right');
    if (y < -dead) now.add('up');
    if (y > dead) now.add('down');

    for (const button of this.gamepadPrevious) if (!now.has(button)) this.#press(button, false);
    for (const button of now) if (!this.gamepadPrevious.has(button)) this.#press(button, true);
    this.gamepadPrevious = now;
  }
}

const SHORTCUTS = {
  F2: 'save',
  F4: 'load',
  KeyP: 'pause',
  BracketLeft: 'palette-prev',
  BracketRight: 'palette-next',
};
