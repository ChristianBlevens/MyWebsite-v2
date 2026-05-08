const hash = window.location.hash.slice(1);
const isMobile = window.matchMedia('(pointer: coarse)').matches;

if (hash === 'resume') {
    const { showResumePage } = await import('./resume-page.js');
    await showResumePage();
} else {
    const [{ setupUi, upgradeToCardRefs }, { setupNav }] = await Promise.all([
        import('./ui.js'),
        import('./nav.js'),
    ]);

    setupNav();

    // Grid mode when: explicitly requested via hash, or on mobile without an
    // explicit #cards override. Desktop with no hash gets card view immediately.
    const forceGrid = hash === 'grid' || (isMobile && hash !== 'cards');

    if (forceGrid) {
        setupUi({
            startInGrid: true,
            onCardViewRequest: async () => {
                const { init3d } = await import('./init3d.js');
                const refs = await init3d();
                upgradeToCardRefs(refs);
            },
        });
    } else {
        const { init3d } = await import('./init3d.js');
        const refs = await init3d();
        setupUi(refs);
        const { openIntroModal } = await import('./sections/intro.js');
        openIntroModal();
    }
}
