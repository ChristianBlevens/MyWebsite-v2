// Canvas-based card face renderers for the textured-plane representation
// (compact cards). Mirrors the visual design of the live CSS .card / .card-front
// / .card-back-only rules so the textured and css3d representations look the
// same — the user only ever sees one at a time per card.
//
// Authoring resolution: CARD_PX_W × CARD_PX_H (1260 × 1890 from layout.js).
// All sizes below are in those native pixels, calibrated to match the rem-based
// CSS used in the live DOM (1rem ≈ 16px, all values 4× per the comment in
// styles.css §"Cards").

import { CARD_PX_W, CARD_PX_H } from './layout.js';

const BG = '#18181c';
const BORDER_COLOR = 'rgba(255,255,255,0.08)';
export const BORDER_RADIUS = 56;
const BORDER_WIDTH = 4;

const TITLE_COLOR = '#e7e7ea';
const SUMMARY_COLOR = 'rgba(231,231,234,0.75)';
const TAG_BG = 'rgba(79,157,255,0.15)';
const TAG_FG = '#9fc5ff';

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// CSS-derived sizes (all 4× the rem value × 16px-per-rem; see styles.css note)
const TOP_REGION_HEIGHT = Math.floor(CARD_PX_H * 0.55);
const PAD_BOTTOM_TOP = 64;       // .card-bottom padding-top: 4rem
const PAD_BOTTOM_X = 70.4;       // padding-x: 4.4rem
const PAD_BOTTOM_BOTTOM = 70.4;
const TITLE_PX = 67.2;           // 4.2rem
const TITLE_LINE_H = TITLE_PX * 1.2;
const SUMMARY_PX = 52.48;        // 3.28rem
const SUMMARY_LINE_H = SUMMARY_PX * 1.35;
const TAG_PX = 43.52;            // 2.72rem
const TAG_PAD_X = 32;            // 2rem
const TAG_PAD_Y = 9.6;           // 0.6rem
const TAG_RADIUS = 40;
const TAG_GAP = 19.2;            // 1.2rem
const SECTION_GAP = 32;          // 2rem (gap between title/summary/tags)

const TOGGLE_X = CARD_PX_W - 48 - 216;
const TOGGLE_Y = 48;
const TOGGLE_W = 216;
const TOGGLE_H = 104;
const TOGGLE_RADIUS = 52;
const TOGGLE_KNOB_INSET = 8;
const TOGGLE_KNOB_SIZE = 80;

export const TOGGLE_RECT = Object.freeze({
    x: TOGGLE_X, y: TOGGLE_Y, w: TOGGLE_W, h: TOGGLE_H,
});

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const tryLine = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(tryLine).width > maxWidth) {
            lines.push(cur);
            cur = w;
        } else {
            cur = tryLine;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function clipRoundedCard(ctx) {
    roundRectPath(ctx, 0, 0, CARD_PX_W, CARD_PX_H, BORDER_RADIUS);
    ctx.clip();
}

function drawBg(ctx) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, CARD_PX_W, CARD_PX_H);
}

function drawCardBorder(ctx) {
    ctx.lineWidth = BORDER_WIDTH;
    ctx.strokeStyle = BORDER_COLOR;
    roundRectPath(ctx, BORDER_WIDTH / 2, BORDER_WIDTH / 2,
        CARD_PX_W - BORDER_WIDTH, CARD_PX_H - BORDER_WIDTH, BORDER_RADIUS);
    ctx.stroke();
}

