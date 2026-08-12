/**
 * The insert and eject choreography.
 *
 * Why the cartridge turns around on the way in: on the real console the
 * cartridge goes into the top edge with its label facing *away* from you,
 * while on the shelf it faces you. So it genuinely has to rotate 180 degrees
 * before it can go in. The animation is telling the truth about the object,
 * which is most of why it reads as satisfying rather than showy.
 *
 * Structure note: the flying cartridge is wrapped in a clipping element.
 * clip-path makes an element a grouping element, which would flatten
 * `transform-style: preserve-3d` and collapse the six-sided box into a flat
 * card — so the wrapper owns the position and the clip, the cartridge inside
 * owns the rotation, and the wrapper carries its own `perspective`.
 */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Reads the choreography out of CSS so the two can never disagree.
 *
 * The easings have to be resolved to literal cubic-bezier strings here: the
 * Web Animations API does not accept `var(--ease-swing)` as an easing, and
 * silently falls back to linear if you pass one — which drains the life out
 * of the whole sequence without any error to tell you why.
 */
function choreography(root = document.documentElement) {
  const style = getComputedStyle(root);

  const ms = (name, fallback) => {
    const raw = style.getPropertyValue(name).trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith('ms') ? value : value * 1000;
  };
  const ease = (name, fallback) =>
    style.getPropertyValue(name).trim() || fallback;

  return {
    lift: ms('--t-lift', 260),
    fly: ms('--t-fly', 640),
    align: ms('--t-align', 180),
    drop: ms('--t-drop', 240),
    click: ms('--t-click', 180),

    easeOut: ease('--ease-out-quint', 'cubic-bezier(0.22, 1, 0.36, 1)'),
    easeSwing: ease('--ease-swing', 'cubic-bezier(0.65, 0.05, 0.36, 1)'),
    easeDrop: ease('--ease-drop', 'cubic-bezier(0.33, 0, 0.20, 1)'),
  };
}

const transform = ({ dx = 0, dy = 0, dz = 0, s = 1 }) =>
  `translate3d(${dx}px, ${dy}px, ${dz}px) scale(${s})`;

