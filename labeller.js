/**
 * BoundingBoxLabeller
 *
 * Canvas-based labelling UI with category reassignment via double-click + number key.
 *
 * Usage:
 *   const labeller = new BoundingBoxLabeller('#canvas', { categories, imageUrl });
 *   labeller.on('change', ({ boxes }) => console.log(boxes));
 */

class BoundingBoxLabeller extends EventTarget {
  /**
   * @param {string|HTMLCanvasElement} target  CSS selector or canvas element
   * @param {Object} opts
   * @param {string[]} opts.categories          Ordered category names (index 0 = key "1")
   * @param {string} [opts.imageUrl]            Background image URL
   * @param {Object[]} [opts.initialBoxes]      Pre-existing boxes: { id, x, y, w, h, categoryIndex }
   */
  constructor(target, { categories = [], imageUrl = null, initialBoxes = [] } = {}) {
    super();

    this.canvas = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.canvas) throw new Error('Canvas element not found');

    this.ctx = this.canvas.getContext('2d');
    this.categories = categories;
    this.imageUrl = imageUrl;

    // State
    this.boxes = initialBoxes.map((b, i) => ({ id: b.id ?? i, ...b }));
    this.selectedId = null;
    this.reassignId = null;       // box currently in reassign mode
    this.drawing = null;          // { startX, startY, currentX, currentY } while dragging new box
    this.nextId = this.boxes.reduce((m, b) => Math.max(m, b.id + 1), 0);
    this.history = [];            // undo stack: array of serialised box arrays
    this.redoStack = [];

    // Colour palette — cycles if more categories than colours
    this.COLOURS = [
      '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
      '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
    ];

    this._prompt = null;          // { boxId, x, y } for the anchored overlay
    this._image = null;

    this._bindEvents();
    if (imageUrl) this._loadImage(imageUrl);
    this._render();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Undo the last destructive operation. */
  undo() {
    if (!this.history.length) return;
    this.redoStack.push(this._snapshot());
    this.boxes = JSON.parse(this.history.pop());
    this._cancelReassign();
    this._render();
    this._emit();
  }

  /** Redo a previously undone operation. */
  redo() {
    if (!this.redoStack.length) return;
    this.history.push(this._snapshot());
    this.boxes = JSON.parse(this.redoStack.pop());
    this._cancelReassign();
    this._render();
    this._emit();
  }

  /** Delete the currently selected box. */
  deleteSelected() {
    if (this.selectedId === null) return;
    this._pushHistory();
    this.boxes = this.boxes.filter(b => b.id !== this.selectedId);
    this.selectedId = null;
    this._cancelReassign();
    this._render();
    this._emit();
  }

  /** Programmatically set the active categories list. */
  setCategories(cats) {
    this.categories = cats;
    this._render();
  }

  // ─── History helpers ────────────────────────────────────────────────────────

  _snapshot() {
    return JSON.stringify(this.boxes.map(b => ({ ...b })));
  }

  _pushHistory() {
    this.history.push(this._snapshot());
    this.redoStack = [];
  }

  // ─── Event binding ──────────────────────────────────────────────────────────

