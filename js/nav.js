import * as Modal from './modal.js';
import { openIntroModal } from './sections/intro.js';
import { buildContactContent } from './sections/contact.js';
import { buildCommentsContent } from './sections/comments.js';
import { buildResumeContent } from './sections/resume.js';

// Each entry maps a nav button to a content factory. "Me" reuses the intro
// modal directly (intro doubles as the about page; the dismiss-as-tutorial
// hint and controls cheat sheet stay attached when reopened from the nav).
const ENTRIES = [
    { id: 'me',       label: 'Me',       open: () => openIntroModal() },
    { id: 'contact',  label: 'Contact',  open: () => Modal.open({ id: 'contact',  contentEl: buildContactContent() }) },
    { id: 'comments', label: 'Comments', open: () => Modal.open({ id: 'comments', contentEl: buildCommentsContent() }) },
    { id: 'resume',   label: 'Resume',   open: () => Modal.open({ id: 'resume',   contentEl: buildResumeContent(), wide: true }) },
];

export function setupNav() {
    const nav = document.getElementById('top-nav');
    for (const entry of ENTRIES) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.dataset.section = entry.id;
        btn.textContent = entry.label;
        btn.addEventListener('click', entry.open);
        nav.appendChild(btn);
    }
}
