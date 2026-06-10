// ── PATH SEGMENT COLOUR SCHEME ────────────────────────────────────────────
// The colour of each new path segment is decided HERE (rendering concern).
// It is keyed by the QUADRANT of the clicked image — i.e. which relation
// component the user clicked in — matching interface_nuxt's QUADRANT_INDEX:
//   0 = tl,  1 = tr,  2 = bl,  3 = br
//
// HOW TO EXPERIMENT (edit only this file, reload the project page):
//  • Recolour one quadrant → change its hex in QUADRANT_COLORS below.
//  • Make the WHOLE path a single colour ("erase all") → set OVERRIDE_COLOR
//    to a hex (e.g. 0xffffff). Every new segment then uses that one colour,
//    ignoring the quadrant scheme. Set it back to `null` for per-quadrant.
//
// Note: a segment's colour is fixed when it is drawn, so changing these
// values affects segments drawn AFTERWARDS (reload to recolour an existing
// path — it rebuilds from the user's clicks anyway).

// Per-quadrant colours, indexed [tl, tr, bl, br].
export const QUADRANT_COLORS = [
    0xf0a05c, // 0 — tl — Source   — pastel orange
    0x6cb4e6, // 1 — tr — Form     — pastel sky blue
    0x74cf92, // 2 — bl — Semantic — pastel green
    0xef82ac, // 3 — br — Time     — pastel pink
];

// Single override. Non-null = every new segment uses this one colour
// regardless of quadrant ("one colour for every path"). null = per-quadrant.
// null → the QUADRANT_COLORS palette above is now active.
export const OVERRIDE_COLOR = null;

// Fallback when a segment carries no quadrant (e.g. the explore-others foreign
// path redraw) and no override is set — kept a neutral grey so OTHER
// participants' paths read muted vs. the user's own colour-coded path.
const DEFAULT_COLOR = 0x595b55;

// Resolve the colour for a segment given the clicked image's quadrant index.
// Precedence: OVERRIDE_COLOR > the quadrant's colour > DEFAULT_COLOR.
export function colorForQuadrant(quadrant) {
    if (OVERRIDE_COLOR != null) return OVERRIDE_COLOR;
    if (typeof quadrant === 'number' && QUADRANT_COLORS[quadrant] != null) {
        return QUADRANT_COLORS[quadrant];
    }
    return DEFAULT_COLOR;
}

// ── Legacy palette (used only by the unreferenced demo path in main.js) ────
export const COLORS = [
    { key: 'cyan',    hex: 0x88ccff },
    { key: 'orange',  hex: 0xff9a3c },
    { key: 'magenta', hex: 0xff6ad5 },
    { key: 'lime',    hex: 0xb8ff5c },
];

export function pickRandom() {
    return COLORS[Math.floor(Math.random() * COLORS.length)].hex;
}
