(function () {
    function toggleSidebar(forceOpen) {
        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !document.querySelector('.sidebar.active');

        document.querySelectorAll('.sidebar').forEach((sidebar) => {
            sidebar.classList.toggle('active', shouldOpen);
        });

        document.querySelectorAll('.sidebar-overlay').forEach((overlay) => {
            overlay.classList.toggle('active', shouldOpen);
        });
    }

    window.toggleSidebar = toggleSidebar;

    document.addEventListener('click', (event) => {
        const sidebarLink = event.target.closest('.sidebar-menu a');
        if (sidebarLink && window.innerWidth < 992) {
            toggleSidebar(false);
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 992) {
            toggleSidebar(false);
        }
    });

    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
    }
})();
