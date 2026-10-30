// Boards for the website, matching the app: every board comes from a seed
// through SplitMix64 (ADR-0011), so a challenge link's board is drawn here
// exactly as the app draws it.

const SIZES = {
  classic: { width: 10, height: 15 },
  mini: { width: 7, height: 7 },
};

const COLOR_NAMES = ["Red", "Blue", "Yellow", "Teal", "Purple", "Orange"];
const SYMBOL_NAMES = ["Dot", "Ring", "Triangle", "Bars", "Plus", "Wave"];

// The app's tile symbols in a unit box (`TileSymbol.unitPath`), one per
// color slot, so color is never the only way to tell tiles apart.
const SYMBOL_PATHS = [
  '<circle cx="0.5" cy="0.5" r="0.31"/>',
  '<circle cx="0.5" cy="0.5" r="0.34" fill="none" stroke="currentColor" stroke-width="0.15"/>',
  '<path d="M0.5 0.08L0.933 0.83H0.067Z"/>',
  '<rect x="0.1" y="0.22" width="0.8" height="0.18" rx="0.09"/><rect x="0.1" y="0.6" width="0.8" height="0.18" rx="0.09"/>',
  '<path d="M0.39 0.1H0.61V0.39H0.9V0.61H0.61V0.9H0.39V0.61H0.1V0.39H0.39Z"/>',
  '<path d="M0.08 0.5C0.22 0.2 0.36 0.2 0.5 0.5S0.78 0.8 0.92 0.5" fill="none" stroke="currentColor" stroke-width="0.19" stroke-linecap="round" stroke-linejoin="round"/>',
];

function symbolSVG(color) {
  return `<svg class="symbol" viewBox="0 0 1 1" aria-hidden="true" focusable="false" fill="currentColor">${SYMBOL_PATHS[color]}</svg>`;
}
const MASK = (1n << 64n) - 1n;

function splitMix64(seed) {
  let state = BigInt.asUintN(64, seed);
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  };
}

function randomSeed() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0]) << 32n) | BigInt(words[1]);
}

class Board {
  constructor(style, seed) {
    const { width, height } = SIZES[style];
    const next = splitMix64(seed);
    this.style = style;
    this.width = width;
    this.height = height;
    this.colors = [];
    for (let i = 0; i < width * height; i++) {
      this.colors.push(Number(next() % 6n));
    }
    this.moves = 0;
    this.region = new Set([0]);
    this.grow();
  }

  neighbors(i) {
    const x = i % this.width;
    const y = Math.floor(i / this.width);
    const result = [];
    if (x > 0) result.push(i - 1);
    if (x < this.width - 1) result.push(i + 1);
    if (y > 0) result.push(i - this.width);
    if (y < this.height - 1) result.push(i + this.width);
    return result;
  }

  get activeColor() {
    return this.colors[0];
  }

  get isSolved() {
    return this.region.size === this.colors.length;
  }

  // Adds every tile of the region's color that touches it.
  grow() {
    const queue = [...this.region];
    while (queue.length) {
      for (const n of this.neighbors(queue.pop())) {
        if (!this.region.has(n) && this.colors[n] === this.activeColor) {
          this.region.add(n);
          queue.push(n);
        }
      }
    }
  }

  // Each region tile's step count from the start tile, which sets when the
  // wave reaches it.
  distances() {
    const result = new Map([[0, 0]]);
    const queue = [0];
    while (queue.length) {
      const i = queue.shift();
      for (const n of this.neighbors(i)) {
        if (this.region.has(n) && !result.has(n)) {
          result.set(n, result.get(i) + 1);
          queue.push(n);
        }
      }
    }
    return result;
  }

  move(color) {
    if (color === this.activeColor || this.isSolved) return false;
    for (const i of this.region) this.colors[i] = color;
    this.grow();
    this.moves++;
    return true;
  }
}

function renderBoard(container, board) {
  container.style.setProperty("--columns", board.width);
  container.style.setProperty("--rows", board.height);
  container.replaceChildren(
    ...board.colors.map(() => {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.setAttribute("aria-hidden", "true");
      return tile;
    })
  );
  updateBoard(container, board, false);
}

function updateBoard(container, board, animated = true) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const distances = board.distances();
  [...container.children].forEach((tile, i) => {
    const delay = animated && !reduceMotion ? (distances.get(i) ?? 0) * 22 : 0;
    tile.style.transitionDelay = `${delay}ms`;
    if (tile.dataset.color !== String(board.colors[i])) {
      tile.dataset.color = board.colors[i];
      tile.innerHTML = symbolSVG(board.colors[i]);
    }
    tile.classList.toggle("region", board.region.has(i));
  });
}

// MARK: - Challenge links

// The payload of a challenge link: `/c/?b=<payload>` (ADR-0022), or the path
// form `/c/<payload>` that TestFlight builds shared.
function challengePayload(location) {
  if (location.pathname === "/c/" || location.pathname === "/c") {
    return new URLSearchParams(location.search).get("b");
  }
  const match = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)\/?$/);
  return match ? match[1] : null;
}

// Base64url of: format version 2, mode (bit 7 set when a time follows),
// generator version, the seed big-endian, par version, the sender's moves,
// the time in seconds (3 bytes, if flagged), then their strip (ADR-0017).
// Mirrors `PuzzleChallenge.decode` in the app.
function decodeChallenge(payload) {
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  let bytes;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length < 13 || bytes[0] !== 2 || bytes[2] !== 1) return null;

  const mode = bytes[1] & 0x7f;
  if (mode > 1) return null;
  let seed = 0n;
  for (let i = 3; i < 11; i++) seed = (seed << 8n) | BigInt(bytes[i]);

  let time = null;
  if (bytes[1] & 0x80) {
    if (bytes.length < 16) return null;
    time = (bytes[13] << 16) | (bytes[14] << 8) | bytes[15];
  }

  return {
    style: mode === 0 ? "classic" : "mini",
    seed,
    moves: bytes[12],
    time,
  };
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
