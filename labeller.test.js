/**
 * Unit tests for BoundingBoxLabeller
 * Run with: node --experimental-vm-modules labeller.test.js
 * (or drop into Jest / Vitest with a jsdom environment)
 *
 * This file uses a minimal hand-rolled test harness so it has zero
 * runtime dependencies and can be evaluated in any Node ≥ 18 with
 * the jsdom shim below.
 */

// ── Minimal DOM shim ──────────────────────────────────────────────────────────

class FakeCanvas {
  constructor(w = 900, h = 600) {
    this.width = w; this.height = h;
    this._listeners = {};
    this.getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: h });
  }
  getContext() {
    return {
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {},
      moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      fillText() {}, measureText() { return { width: 50 }; },
      roundRect() {}, drawImage() {}, createLinearGradient() {
        return { addColorStop() {} };
      },
      setLineDash() {}, save() {}, restore() {},
      globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
      font: '',
    };
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  dispatchEvent(e) {
    (this._listeners[e.type] || []).forEach(fn => fn(e));
  }
}

class FakeEvent {
  constructor(type, props = {}) {
    this.type = type;
    Object.assign(this, props);
    this.detail = props.detail ?? null;
    this.preventDefault = () => {};
  }
}

// Stub globals the module needs
global.document = {
  _listeners: {},
  querySelector: sel => new FakeCanvas(),
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  },
  dispatchEvent(e) {
    (this._listeners[e.type] || []).forEach(fn => fn(e));
  },
};
global.window = {};
global.requestAnimationFrame = fn => setTimeout(fn, 0);
global.performance = { now: () => Date.now() };
global.CustomEvent = class extends FakeEvent {
  constructor(type, opts = {}) { super(type, opts); this.detail = opts.detail ?? null; }
};
global.EventTarget = class {
  constructor() { this._evl = {}; }
  addEventListener(t, fn) { (this._evl[t] = this._evl[t] || []).push(fn); }
  removeEventListener(t, fn) { this._evl[t] = (this._evl[t] || []).filter(f => f !== fn); }
  dispatchEvent(e) { (this._evl[e.type] || []).forEach(fn => fn(e)); }
};
global.Image = class { set src(_) { this.onload?.(); } };

// ── Load the module ───────────────────────────────────────────────────────────

const fs = require('fs');
eval(fs.readFileSync('./labeller.js', 'utf8'));   // exposes BoundingBoxLabeller

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try { fn(); results.push({ ok: true,  name }); passed++; }
  catch(e) { results.push({ ok: false, name, err: e.message }); failed++; }
}

