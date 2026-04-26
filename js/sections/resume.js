// Resume embed — same Google Doc as v1. Phase 5 will replace with a final
// version; for now the live doc is the source of truth and edits propagate.
const RESUME_DOC_ID = '1purg7IyVGjn9Mu3oNINaXV6l9QY-MBYi_blIqYnCzNM';
const RESUME_BASE = `https://docs.google.com/document/d/${RESUME_DOC_ID}`;

export function buildResumeContent() {
    const root = document.createElement('div');
    root.className = 'section-content resume-content';
    root.innerHTML = `
        <div class="resume-header">
            <h1>Resume</h1>
            <a class="resume-download"
               href="${RESUME_BASE}/export?format=pdf"
               target="_blank" rel="noopener"
               download>Download PDF</a>
        </div>
        <div class="resume-frame-wrap">
            <iframe class="resume-frame"
                    src="${RESUME_BASE}/preview"
                    loading="lazy"
                    referrerpolicy="no-referrer"></iframe>
        </div>
    `;
    return root;
}
