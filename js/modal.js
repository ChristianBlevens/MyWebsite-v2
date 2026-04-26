// Modal shell. One modal open at a time. Open/close drive a small set of
// hooks so other systems (camera, iframe overlay) can react without coupling
// directly to nav or section code.

const onOpenHooks = [];
const onCloseHooks = [];
let root = null;
let backdrop = null;
let panel = null;
let hintSlot = null;
let currentId = null;

function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'modal-root';
    root.hidden = true;

    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', () => close());

    // Stack column: panel sits centered, optional hint below it. Both wrapped
    // so that backdrop fills the area outside this column.
    const stack = document.createElement('div');
    stack.className = 'modal-stack';

    panel = document.createElement('div');
    panel.className = 'modal-panel';
    // Stop propagation so backdrop click doesn't fire when the panel itself
    // is clicked. The dismiss-as-tutorial intro uses backdrop click as the
    // gesture lesson — clicks inside the panel must NOT count as dismissal.
    panel.addEventListener('click', (e) => e.stopPropagation());

    hintSlot = document.createElement('div');
    hintSlot.className = 'modal-hint-slot';
    hintSlot.hidden = true;

    stack.appendChild(panel);
    stack.appendChild(hintSlot);
    root.appendChild(backdrop);
    root.appendChild(stack);
    document.body.appendChild(root);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && currentId) close();
    });
}

export function open({ id, contentEl, hintEl = null, wide = false }) {
    ensureRoot();
    panel.classList.toggle('modal-panel--wide', wide);
    panel.replaceChildren(contentEl);
    if (hintEl) {
        hintSlot.replaceChildren(hintEl);
        hintSlot.hidden = false;
    } else {
        hintSlot.replaceChildren();
        hintSlot.hidden = true;
    }
    if (currentId) {
        // Swap content; do not stack. onOpen hooks already fired for the
        // previous modal — no need to re-fire (modal-active state is unchanged).
        currentId = id;
        return;
    }
    root.hidden = false;
    currentId = id;
    for (const h of onOpenHooks) h(id);
}

export function close() {
    if (!currentId) return;
    const closingId = currentId;
    currentId = null;
    root.hidden = true;
    panel.replaceChildren();
    hintSlot.replaceChildren();
    hintSlot.hidden = true;
    for (const h of onCloseHooks) h(closingId);
}

export function isOpen() {
    return currentId !== null;
}

export function onOpen(fn) { onOpenHooks.push(fn); }
export function onClose(fn) { onCloseHooks.push(fn); }