  _bindEvents() {
    this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup',   e => this._onMouseUp(e));
    this.canvas.addEventListener('dblclick',  e => this._onDblClick(e));

    document.addEventListener('keydown', e => this._onKeyDown(e));

    // Click-outside to cancel reassign
    document.addEventListener('mousedown', e => {
      if (this.reassignId !== null && e.target !== this.canvas) {
        this._cancelReassign();
        this._render();
      }
    });
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _boxAt(x, y) {
    // Iterate in reverse so topmost (last-drawn) box wins
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return b;
      }
    }
    return null;
  }

  // ─── Mouse handlers ─────────────────────────────────────────────────────────

  _onMouseDown(e) {
    if (e.detail === 2) return;     // let dblclick handler own this
    if (this.reassignId !== null) {
      this._cancelReassign();
      this._render();
      return;
    }

    const { x, y } = this._pos(e);
    const hit = this._boxAt(x, y);

    if (hit) {
      this.selectedId = hit.id;
      this.drawing = null;
    } else {
      // Start drawing a new box only if categories exist
      if (!this.categories.length) return;
      this.selectedId = null;
      this.drawing = { startX: x, startY: y, currentX: x, currentY: y };
    }
    this._render();
  }

  _onMouseMove(e) {
    if (!this.drawing) return;
    const { x, y } = this._pos(e);
    this.drawing.currentX = x;
    this.drawing.currentY = y;
    this._render();
  }

  _onMouseUp(e) {
    if (!this.drawing) return;
    const { startX, startY, currentX, currentY } = this.drawing;
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    if (w > 5 && h > 5) {
      this._pushHistory();
      const box = {
        id: this.nextId++,
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        w,
        h,
        categoryIndex: 0,   // default to first category; user reassigns if needed
      };
      this.boxes.push(box);
      this.selectedId = box.id;
      this._emit();
    }
    this.drawing = null;
    this._render();
  }

  // ─── Double-click → enter reassign mode ─────────────────────────────────────

  _onDblClick(e) {
    const { x, y } = this._pos(e);
    const hit = this._boxAt(x, y);
    if (!hit) return;

    // Toggle: double-clicking the already-reassigning box cancels
    if (this.reassignId === hit.id) {
      this._cancelReassign();
    } else {
      this.reassignId = hit.id;
      this.selectedId = hit.id;
      this._prompt = this._promptPosition(hit);
    }
    this._render();
  }

  /** Compute the screen position for the reassign prompt, keeping it on-canvas. */
  _promptPosition(box) {
    const PAD = 8;
    const PROMPT_W = 200;
    const PROMPT_H = 36 + this.categories.length * 24 + PAD;
    let px = box.x;
    let py = box.y + box.h + PAD;
    if (py + PROMPT_H > this.canvas.height) py = box.y - PROMPT_H - PAD;
    if (px + PROMPT_W > this.canvas.width)  px = this.canvas.width - PROMPT_W - PAD;
    return { x: Math.max(PAD, px), y: Math.max(PAD, py) };
  }

  // ─── Keyboard handler ────────────────────────────────────────────────────────

  _onKeyDown(e) {
    // Global shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); this.redo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelected(); return; }

    // Reassign-state number keys
    if (this.reassignId !== null) {
      if (e.key === 'Escape') {
        this._cancelReassign();
        this._render();
        return;
      }

      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= this.categories.length) {
        this._reassign(this.reassignId, num - 1);
      } else if (!isNaN(num) || /^[a-zA-Z]$/.test(e.key)) {
        // Out-of-range key: shake the prompt
        this._shakePrompt();
      }
    }
  }

  _reassign(boxId, categoryIndex) {
    const box = this.boxes.find(b => b.id === boxId);
    if (!box) return;
    if (box.categoryIndex === categoryIndex) {
      this._cancelReassign();
      this._render();
      return;
    }
    this._pushHistory();
    box.categoryIndex = categoryIndex;
    this._cancelReassign();
    this._render();
    this._emit();
  }

  _cancelReassign() {
    this.reassignId = null;
    this._prompt = null;
    this._shaking = false;
  }

  // ─── Shake animation ─────────────────────────────────────────────────────────

  _shakePrompt() {
    this._shaking = true;
    this._shakeStart = performance.now();
    const animate = (now) => {
      if (!this._shaking) return;
      if (now - this._shakeStart > 400) { this._shaking = false; this._render(); return; }
      this._render();
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background image
    if (this._image) {
      ctx.drawImage(this._image, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw all boxes
    this.boxes.forEach(box => this._drawBox(box));

    // Draw in-progress box
    if (this.drawing) this._drawDraft(this.drawing);

    // Draw reassign prompt overlay
    if (this.reassignId !== null && this._prompt) this._drawPrompt();
  }

  _colour(categoryIndex) {
    return this.COLOURS[categoryIndex % this.COLOURS.length];
  }

  _drawBox(box) {
    const { ctx } = this;
    const colour = this._colour(box.categoryIndex);
    const isSelected  = box.id === this.selectedId;
    const isReassign  = box.id === this.reassignId;

    // Fill
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = colour;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.globalAlpha = 1;

    // Stroke
    ctx.strokeStyle = colour;
    ctx.lineWidth = isReassign ? 3 : (isSelected ? 2 : 1.5);
    if (isReassign) {
      ctx.setLineDash([6, 3]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);

    // Label badge
    const label = this.categories[box.categoryIndex] ?? `cat${box.categoryIndex + 1}`;
    const BADGE_H = 18;
    const BADGE_PAD = 5;
    ctx.font = 'bold 11px monospace';
    const tw = ctx.measureText(label).width;
    const bx = box.x;
    const by = box.y - BADGE_H;

    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + BADGE_PAD * 2, BADGE_H, 3);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + BADGE_PAD, by + BADGE_H - 5);

    // Selection handles
    if (isSelected || isReassign) {
      const HANDLE = 6;
      ctx.fillStyle = colour;
      const corners = [
        [box.x, box.y], [box.x + box.w, box.y],
        [box.x, box.y + box.h], [box.x + box.w, box.y + box.h],
      ];
      corners.forEach(([cx, cy]) => {
        ctx.fillRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE);
      });
    }
  }

  _drawDraft({ startX, startY, currentX, currentY }) {
    const { ctx } = this;
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  _drawPrompt() {
    const { ctx } = this;
    const PAD = 10;
    const ROW_H = 22;
    const W = 190;
    const H = 30 + this.categories.length * ROW_H + PAD;

    // Shake offset
    let ox = 0;
    if (this._shaking) {
      const t = (performance.now() - this._shakeStart) / 400;
      ox = Math.sin(t * Math.PI * 6) * 6 * (1 - t);
    }

    const { x, y } = this._prompt;
    const px = x + ox;

    // Panel background
    ctx.fillStyle = 'rgba(10, 10, 20, 0.92)';
    ctx.beginPath();
    ctx.roundRect(px, y, W, H, 6);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Header
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px monospace';
    ctx.fillText('Pick a category', px + PAD, y + 18);

    // Category rows
    this.categories.forEach((cat, i) => {
      const ry = y + 28 + i * ROW_H;
      const colour = this._colour(i);

      // Key badge
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.roundRect(px + PAD, ry, 18, 16, 3);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(String(i + 1), px + PAD + 4, ry + 12);

      // Category name
      ctx.fillStyle = '#ddd';
      ctx.font = '11px monospace';
      ctx.fillText(cat, px + PAD + 24, ry + 12);
    });
  }

  // ─── Image loading ───────────────────────────────────────────────────────────

  _loadImage(url) {
    const img = new Image();
    img.onload = () => { this._image = img; this._render(); };
    img.src = url;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _emit() {
    this.dispatchEvent(new CustomEvent('change', { detail: { boxes: this.boxes.map(b => ({ ...b })) } }));
  }

  on(event, handler) {
    this.addEventListener(event, e => handler(e.detail));
    return this;
  }
}
