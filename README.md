# Bounding Box Labeller

A zero-dependency, canvas-based image annotation tool built for the Journey Log labelling workflow. Annotators draw bounding boxes around objects, assign categories, and can reassign categories without deleting and redrawing boxes.

## Background

This mini-project implements the fix described in the Journey Log label-reassignment bug report. Previously, correcting a miscategorised box required deleting it and redrawing from scratch — losing the original geometry and any associated metadata. The fix adds a double-click + number-key flow that reassigns a category non-destructively.

## Features

- **Draw** bounding boxes by clicking and dragging on the canvas
- **Select** an existing box with a single click
- **Reassign** a box's category by double-clicking it, then pressing a number key (1–N)
- **Cancel** reassignment with Escape or by clicking outside the box
- **Undo / Redo** all operations (Ctrl+Z / Ctrl+Y)
- **Delete** the selected box (Delete or Backspace)
- Colour-coded categories with label badges on each box
- Shake animation feedback when an out-of-range key is pressed
- Prompt anchored to the box listing valid keys for the active dataset

## Usage

Open `index.html` directly in a browser — no build step or server required.

```
open LookoutCodingAgentTask/index.html
```

The page loads with three pre-seeded boxes to demonstrate reassignment. Double-click any box to enter reassign mode, then press the number shown next to the category you want.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Drag | Draw a new box |
| Click | Select a box |
| Double-click | Enter reassign mode |
| 1–N | Reassign to category N (reassign mode only) |
| Escape | Cancel reassign |
| Delete / Backspace | Delete selected box |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |

## Embedding the labeller

`labeller.js` exposes a single class with no external dependencies.

```js
const labeller = new BoundingBoxLabeller('#canvas', {
  categories: ['Person', 'Vehicle', 'Animal'],
  imageUrl: '/path/to/image.jpg',       // optional
  initialBoxes: [                        // optional pre-existing boxes
    { id: 0, x: 80, y: 120, w: 200, h: 150, categoryIndex: 0 },
  ],
});

labeller.on('change', ({ boxes }) => {
  console.log(boxes);  // full box list after every mutation
});
```

Each box in the `change` payload has the shape `{ id, x, y, w, h, categoryIndex }`.

### API

| Method | Description |
|--------|-------------|
| `undo()` | Undo the last operation |
| `redo()` | Redo a previously undone operation |
| `deleteSelected()` | Delete the currently selected box |
| `setCategories(cats)` | Replace the active category list |
| `on('change', fn)` | Subscribe to box mutations |

## Running the tests

The test suite uses a hand-rolled harness with no runtime dependencies. Node 18+ is required.

```bash
node labeller.test.js
```

Tests cover: valid reassignment, invalid key press, cancellation via Escape, undo/redo across reassignments, same-category no-op, single-reassign-mode constraint, and existing draw/delete/select flows.

## File structure

```
index.html       — UI shell: sidebar, canvas, toolbar, seed data
labeller.js      — BoundingBoxLabeller class (all logic and rendering)
labeller.test.js — Unit/integration tests
```

## Design decisions

- **Number keys are scoped to reassign mode only** — no conflict with other shortcuts.
- **Category count is read from the active dataset** — the prompt always shows the correct 1–N range; no hard-coded limit.
- **Reassigning to the same category is a no-op** — no spurious undo entry is pushed.
- **Only one box can be in reassign mode at a time** — double-clicking a second box implicitly cancels the first.
- **All mutations go through the undo stack** — reassignment, draw, and delete are all undoable in a single step.
