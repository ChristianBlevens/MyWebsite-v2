const RESUME_MD_URL = '/assets/resume/resume.md';

export async function showResumePage() {
    document.body.classList.add('resume-page');

    // Hide 3D stage, UI overlay, nav — none of them init in resume mode
    for (const id of ['stage', 'ui-overlay', 'top-nav', 'grid-view']) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
    }

    const page = document.createElement('div');
    page.id = 'resume-page';
    page.innerHTML = `
        <div id="resume-page-header">
            <span id="resume-page-title">Christian Blevens &mdash; Resume</span>
            <button id="resume-pdf-btn" type="button">Download PDF</button>
        </div>
        <div id="resume-page-body">
            <div id="resume-page-rendered" class="resume-rendered"><em>Loading&hellip;</em></div>
        </div>
        <a id="resume-portfolio-btn" href="/#grid">View Portfolio</a>
    `;
    document.body.appendChild(page);

    const rendered = page.querySelector('#resume-page-rendered');

    try {
        const r = await fetch(RESUME_MD_URL, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        const text = await r.text();
        const md = window.markdownit ? window.markdownit({ html: false, linkify: true }) : null;
        rendered.innerHTML = md ? md.render(text) : `<pre>${text}</pre>`;
    } catch (err) {
        rendered.innerHTML = '<p>Could not load resume. Please try again later.</p>';
        console.error('resume load failed:', err);
    }

    page.querySelector('#resume-pdf-btn').addEventListener('click', () => {
        window.print();
    });

    // href="/#grid" only changes the hash — same path means no page reload, so
    // the resume-mode page would stay visible. Force a full reload at /#grid.
    page.querySelector('#resume-portfolio-btn').addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = '/#grid';
        window.location.reload();
    });
}
