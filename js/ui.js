import { projects, filters } from './data.js';
import { openIntroModal } from './sections/intro.js';

// Mutable refs — null until 3D is initialised. All closures below read these
// at call time so upgradeToCardRefs() takes effect immediately.
let _cards = null;
let _cameraController = null;
let _iframeOverlay = null;
let _onCardViewRequest = null;

// Called after lazy init3d() resolves to wire up the 3D-dependent behaviours
// without re-running the full setupUi().
export function upgradeToCardRefs({ cards, cameraController, iframeOverlay }) {
    _cards = cards;
    _cameraController = cameraController;
    _iframeOverlay = iframeOverlay;
}

export function setupUi({
    cards = null,
    cameraController = null,
    iframeOverlay = null,
    onCardViewRequest = null,
    startInGrid = false,
} = {}) {
    _cards = cards;
    _cameraController = cameraController;
    _iframeOverlay = iframeOverlay;
    _onCardViewRequest = onCardViewRequest;

    // ── Filter bar ────────────────────────────────────────────────────────────
    const filterBar = document.getElementById('filter-bar');
    const gridContent = document.getElementById('grid-content');
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
        // Mirror onto 3D cards when available
        if (_cards) {
            for (const card of _cards) {
                const match = id === 'all' || (card.project.tags || []).includes(id);
                card.setFilteredOut(!match);
            }
        }
        // Always mirror onto grid items (rendered from projects data)
        for (const el of gridContent.querySelectorAll('.grid-card')) {
            const cardId = el.dataset.id;
            const proj = _cards
                ? _cards.find(c => c.project.id === cardId)?.project
                : projects.find(p => p.id === cardId);
            const match = !proj || id === 'all' || (proj.tags || []).includes(id);
            el.classList.toggle('filtered-out', !match);
        }
    }

    // ── Search ────────────────────────────────────────────────────────────────
    const search = document.getElementById('search');
    search.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            const q = search.value.trim().toLowerCase();
            if (!q || !_cameraController || !_cards) return;
            const hit = _cards.find(c =>
                c.project.title.toLowerCase().includes(q) ||
                (c.project.tags || []).some(t => t.toLowerCase().includes(q))
            );
            if (hit) _cameraController.focusOn(hit);
        } else if (ev.key === 'Escape') {
            search.value = '';
            if (_cameraController) _cameraController.unfocus();
        }
    });

    // ── Shuffle ───────────────────────────────────────────────────────────────
    let shuffleInProgress = false;
    const SHUFFLE_SETTLE_MS = 1500;
    function runShuffle() {
        if (shuffleInProgress || !_cards) return;
        shuffleInProgress = true;
        _iframeOverlay?.enterShuffleMode();
        const pulses = 5;
        let i = 0;
        const fire = () => {
            for (const c of _cards) c.applyShuffleImpulse(0.85);
            if (++i < pulses) {
                setTimeout(fire, 200);
            } else {
                setTimeout(() => {
                    _iframeOverlay?.exitShuffleMode();
                    shuffleInProgress = false;
                }, SHUFFLE_SETTLE_MS);
            }
        };
        fire();
    }
    document.getElementById('btn-shuffle').addEventListener('click', runShuffle);

    // ── Reset camera ──────────────────────────────────────────────────────────
    document.getElementById('btn-reset-camera').addEventListener('click', () => {
        if (_cameraController) _cameraController.unfocus();
    });

    // ── Grid view ─────────────────────────────────────────────────────────────
    const gridView = document.getElementById('grid-view');
    const gridBtn = document.getElementById('btn-grid-toggle');
    const cardViewBtn = document.getElementById('btn-card-view');

    // Keep #grid-view top padding synced to the search/filter row height so
    // wrapped filter buttons never float over the top grid cards.
    const uiTop = document.querySelector('.ui-top');
    const syncGridTop = () => {
        const bottom = uiTop.getBoundingClientRect().bottom;
        gridView.style.paddingTop = (bottom + 16) + 'px';
    };
    new ResizeObserver(syncGridTop).observe(uiTop);
    window.addEventListener('resize', syncGridTop);
    syncGridTop();

    function openGrid() {
        const md = window.markdownit ? window.markdownit({ html: false, linkify: true }) : null;
        gridContent.innerHTML = projects.map(p => {
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
        // Pause 3D card video decoders while grid is active (skipped when 3D
        // isn't loaded yet — no Card objects to pause).
        if (_cards) {
            for (const c of _cards) c.frontVideo?.pause();
        }
        applyFilter(activeFilter);
    }

    function closeGrid() {
        gridView.hidden = true;
        document.body.classList.remove('grid-mode');
        if (_cards) {
            for (const c of _cards) {
                if (c.representation === 'textured') {
                    c.frontVideo?.play().catch(() => {});
                }
            }
        }
    }

    gridBtn.addEventListener('click', openGrid);

    cardViewBtn.addEventListener('click', async () => {
        if (_onCardViewRequest) {
            // Lazy-init the 3D scene on first "Card View" press.
            cardViewBtn.disabled = true;
            cardViewBtn.textContent = 'Loading…';
            await _onCardViewRequest();
            _onCardViewRequest = null;
            cardViewBtn.disabled = false;
            cardViewBtn.textContent = 'Card View';
            closeGrid();
            openIntroModal();
        } else {
            closeGrid();
        }
    });

    // ── Help ──────────────────────────────────────────────────────────────────
    document.getElementById('btn-help').addEventListener('click', openIntroModal);

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    window.addEventListener('keydown', (ev) => {
        if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
        if (ev.key === 'Escape' && _cameraController) _cameraController.unfocus();
        if ((ev.key === ' ' || ev.key === 's') && _cards) runShuffle();
    });

    if (startInGrid) openGrid();
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function gridThumbMarkup(url) {
    if (!url) return '';
    if (/\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)) {
        return `<video src="${escapeHtml(url)}" muted loop autoplay playsinline preload="metadata"></video>`;
    }
    return `<img src="${escapeHtml(url)}" alt="">`;
}
