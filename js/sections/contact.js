// EmailJS config copied from v1 (christianblevens.me/MyWebsite). Will move to
// the same self-hosted infra as the rest of the site in Phase 4.
const EMAILJS = {
    publicKey: '8KsxmH3Rj7JplezyY',
    serviceId: 'service_ml0hcx1',
    templateId: 'template_kpvuafn',
    toEmail: 'christianblevensroot@gmail.com',
};

let initialized = false;
function ensureInit() {
    if (initialized) return;
    if (!window.emailjs) return;
    window.emailjs.init(EMAILJS.publicKey);
    initialized = true;
}

export function buildContactContent() {
    const root = document.createElement('div');
    root.className = 'section-content contact-content';
    root.innerHTML = `
        <h1>Get In Touch</h1>
        <p class="section-lead">Interested in working together or have questions about my projects? Send a message.</p>
        <form class="contact-form" novalidate>
            <input class="form-input" type="text" name="name" placeholder="Your Name" required>
            <input class="form-input" type="email" name="email" placeholder="Your Email" required>
            <textarea class="form-input" name="message" placeholder="Your Message" rows="5" required></textarea>
            <button class="form-submit" type="submit">Send Message</button>
            <div class="form-status" hidden></div>
        </form>
    `;

    const form = root.querySelector('.contact-form');
    const submit = root.querySelector('.form-submit');
    const status = root.querySelector('.form-status');

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        ensureInit();
        if (!initialized) {
            showStatus(status, 'Email service unavailable. Please try again.', 'error');
            return;
        }
        const data = new FormData(form);
        const name = (data.get('name') || '').toString().trim();
        const email = (data.get('email') || '').toString().trim();
        const message = (data.get('message') || '').toString().trim();
        if (!name || !email || !message) {
            showStatus(status, 'Please fill in all fields.', 'error');
            return;
        }
        submit.disabled = true;
        submit.textContent = 'Sending...';
        try {
            await window.emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, {
                from_name: name,
                reply_to: email,
                message,
                to_email: EMAILJS.toEmail,
            });
            form.reset();
            showStatus(status, 'Your message has been sent successfully.', 'ok');
        } catch (err) {
            showStatus(status, err?.message || 'Submission failed. Please try again.', 'error');
        } finally {
            submit.disabled = false;
            submit.textContent = 'Send Message';
        }
    });

    return root;
}

function showStatus(el, text, kind) {
    el.textContent = text;
    el.dataset.kind = kind;
    el.hidden = false;
}
