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

    // Grid fallback toggle
    const gridView = document.getElementById('grid-view');
    const gridContent = document.getElementById('grid-content');
    const gridBtn = document.getElementById('btn-grid-toggle');
    const gridCloseBtn = document.getElementById('btn-grid-close');

    function openGrid() {
        gridContent.innerHTML = cards.map(c => `
            <div class="grid-card" data-id="${c.project.id}">
                ${c.project.thumbnail ? `<img src="${c.project.thumbnail}" alt="">` : ''}
                <div class="pad">
                    <h3>${escapeHtml(c.project.title)}</h3>
                    <p style="color:rgba(231,231,234,0.7); margin-top:0.4rem; font-size:0.88rem;">${escapeHtml(c.project.summary)}</p>
                </div>
            </div>
        `).join('');
        gridView.hidden = false;
    }

    function closeGrid() {
        gridView.hidden = true;
    }

    gridBtn.addEventListener('click', openGrid);
    gridCloseBtn.addEventListener('click', closeGrid);

    // Help — reopens the intro modal. Intro doubles as the help / orientation
    // content since dismissing it teaches the click-anywhere-off gesture.
    document.getElementById('btn-help').addEventListener('click', openIntroModal);

    // Keyboard shortcuts
    window.addEventListener('keydown', (ev) => {
        if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
        if (ev.key === 'Escape') cameraController.unfocus();
        if (ev.key === ' ' || ev.key === 's') runShuffle();
    });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