// Bottom region (title + summary + tags) — matches .card-bottom layout.
function drawFrontText(ctx, project) {
    const textX = PAD_BOTTOM_X;
    const textRight = CARD_PX_W - PAD_BOTTOM_X;
    const maxW = textRight - textX;

    let y = TOP_REGION_HEIGHT + PAD_BOTTOM_TOP;

    // Title (multi-line wrap)
    ctx.font = `600 ${TITLE_PX}px ${FONT_STACK}`;
    ctx.fillStyle = TITLE_COLOR;
    ctx.textBaseline = 'top';
    const titleLines = wrapText(ctx, project.title, maxW);
    for (const line of titleLines) {
        ctx.fillText(line, textX, y);
        y += TITLE_LINE_H;
    }
    y += SECTION_GAP;

    // Summary
    ctx.font = `${SUMMARY_PX}px ${FONT_STACK}`;
    ctx.fillStyle = SUMMARY_COLOR;
    const summaryLines = wrapText(ctx, project.summary, maxW);
    for (const line of summaryLines) {
        ctx.fillText(line, textX, y);
        y += SUMMARY_LINE_H;
    }

    // Tags — anchored to bottom (matches `margin-top: auto`), wrapping upward
    ctx.font = `${TAG_PX}px ${FONT_STACK}`;
    const tagH = TAG_PX + TAG_PAD_Y * 2;
    const tags = project.tags || [];
    // Pack tags into rows top-down for measurement, then offset to bottom.
    const rows = [];
    let row = [];
    let rowW = 0;
    for (const tag of tags) {
        const tw = ctx.measureText(tag).width + TAG_PAD_X * 2;
        if (row.length && rowW + TAG_GAP + tw > maxW) {
            rows.push(row);
            row = [];
            rowW = 0;
        }
        row.push({ tag, w: tw });
        rowW += (row.length === 1 ? 0 : TAG_GAP) + tw;
    }
    if (row.length) rows.push(row);

    let tagY = CARD_PX_H - PAD_BOTTOM_BOTTOM - rows.length * tagH
              - (rows.length - 1) * TAG_GAP;
    for (const r of rows) {
        let x = textX;
        for (const { tag, w } of r) {
            ctx.fillStyle = TAG_BG;
            roundRectPath(ctx, x, tagY, w, tagH, TAG_RADIUS);
            ctx.fill();
            ctx.fillStyle = TAG_FG;
            ctx.fillText(tag, x + TAG_PAD_X, tagY + TAG_PAD_Y);
            x += w + TAG_GAP;
        }
        tagY += tagH + TAG_GAP;
    }
}

// Front-face renderer that draws everything *including* a static thumbnail
// (or the dark placeholder when no thumbnail). One canvas, one texture, used
// by cards without a video thumbnail.
export function renderFrontStaticCanvas(project, image) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_PX_W;
    canvas.height = CARD_PX_H;
    const ctx = canvas.getContext('2d');

    ctx.save();
    clipRoundedCard(ctx);
    drawBg(ctx);

    // Thumbnail region (top 55%). Object-fit: cover.
    if (image && (image.naturalWidth || image.width)) {
        const dstW = CARD_PX_W;
        const dstH = TOP_REGION_HEIGHT;
        const srcW = image.naturalWidth || image.width;
        const srcH = image.naturalHeight || image.height;
        const dstA = dstW / dstH;
        const srcA = srcW / srcH;
        let sx = 0, sy = 0, sW = srcW, sH = srcH;
        if (srcA > dstA) { sW = srcH * dstA; sx = (srcW - sW) / 2; }
        else             { sH = srcW / dstA; sy = (srcH - sH) / 2; }
        ctx.drawImage(image, sx, sy, sW, sH, 0, 0, dstW, dstH);
    }

    drawFrontText(ctx, project);
    drawTogglePill(ctx, project);
    drawCardBorder(ctx);
    ctx.restore();

    return canvas;
}