function expect(val) {
  return {
    toBe(expected) {
      if (val !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(val)}`);
    },
    toEqual(expected) {
      const a = JSON.stringify(val), b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
    },
    toBeTruthy() { if (!val) throw new Error(`Expected truthy, got ${JSON.stringify(val)}`); },
    toBeFalsy()  { if (val)  throw new Error(`Expected falsy, got ${JSON.stringify(val)}`); },
    toBeNull()   { if (val !== null) throw new Error(`Expected null, got ${JSON.stringify(val)}`); },
    toBeGreaterThan(n) { if (!(val > n)) throw new Error(`Expected ${val} > ${n}`); },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLabeller(overrides = {}) {
  const canvas = new FakeCanvas();
  return new BoundingBoxLabeller(canvas, {
    categories: ['Person', 'Vehicle', 'Animal', 'Sign', 'Object'],
    initialBoxes: [
      { id: 0, x: 100, y: 100, w: 200, h: 150, categoryIndex: 0 },
      { id: 1, x: 400, y: 200, w: 160, h: 120, categoryIndex: 2 },
    ],
    ...overrides,
  });
}

function pressKey(labeller, key, extra = {}) {
  const e = new FakeEvent('keydown', { key, ctrlKey: false, metaKey: false, ...extra });
  document._listeners.keydown?.forEach(fn => fn(e));
}

// Simulate a double-click on canvas at (x, y)
function dblClick(labeller, x, y) {
  const e = new FakeEvent('dblclick', {
    clientX: x, clientY: y, detail: 2,
    target: labeller.canvas,
  });
  labeller.canvas._listeners.dblclick?.forEach(fn => fn(e));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('initial boxes are loaded correctly', () => {
  const lb = makeLabeller();
  expect(lb.boxes.length).toBe(2);
  expect(lb.boxes[0].categoryIndex).toBe(0);
  expect(lb.boxes[1].categoryIndex).toBe(2);
});

test('double-clicking a box enters reassign mode', () => {
  const lb = makeLabeller();
  // Box 0 spans (100,100) → (300,250); click centre
  dblClick(lb, 200, 175);
  expect(lb.reassignId).toBe(0);
  expect(lb._prompt).toBeTruthy();
});

test('double-clicking outside a box does not enter reassign mode', () => {
  const lb = makeLabeller();
  dblClick(lb, 10, 10);
  expect(lb.reassignId).toBeNull();
});

test('valid number key reassigns the box category', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);           // enter reassign on box 0 (Person)
  expect(lb.reassignId).toBe(0);

  let changed = false;
  lb.on('change', () => { changed = true; });

  pressKey(lb, '2');               // reassign to Vehicle (index 1)
  expect(lb.boxes[0].categoryIndex).toBe(1);
  expect(lb.reassignId).toBeNull();  // prompt dismissed
  expect(changed).toBeTruthy();
});

test('invalid number key does not reassign and keeps prompt open', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);
  pressKey(lb, '9');               // only 5 categories; 9 is invalid
  expect(lb.boxes[0].categoryIndex).toBe(0);   // unchanged
  expect(lb.reassignId).toBe(0);               // still in reassign mode
});

test('key "0" does not reassign (out of range)', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);
  pressKey(lb, '0');
  expect(lb.boxes[0].categoryIndex).toBe(0);
  expect(lb.reassignId).toBe(0);
});

test('Escape cancels reassign without changing category', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);
  pressKey(lb, 'Escape');
  expect(lb.boxes[0].categoryIndex).toBe(0);
  expect(lb.reassignId).toBeNull();
});

test('reassignment is captured in undo history', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);
  pressKey(lb, '3');               // reassign box 0 to Animal

  expect(lb.boxes[0].categoryIndex).toBe(2);
  expect(lb.history.length).toBeGreaterThan(0);

  lb.undo();
  expect(lb.boxes[0].categoryIndex).toBe(0);   // back to Person
});

test('redo restores category after undo', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);
  pressKey(lb, '3');               // box 0 → Animal (index 2)
  lb.undo();                       // back to Person (index 0)
  lb.redo();                       // forward to Animal again
  expect(lb.boxes[0].categoryIndex).toBe(2);
});

test('Ctrl+Z triggers undo', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);
  pressKey(lb, '3');
  pressKey(lb, 'z', { ctrlKey: true });
  expect(lb.boxes[0].categoryIndex).toBe(0);
});

test('delete key removes selected box', () => {
  const lb = makeLabeller();
  lb.selectedId = 0;
  pressKey(lb, 'Delete');
  expect(lb.boxes.length).toBe(1);
  expect(lb.boxes.find(b => b.id === 0)).toBeFalsy();
});

test('only one box can be in reassign mode at a time', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);          // box 0 in reassign
  expect(lb.reassignId).toBe(0);
  dblClick(lb, 480, 260);          // box 1 in reassign
  expect(lb.reassignId).toBe(1);   // box 0 was implicitly cancelled
});

test('reassigning to the same category is a no-op (no history entry)', () => {
  const lb = makeLabeller();
  const histBefore = lb.history.length;
  dblClick(lb, 200, 175);          // box 0 is already Person (index 0)
  pressKey(lb, '1');               // re-select Person
  expect(lb.boxes[0].categoryIndex).toBe(0);
  expect(lb.history.length).toBe(histBefore);  // no undo entry pushed
});

test('double-clicking an already-reassigning box cancels the mode', () => {
  const lb = makeLabeller();
  dblClick(lb, 200, 175);
  expect(lb.reassignId).toBe(0);
  dblClick(lb, 200, 175);          // toggle off
  expect(lb.reassignId).toBeNull();
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n  Bounding Box Labeller — test results\n');
results.forEach(r => {
  const icon = r.ok ? '✓' : '✗';
  console.log(`  ${icon} ${r.name}${r.err ? '\n      ' + r.err : ''}`);
});
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
