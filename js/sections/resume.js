// Resume section — single source of truth is /assets/resume/resume.md.
// On-screen view: render the markdown via the globally-loaded markdown-it.
// Download PDF: invoke window.print(); a print stylesheet hides everything
// except a top-level #print-root holding a clone of the rendered resume, and
// the user picks "Save as PDF" in the browser's print dialog.

const RESUME_MD_URL = '/assets/resume/resume.md';

let _printRoot = null;
let _printCleanupAttached = false;

function ensurePrintRoot() {
    if (_printRoot) return _printRoot;
    _printRoot = document.createElement('div');
    _printRoot.id = 'print-root';
    document.body.appendChild(_printRoot);
    return _printRoot;
}

function attachPrintCleanup() {
    if (_printCleanupAttached) return;
    _printCleanupAttached = true;
    window.addEventListener('afterprint', () => {
        document.body.classList.remove('printing-resume');
        if (_printRoot) _printRoot.innerHTML = '';
    });
}

function downloadAsPdf(renderedEl) {
    const root = ensurePrintRoot();
    root.innerHTML = '';
    root.appendChild(renderedEl.cloneNode(true));
    attachPrintCleanup();
    document.body.classList.add('printing-resume');
    window.print();
}

export function buildResumeContent() {
    const root = document.createElement('div');
    root.className = 'section-content resume-content';
    root.innerHTML = `
        <div class="resume-header">
            <h1>Resume</h1>
            <button type="button" class="resume-download">Download PDF</button>
        </div>
        <div class="resume-rendered"><em>Loading…</em></div>
    `;

    const rendered = root.querySelector('.resume-rendered');
    const button = root.querySelector('.resume-download');

    fetch(RESUME_MD_URL, { cache: 'no-cache' })
        .then(r => {
            if (!r.ok) throw new Error(`resume fetch ${r.status}`);
            return r.text();
        })
        .then(text => {
            const md = window.markdownit
                ? window.markdownit({ html: false, linkify: true })
                : null;
            rendered.innerHTML = md ? md.render(text) : `<pre>${text}</pre>`;
        })
        .catch(err => {
            rendered.innerHTML =
                '<p>Could not load resume. Please try again later.</p>';
            console.error('resume load failed:', err);
        });

    button.addEventListener('click', () => downloadAsPdf(rendered));

    return root;
}
