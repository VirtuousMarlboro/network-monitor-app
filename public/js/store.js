document.addEventListener('alpine:init', () => {
    Alpine.store('app', {
        // State
        hosts: [],
        loading: true,
        lastUpdated: null,

        stats: {
            total: 0,
            online: 0,
            offline: 0,
            avgLatency: '-'
        },

        theme: localStorage.getItem('theme') || 'light',
        currentUser: null,

        // Initialization
        init() {
            this.applyTheme();
            console.log('Alpine Store Initialized');
        },

        // Theme Actions
        toggleTheme() {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            localStorage.setItem('theme', this.theme);
            this.applyTheme();
        },

        applyTheme() {
            if (this.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
            // Update legacy icon if needed (will eventually be reactive)
            if (window.updateThemeIcon) window.updateThemeIcon();
        },

        // Host Actions
        setHosts(hostsData) {
            this.hosts = hostsData;
            this.loading = false;
            this.lastUpdated = new Date();
            this.updateStats();
        },

        updateStats() {
            this.stats.total = this.hosts.length;
            this.stats.online = this.hosts.filter(h => h.status === 'online').length;
            this.stats.offline = this.hosts.filter(h => h.status === 'offline').length;

            // Calculate Average Latency
            const latencies = this.hosts
                .filter(h => h.latency !== null && h.latency !== undefined && h.status === 'online')
                .map(h => parseFloat(h.latency));

            if (latencies.length > 0) {
                const sum = latencies.reduce((a, b) => a + b, 0);
                this.stats.avgLatency = (sum / latencies.length).toFixed(0) + ' ms';
            } else {
                this.stats.avgLatency = '-';
            }
        }
    });
});
