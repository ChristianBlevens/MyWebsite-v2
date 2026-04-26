import * as Modal from '../modal.js';

const HEADSHOT_URL = '/assets/intro/z7NBCHn.jpeg';
const BANNER_VIDEO_URL = '/assets/intro/IAGSnvD.mp4';

const BIO = `I build intelligent systems across web, AI, and game development.
From AI-powered video editors and face anonymization pipelines to
data-oriented game architectures and real-time multiplayer systems,
I specialize in solving complex technical challenges with elegant,
performant solutions.`;

export function buildIntroContent() {
    const root = document.createElement('div');
    root.className = 'intro-content';
    root.innerHTML = `
        <video class="intro-bg" autoplay muted loop playsinline>
            <source src="${BANNER_VIDEO_URL}" type="video/mp4">
        </video>
        <div class="intro-scrim"></div>
        <div class="intro-body">
            <img class="intro-headshot" src="${HEADSHOT_URL}" alt="Christian Blevens">
            <div class="intro-text">
                <h1>Christian Blevens</h1>
                <p>${BIO}</p>
            </div>
        </div>
    `;
    return root;
}

// Card interaction reference. Lives below the dismiss button so users learn
// every gesture before touching the table, and can come back via the ? button.
const CONTROLS = [
    { gesture: 'Click',                   action: 'Focus a card'           },
    { gesture: 'Double-click',            action: 'Flip a card'            },
    { gesture: 'Click and hold + drag',   action: 'Move a card'            },
    { gesture: 'Top-right toggle',        action: 'Expand into live demo'  },
    { gesture: 'Click off / ESC',         action: 'Unfocus / dismiss'      },
    { gesture: 'Search',                  action: 'Auto-focus a project'   },
    { gesture: 'Shuffle',                 action: 'Scatter all cards'      },
    { gesture: 'Grid View',               action: 'Flat fallback layout'   },
    { gesture: '?',                       action: 'Reopen this'            },
];

function buildIntroHint() {
    const wrap = document.createElement('div');
    wrap.className = 'intro-hint-wrap';

    const cheat = document.createElement('div');
    cheat.className = 'controls-cheat';
    cheat.innerHTML = `
        <h2>Controls</h2>
        <dl>
            ${CONTROLS.map(c => `
                <div class="cheat-row">
                    <dt>${c.gesture}</dt>
                    <dd>${c.action}</dd>
                </div>
            `).join('')}
        </dl>
    `;
    wrap.appendChild(cheat);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'modal-hint';
    dismiss.textContent = 'Click anywhere to dismiss';
    dismiss.addEventListener('click', () => Modal.close());
    wrap.appendChild(dismiss);

    return wrap;
}

export function openIntroModal() {
    Modal.open({
        id: 'intro',
        contentEl: buildIntroContent(),
        hintEl: buildIntroHint(),
    });
}