const rotation = ({ rx = 0, ry = 0, rz = 0 }) =>
  `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;

/**
 * Measures where the cartridge starts and where it has to end up.
 * Everything downstream is expressed as a delta from the start.
 */
function measure(sourceCart, slot) {
  const from = sourceCart.getBoundingClientRect();
  const to = slot.getBoundingClientRect();

  // Match the cartridge to the console's current on-screen size, whatever
  // the viewport is doing.
  const scale = (to.width * 0.92) / from.width;
  const scaledH = from.height * scale;

  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;

  const hoverCy = to.top - scaledH / 2 - 26;
  const seatCy = hoverCy + scaledH * 0.80;

  return {
    from, scale, scaledH,
    dxTarget: to.left + to.width / 2 - fromCx,
    dyHover: hoverCy - fromCy,
    dySeat: seatCy - fromCy,
    hoverCy, seatCy,
    slotTop: to.top,
  };
}

/** How much of the cartridge is below the slot mouth, as a clip-path. */
function clipAt(centerY, m) {
  const bottom = centerY + m.scaledH / 2;
  const hidden = Math.min(1, Math.max(0, (bottom - m.slotTop) / m.scaledH));
  return `inset(0 0 ${(hidden * 100).toFixed(2)}% 0)`;
}

/** Builds the flying clone and returns its parts. */
function buildFlier(sourceCart, m, flight) {
  const wrap = document.createElement('div');
  wrap.className = 'flight__clip';
  wrap.style.cssText =
    `position:absolute; left:${m.from.left}px; top:${m.from.top}px;` +
    `width:${m.from.width}px; height:${m.from.height}px;` +
    'perspective:1400px; will-change:transform, clip-path;';

  const cart = sourceCart.cloneNode(true);
  cart.style.cssText =
    'position:absolute; inset:0; margin:0; transition:none; animation:none;' +
    'transform-style:preserve-3d; will-change:transform;';

  wrap.append(cart);
  flight.append(wrap);
  return { wrap, cart };
}

async function run(pairs) {
  await Promise.all(pairs.map((animation) => animation.finished));
}

/**
 * Flies a cartridge from the shelf into the slot.
 *
 * @param {object} options
 * @param {HTMLElement} options.sourceCart the cartridge sitting on the shelf
 * @param {HTMLElement} options.slot        the slot element on the console
 * @param {HTMLElement} options.flight      the fixed overlay to animate inside
 * @param {HTMLElement} options.consoleEl   for the jolt
 * @param {object}      options.sfx         audio engine, for click and scrape
 */
export async function playInsert({ sourceCart, slot, flight, consoleEl, sfx }) {
  const m = measure(sourceCart, slot);
  const { wrap, cart } = buildFlier(sourceCart, m, flight);
  const t = choreography();

  const seatWrap = { dx: m.dxTarget, dy: m.dySeat, s: m.scale };
  const seatRot = { ry: 180, rx: -4 };

  try {
    if (REDUCED.matches) {
      // Reduced motion: no flight, no tumble. It simply arrives.
      await run([
        wrap.animate(
          [{ transform: transform({ s: 1 }), opacity: 0.4 },
           { transform: transform(seatWrap), opacity: 1, clipPath: clipAt(m.seatCy, m) }],
          { duration: 200, easing: 'ease-out', fill: 'forwards' }),
        cart.animate(
          [{ transform: rotation({}) }, { transform: rotation(seatRot) }],
          { duration: 200, easing: 'ease-out', fill: 'forwards' }),
      ]);
      sfx?.click();
    } else {
      // P0 — lift off the shelf
      await run([
        wrap.animate(
          [{ transform: transform({ s: 1 }) },
           { transform: transform({ dy: -18, dz: 120, s: 1.06 }) }],
          { duration: t.lift, easing: t.easeOut, fill: 'forwards' }),
        cart.animate(
          [{ transform: rotation({}) }, { transform: rotation({ rz: -4 }) }],
          { duration: t.lift, easing: 'ease-out', fill: 'forwards' }),
      ]);

      // P1 — fly across and turn around, arcing toward the viewer
      await run([
        wrap.animate([
          { transform: transform({ dy: -18, dz: 120, s: 1.06 }), offset: 0 },
          { transform: transform({
              dx: m.dxTarget * 0.55, dy: m.dyHover * 0.45, dz: 190,
              s: 1.06 + (m.scale - 1.06) * 0.45 }), offset: 0.5 },
          { transform: transform({ dx: m.dxTarget, dy: m.dyHover, dz: 40, s: m.scale }), offset: 1 },
        ], { duration: t.fly, easing: t.easeSwing, fill: 'forwards' }),
        cart.animate([
          { transform: rotation({ rz: -4 }), offset: 0 },
          { transform: rotation({ ry: 96, rz: -2, rx: -14 }), offset: 0.52 },
          { transform: rotation({ ry: 180, rz: 0, rx: -12 }), offset: 1 },
        ], { duration: t.fly, easing: t.easeSwing, fill: 'forwards' }),
      ]);

      // P2 — hesitate over the mouth. The beat is what makes the drop read
      // as deliberate rather than as the cartridge simply falling.
      await run([
        wrap.animate(
          [{ transform: transform({ dx: m.dxTarget, dy: m.dyHover, dz: 40, s: m.scale }) },
           { transform: transform({ dx: m.dxTarget, dy: m.dyHover, s: m.scale }) }],
          { duration: t.align, easing: 'ease-out', fill: 'forwards' }),
        cart.animate(
          [{ transform: rotation({ ry: 180, rx: -12 }) },
           { transform: rotation(seatRot) }],
          { duration: t.align, easing: 'ease-out', fill: 'forwards' }),
      ]);

      // P3 — descend into the slot, clipping away as it goes
      sfx?.scrape();
      slot.classList.add('is-seating');
      await run([
        wrap.animate([
          { transform: transform({ dx: m.dxTarget, dy: m.dyHover, s: m.scale }),
            clipPath: clipAt(m.hoverCy, m) },
          { transform: transform(seatWrap), clipPath: clipAt(m.seatCy, m) },
        ], { duration: t.drop, easing: t.easeDrop, fill: 'forwards' }),
      ]);

      // P4 — the click. Hand-placed offsets with linear easing give a
      // mechanical snap; a spring curve reads far too soft here.
      sfx?.click();
      consoleEl.classList.add('is-jolt');
      const overshoot = m.scaledH * 0.05;
      await run([
        wrap.animate([
          { transform: transform(seatWrap), offset: 0 },
          { transform: transform({ ...seatWrap, dy: m.dySeat + overshoot }), offset: 0.34 },
          { transform: transform({ ...seatWrap, dy: m.dySeat - overshoot * 0.3 }), offset: 0.62 },
          { transform: transform({ ...seatWrap, dy: m.dySeat + overshoot * 0.1 }), offset: 0.84 },
          { transform: transform(seatWrap), offset: 1 },
        ], { duration: t.click, easing: 'linear', fill: 'forwards' }),
      ]);
    }
  } finally {
    slot.classList.remove('is-seating');
    consoleEl.classList.remove('is-jolt');
    wrap.remove();
  }

  slot.classList.add('is-loaded');
}

/**
 * Reverses the whole thing: the cartridge pops out of the slot and flies
 * back to its place on the shelf.
 */
export async function playEject({ sourceCart, slot, flight, consoleEl, sfx }) {
  const m = measure(sourceCart, slot);
  const { wrap, cart } = buildFlier(sourceCart, m, flight);
  const t = choreography();

  const seatWrap = { dx: m.dxTarget, dy: m.dySeat, s: m.scale };
  const seatRot = { ry: 180, rx: -4 };

  // Start seated and hidden inside the slot.
  wrap.style.transform = transform(seatWrap);
  wrap.style.clipPath = clipAt(m.seatCy, m);
  cart.style.transform = rotation(seatRot);
  slot.classList.remove('is-loaded');

  try {
    if (REDUCED.matches) {
      sfx?.pop();
      await run([
        wrap.animate(
          [{ transform: transform(seatWrap), opacity: 1 },
           { transform: transform({ s: 1 }), opacity: 0.2 }],
          { duration: 180, easing: 'ease-out', fill: 'forwards' }),
      ]);
    } else {
      // Pop out of the slot.
      sfx?.pop();
      consoleEl.classList.add('is-jolt');
      const popCy = m.seatCy - m.scaledH * 0.14;
      await run([
        wrap.animate([
          { transform: transform(seatWrap), clipPath: clipAt(m.seatCy, m) },
          { transform: transform({ ...seatWrap, dy: m.dySeat - m.scaledH * 0.14 }),
            clipPath: clipAt(popCy, m) },
        ], { duration: 120, easing: 'ease-out', fill: 'forwards' }),
      ]);
      consoleEl.classList.remove('is-jolt');

      // Rise clear of the slot.
      await run([
        wrap.animate([
          { transform: transform({ ...seatWrap, dy: m.dySeat - m.scaledH * 0.14 }),
            clipPath: clipAt(popCy, m) },
          { transform: transform({ dx: m.dxTarget, dy: m.dyHover, s: m.scale }),
            clipPath: 'inset(0 0 0% 0)' },
        ], { duration: t.drop + 40, easing: 'ease-out', fill: 'forwards' }),
      ]);

      // Turn back around and fly home.
      await run([
        wrap.animate([
          { transform: transform({ dx: m.dxTarget, dy: m.dyHover, s: m.scale }), offset: 0 },
          { transform: transform({
              dx: m.dxTarget * 0.5, dy: m.dyHover * 0.4, dz: 170,
              s: (m.scale + 1) / 2 }), offset: 0.5 },
          { transform: transform({ s: 1 }), offset: 1 },
        ], { duration: t.fly - 80, easing: t.easeSwing, fill: 'forwards' }),
        cart.animate([
          { transform: rotation(seatRot), offset: 0 },
          { transform: rotation({ ry: 280, rx: -10 }), offset: 0.5 },
          { transform: rotation({ ry: 360 }), offset: 1 },
        ], { duration: t.fly - 80, easing: t.easeSwing, fill: 'forwards' }),
      ]);
    }
  } finally {
    wrap.remove();
  }
}
