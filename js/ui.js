import { filters } from './data.js';
import { openIntroModal } from './sections/intro.js';

export function setupUi({ cards, cameraController, iframeOverlay }) {
    // Filter bar
    const filterBar = document.getElementById('filter-bar');
    let activeFilter = 'all';

    for (const opt of filters) {
        const btn = document.createElement('button');
        btn.className = 'filter-btn' + (opt.id === activeFilter ? ' active' : '');
        btn.textContent = opt.label;
        btn.dataset.filter = opt.id;
        btn.addEventListener('click', () => {
            activeFilter = opt.id;
            for (const b of filterBar.querySelectorAll('.filter-btn')) {
                b.classList.toggle('active', b.dataset.filter === activeFilter);
            }
            applyFilter(activeFilter);
        });
        filterBar.appendChild(btn);
    }

    function applyFilter(id) {
        for (const card of cards) {
            const match = id === 'all' || (card.project.tags || []).includes(id);
            card.setFilteredOut(!match);
        }
        // Mirror filter state onto grid items so the grid view stays consistent
        // with the 3D table when the user switches between them.
        for (const el of gridContent.querySelectorAll('.grid-card')) {
            const cardId = el.dataset.id;
            const card = cards.find(c => c.project.id === cardId);
            const match = !card || id === 'all' || (card.project.tags || []).includes(id);
            el.classList.toggle('filtered-out', !match);
        }
    }

    // Search — only triggers on Enter so typing doesn't yank the camera around
    const search = document.getElementById('search');
    search.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            const q = search.value.trim().toLowerCase();
            if (!q) return;
            const hit = cards.find(c =>
                c.project.title.toLowerCase().includes(q) ||
                (c.project.tags || []).some(t => t.toLowerCase().includes(q))
            );
            if (hit) cameraController.focusOn(hit);
        } else if (ev.key === 'Escape') {
            search.value = '';
            cameraController.unfocus();
        }
    });

    // Shuffle — 5 random impulses spaced over 1 second for sustained chaos.
    // While shuffling, expanded iframes reparent into their CSS3D card so they
    // tumble with the card naturally (state loss / black flash masked by the
    // motion). After settle, they reattach to #iframe-stage.
    let shuffleInProgress = false;
    const SHUFFLE_SETTLE_MS = 1500;
    function runShuffle() {
        if (shuffleInProgress) return;
        shuffleInProgress = true;
        iframeOverlay?.enterShuffleMode();
        const pulses = 5;
        let i = 0;
        const fire = () => {
            for (const c of cards) c.applyShuffleImpulse(0.85);
            if (++i < pulses) {
                setTimeout(fire, 200);
            } else {
                setTimeout(() => {
                    iframeOverlay?.exitShuffleMode();
                    shuffleInProgress = false;
                }, SHUFFLE_SETTLE_MS);
            }
        };
        fire();
    }
    document.getElementById('btn-shuffle').addEventListener('click', runShuffle);

    // Reset camera
    document.getElementById('btn-reset-camera').addEventListener('click', () => {
        cameraController.unfocus();
    });

    // Grid view toggle. Grid mode keeps the top nav, search/filter row, and
    // the bottom action row visible — only #btn-card-view is shown in the
    // bottom row (CSS-driven via body.grid-mode), with shuffle/reset/grid-toggle
    // hidden because they don't apply to grid view.
    const gridView = document.getElementById('grid-view');
    const gridContent = document.getElementById('grid-content');
    const gridBtn = document.getElementById('btn-grid-toggle');
    const cardViewBtn = document.getElementById('btn-card-view');

    // Keep #grid-view's top padding synced to the bottom of the search/filter
    // row. When the viewport narrows, #filter-bar wraps onto more rows and
    // .ui-top grows taller — without this, those wrapped rows would float
    // over the top grid cards' titles. ResizeObserver catches reflow caused
    // by viewport-width changes (where the resize event also fires) AND any
    // future content changes that grow the row.
    const uiTop = document.querySelector('.ui-top');
    const syncGridTop = () => {
        const bottom = uiTop.getBoundingClientRect().bottom;
        gridView.style.paddingTop = (bottom + 16) + 'px';
    };
    new ResizeObserver(syncGridTop).observe(uiTop);
    window.addEventListener('resize', syncGridTop);
    syncGridTop();

    function openGrid() {
        // markdown-it is loaded globally via CDN tag in index.html (used by
        // card.js back-face). html:false sanitizes inline HTML in source —
        // markdown-it itself produces safe HTML, but be defensive against
        // tags in author-written description strings.
        const md = window.markdownit ? window.markdownit({ html: false, linkify: true }) : null;
        gridContent.innerHTML = cards.map(c => {
            const p = c.project;
            const descHtml = md && p.description ? md.render(p.description) : '';
            const tags = (p.tags || []).map(t =>
                `<span class="grid-tag">${escapeHtml(t)}</span>`).join('');
            const links = [
                p.liveUrl ? `<a class="grid-link grid-link-live" href="${escapeHtml(p.liveUrl)}" target="_blank" rel="noopener">Open Live</a>` : '',
                p.github  ? `<a class="grid-link grid-link-github" href="${escapeHtml(p.github)}" target="_blank" rel="noopener">GitHub</a>` : '',
            ].join('');
            return `
                <div class="grid-card" data-id="${p.id}">
                    ${gridThumbMarkup(p.thumbnail)}
                    <div class="pad">
                        <h3>${escapeHtml(p.title)}</h3>
                        <p class="grid-summary">${escapeHtml(p.summary)}</p>
                        ${descHtml ? `<div class="grid-description">${descHtml}</div>` : ''}
                        ${tags ? `<div class="grid-tags">${tags}</div>` : ''}
                        ${links ? `<div class="grid-links">${links}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        gridView.hidden = false;
        document.body.classList.add('grid-mode');
        // Stop the 3D-card video elements while grid mode is active. The
        // animate loop is also bailing early (main.js), so VideoTextures
        // wouldn't be uploaded anyway, but the HTMLVideoElement itself keeps
        // decoding silently — pausing kills that decoder cost too. Grid-card
        // <video> elements (a separate set of DOM nodes inside #grid-content)
        // keep playing as the user expects.
        for (const c of cards) c.frontVideo?.pause();
        // Re-apply current filter so grid items match 3D-table state.
        applyFilter(activeFilter);
    }

    function closeGrid() {
        gridView.hidden = true;
        document.body.classList.remove('grid-mode');
        // Resume any 3D-card videos whose card is currently in textured
        // representation (the css3d representation pauses its own video via
        // _setRepresentation; don't fight that here).
        for (const c of cards) {
            if (c.representation === 'textured') {
                c.frontVideo?.play().catch(() => {});
            }
        }
    }

    gridBtn.addEventListener('click', openGrid);
    cardViewBtn.addEventListener('click', closeGrid);

    // Help — reopens the intro modal. Intro doubles as the help / orientation
    // content since dismissing it teaches the click-anywhere-off gesture.
    document.getElementById('btn-help').addEventListener('click', openIntroModal);

    // Keyboard shortcuts
    window.addEventListener('keydown', (ev) => {
        if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
        if (ev.key === 'Escape') cameraController.unfocus();
        if (ev.key === ' ' || ev.key === 's') runShuffle();
    });

    // Mobile / coarse-pointer default: open grid view immediately. The 3D card
    // table is GPU- and bandwidth-heavy on mobile; grid view is the right
    // default surface there. The user can still switch via the bottom-row
    // "Card View" / "Grid View" buttons.
    if (window.matchMedia('(pointer: coarse)').matches) {
        openGrid();
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Animated thumbnails are MP4 (imgur auto-transcoded). Use <video> for video
// URLs, <img> otherwise. Empty when no thumbnail.
function gridThumbMarkup(url) {
    if (!url) return '';
    if (/\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)) {
        return `<video src="${escapeHtml(url)}" muted loop autoplay playsinline preload="metadata"></video>`;
    }
    return `<img src="${escapeHtml(url)}" alt="">`;
}
