# Verification notes

- Node 22: `npm test` covers actual editing topology and drag projection/inversion, multiple camera positions/distances, end-on fallback, outward-only bounds, sub-threshold no-op, preview topology stability and source immutability.
- Chromium: `npm run test:browser` starts its own Vite server. Mouse drags are real browser inputs; mobile coverage uses CDP touch input. Actual OBJ downloads prove geometry displacement and byte-identical undo/cancellation rather than relying on screenshots alone.
- Browser cases: foreground face selection, click-only selection, multiple previews with zero undo entries until release, one-step commit/undo, Escape, pointer cancellation, return-to-zero, bevel dragging, keyboard Enter, background/right orbit, cached-tool deactivate rollback, and 390px touch dragging/no horizontal overflow.
- Actual captured examples are in `examples/01.png`, `examples/02.png`, with `examples/manifest.json`. The additional `mobile-drag.png` is a verification screenshot; it is not a third gallery item.
- Run output is written to ignored `output/browser-drag-results.json`.
- No GitHub Actions added. Publishing is coordinated by the parent task after verification.
