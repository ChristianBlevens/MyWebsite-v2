export const RESUME_PDF_URL = '/assets/resume/resume.pdf';

const WORKER_SRC =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export async function renderPdfInto(container) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) {
        container.innerHTML = '<p>PDF viewer unavailable. Please reload the page.</p>';
        return;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;

    container.innerHTML = '<em>Loading…</em>';
    try {
        const pdf = await pdfjsLib.getDocument(RESUME_PDF_URL).promise;
        container.innerHTML = '';
        for (let num = 1; num <= pdf.numPages; num++) {
            const page = await pdf.getPage(num);
            const containerWidth = container.clientWidth || 700;
            const unscaled = page.getViewport({ scale: 1 });
            const dpr = window.devicePixelRatio || 1;
            const viewport = page.getViewport({ scale: (containerWidth / unscaled.width) * dpr });

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = containerWidth + 'px';
            canvas.style.height = Math.round(unscaled.height * containerWidth / unscaled.width) + 'px';
            canvas.style.display = 'block';

            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            container.appendChild(canvas);
        }
    } catch (err) {
        container.innerHTML = '<p>Could not load resume. Please try again later.</p>';
        console.error('pdf load failed:', err);
    }
}
