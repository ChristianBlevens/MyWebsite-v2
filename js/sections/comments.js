// Drop-in self-hosted comments embed (christianblevens.me/comments).
// The embed script self-iframes; we just inject the <script> tag once per
// modal open. Each open creates a fresh container so the widget reinitializes.
const EMBED_SRC = 'https://christianblevens.me/comments/embed.js';
const INSTANCE = 'https://christianblevens.me/comments';
// Page-thread identifier — required by the embed script (errors out if missing).
// Matches v1 so comments persist across the migration.
const PAGE_ID = 'ChristianBlevens';

export function buildCommentsContent() {
    const root = document.createElement('div');
    root.className = 'section-content comments-content';
    root.innerHTML = `
        <h1>Comments</h1>
        <p class="section-lead">Leave a note, ask a question, or just say hi.</p>
        <div class="comments-host"></div>
    `;

    const host = root.querySelector('.comments-host');
    const script = document.createElement('script');
    script.src = EMBED_SRC;
    script.setAttribute('data-instance', INSTANCE);
    script.setAttribute('data-page-id', PAGE_ID);
    script.async = true;
    host.appendChild(script);

    return root;
}
