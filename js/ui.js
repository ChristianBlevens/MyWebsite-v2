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

    function openGrid() {
        gridContent.innerHTML = cards.map(c => `
            <div class="grid-card" data-id="${c.project.id}">
                ${gridThumbMarkup(c.project.thumbnail)}
                <div class="pad">
                    <h3>${escapeHtml(c.project.title)}</h3>
                    <p style="color:rgba(231,231,234,0.7); margin-top:0.4rem; font-size:0.88rem;">${escapeHtml(c.project.summary)}</p>
                </div>
            </div>
        `).join('');
        gridView.hidden = false;
        document.body.classList.add('grid-mode');
        // Re-apply current filter so grid items match 3D-table state.
        applyFilter(activeFilter);
    }

    function closeGrid() {
        gridView.hidden = true;
        document.body.classList.remove('grid-mode');
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