// Toggle pill — drawn in the front face's top-right. Compact-state knob (left
// position). Only present for cards with iframeUrl.
function drawTogglePill(ctx, project) {
    if (!project.iframeUrl) return;
    roundRectPath(ctx, TOGGLE_X, TOGGLE_Y, TOGGLE_W, TOGGLE_H, TOGGLE_RADIUS);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    // Knob (compact = left)
    const knobX = TOGGLE_X + TOGGLE_KNOB_INSET;
    const knobY = TOGGLE_Y + TOGGLE_KNOB_INSET;
    ctx.beginPath();
    ctx.arc(knobX + TOGGLE_KNOB_SIZE / 2, knobY + TOGGLE_KNOB_SIZE / 2,
            TOGGLE_KNOB_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#e7e7ea';
    ctx.fill();
}

// Bottom-half text canvas for cards with VIDEO thumbnails. Used together
// with a sibling VideoTexture plane covering the top region.
export function renderFrontBottomTextCanvas(project) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_PX_W;
    canvas.height = CARD_PX_H;
    const ctx = canvas.getContext('2d');

    ctx.save();
    clipRoundedCard(ctx);
    // Transparent above the text region; let the underlying video plane show
    // through (the text plane sits on top, so we need top half clear).
    ctx.clearRect(0, 0, CARD_PX_W, TOP_REGION_HEIGHT);
    // Solid bg only in the text region.
    ctx.fillStyle = BG;
    ctx.fillRect(0, TOP_REGION_HEIGHT, CARD_PX_W, CARD_PX_H - TOP_REGION_HEIGHT);
    drawFrontText(ctx, project);
    drawCardBorder(ctx);
    ctx.restore();

    return canvas;
}

// Tiny canvas just for the toggle pill — used as an overlay over a VideoTexture
// plane (since we can't composite onto a VideoTexture). Same authoring size as
// the card so the pill lands at the same coords without a UV remap.
export function renderTogglePillCanvas(project) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_PX_W;
    canvas.height = CARD_PX_H;
    const ctx = canvas.getContext('2d');
    drawTogglePill(ctx, project);
    return canvas;
}

// Generic card back — same for every card. Trading-card style: dark field with
// a centered geometric mark + "Christian Blevens" wordmark below. One shared
// texture across the whole deck (built once, reused by every card).
let _backCanvas = null;
export function getGenericBackCanvas() {
    if (_backCanvas) return _backCanvas;
    const canvas = document.createElement('canvas');
    canvas.width = CARD_PX_W;
    canvas.height = CARD_PX_H;
    const ctx = canvas.getContext('2d');

    ctx.save();
    clipRoundedCard(ctx);
    // Subtle radial gradient
    const grad = ctx.createRadialGradient(
        CARD_PX_W / 2, CARD_PX_H / 2, 50,
        CARD_PX_W / 2, CARD_PX_H / 2, Math.max(CARD_PX_W, CARD_PX_H) / 1.2
    );
    grad.addColorStop(0, '#1c1c24');
    grad.addColorStop(1, '#0d0d10');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CARD_PX_W, CARD_PX_H);

    // Diagonal cross-hatch pattern (very faint)
    ctx.strokeStyle = 'rgba(79,157,255,0.06)';
    ctx.lineWidth = 2;
    const step = 64;
    for (let i = -CARD_PX_H; i < CARD_PX_W + CARD_PX_H; i += step) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + CARD_PX_H, CARD_PX_H);
        ctx.stroke();
    }

    // Centered diamond mark
    const cx = CARD_PX_W / 2;
    const cy = CARD_PX_H / 2 - 60;
    const r = 240;
    ctx.strokeStyle = 'rgba(79,157,255,0.55)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.6);
    ctx.lineTo(cx + r * 0.6, cy);
    ctx.lineTo(cx, cy + r * 0.6);
    ctx.lineTo(cx - r * 0.6, cy);
    ctx.closePath();
    ctx.stroke();

    // Wordmark
    ctx.font = `600 ${TITLE_PX}px ${FONT_STACK}`;
    ctx.fillStyle = '#9fc5ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Christian Blevens', cx, cy + r + 60);

    drawCardBorder(ctx);
    ctx.restore();

    _backCanvas = canvas;
    return canvas;
}

// Helpers used by Card to size the textured planes precisely (the video plane
// covers only the top region; the text plane covers the full card to keep
// rounded-corner border continuity, with a transparent top half).
export const TOP_REGION_FRACTION = TOP_REGION_HEIGHT / CARD_PX_H;
