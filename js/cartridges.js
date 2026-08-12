/**
 * The cartridge shelf catalogue.
 *
 * These entries are labels and nothing more — no ROM data lives here, and
 * none ever will. Each slot is a place for the user to bind one of their own
 * files to, and binding is explicit: you click the slot you want, so the app
 * never has to guess which compilation a file belongs to.
 *
 * The band hue is what gives each cartridge its own identity on the shelf.
 */

export const SLOTS = [
  {
    id: 'vol-1',
    volume: 'VOL. 1',
    name: 'Collection',
    hue: 208,
    games: [
      'Gradius',
      'Castlevania: The Adventure',
      'Konami Racing',
      'Probotector',
    ],
  },
  {
    id: 'vol-2',
    volume: 'VOL. 2',
    name: 'Collection',
    hue: 152,
    games: [
      'Parodius',
      'Block Game',
      'Track & Field',
      'Frogger',
    ],
  },
  {
    id: 'vol-3',
    volume: 'VOL. 3',
    name: 'Collection',
    hue: 28,
    games: [
      "Pop'n TwinBee",
      'Mystical Ninja',
      'Bikers',
      'Guttang Gottong',
    ],
  },
  {
    id: 'vol-4',
    volume: 'VOL. 4',
    name: 'Collection',
    hue: 340,
    games: [
      'Gradius II',
      "Castlevania II: Belmont's Revenge",
    ],
    // The remaining two titles on this volume could not be confirmed from a
    // reliable source, and guessing on a label would be worse than saying so.
    // Fill them in above once you can read them off your own cartridge.
    unconfirmed: 2,
  },
  {
    id: 'own-1',
    volume: 'EIGENE',
    name: 'Cartridge',
    hue: 262,
    generic: true,
    games: ['Beliebiges .gb / .gbc'],
  },
  {
    id: 'own-2',
    volume: 'EIGENE',
    name: 'Cartridge',
    hue: 190,
    generic: true,
    games: ['Beliebiges .gb / .gbc'],
  },
];

/** @param {string} id */
export function findSlot(id) {
  return SLOTS.find((slot) => slot.id === id) ?? null;
}

/**
 * Builds the DOM for one cartridge.
 *
 * @param {object} slot   catalogue entry
 * @param {object|null} header  parsed ROM header, if a file is bound
 */
export function renderCartridge(slot, header) {
  const cart = document.createElement('div');
  cart.className = header ? 'cart' : 'cart is-empty';
  cart.style.setProperty('--band-h', slot.hue);

  const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
  const nodes = {};
  for (const face of faces) {
    const el = document.createElement('div');
    el.className = `cart__f cart__f--${face}`;
    cart.append(el);
    nodes[face] = el;
  }

  const label = document.createElement('div');
  label.className = 'label';

  if (!header) {
    label.innerHTML =
      '<span class="label__plus">+</span>' +
      `<span class="label__empty">${slot.generic ? 'Datei wählen' : slot.volume}</span>`;
  } else {
    const band = document.createElement('div');
    band.className = 'label__band';
    band.innerHTML =
      `<div class="label__vol">${escape(slot.volume)}</div>` +
      `<div class="label__name">${escape(slot.name)}</div>`;

    const list = document.createElement('ul');
    list.className = 'label__games';
    for (const game of slot.games) {
      const li = document.createElement('li');
      li.textContent = game;
      list.append(li);
    }
    if (slot.unconfirmed) {
      const li = document.createElement('li');
      li.textContent = `+ ${slot.unconfirmed} weitere`;
      list.append(li);
    }

    const foot = document.createElement('div');
    foot.className = 'label__foot';
    foot.innerHTML =
      `<span>${escape(header.isColour ? 'COLOR' : 'CLASSIC')}</span>` +
      `<span>${Math.round(header.size / 1024)}K</span>`;

    label.append(band, list, foot);
  }

  nodes.front.append(label);
  return cart;
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
