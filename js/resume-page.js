import { RESUME_PDF_URL, renderPdfInto } from './pdf-utils.js';

export async function showResumePage() {
    document.body.classList.add('resume-page');

    for (const id of ['stage', 'ui-overlay', 'top-nav', 'grid-view']) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
    }

    const page = document.createElement('div');
    page.id = 'resume-page';
    page.innerHTML = `
        <div id="resume-page-header">
            <span id="resume-page-title">Christian Blevens &mdash; Resume</span>
            <a id="resume-pdf-btn" href="${RESUME_PDF_URL}" download>Download PDF</a>
        </div>
        <div id="resume-page-body">
            <div id="resume-page-rendered"></div>
        </div>
        <a id="resume-portfolio-btn" href="/#grid">View Portfolio</a>
    `;
    document.body.appendChild(page);

    renderPdfInto(page.querySelector('#resume-page-rendered'));

    page.querySelector('#resume-portfolio-btn').addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = '/#grid';
        window.location.reload();
    });
}
