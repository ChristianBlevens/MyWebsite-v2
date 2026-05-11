import { RESUME_PDF_URL, renderPdfInto } from '../pdf-utils.js';

export function buildResumeContent() {
    const root = document.createElement('div');
    root.className = 'section-content resume-content';
    root.innerHTML = `
        <div class="resume-header">
            <h1>Resume</h1>
            <a class="resume-download" href="${RESUME_PDF_URL}" download>Download PDF</a>
        </div>
        <div class="resume-pdf-container"></div>
    `;

    renderPdfInto(root.querySelector('.resume-pdf-container'));
    return root;
}
