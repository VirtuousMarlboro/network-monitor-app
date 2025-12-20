/**
 * Stats Dashboard Component
 * Alpine.js component for reactive statistics display
 * Binds to $store.app for real-time updates
 */
document.addEventListener('alpine:init', () => {
    Alpine.data('statsDashboard', () => ({
        // Computed from store
        get total() {
            return Alpine.store('app').stats.total;
        },
        get online() {
            return Alpine.store('app').stats.online;
        },
        get offline() {
            return Alpine.store('app').stats.offline;
        },
        get avgLatency() {
            return Alpine.store('app').stats.avgLatency;
        },
        get loading() {
            return Alpine.store('app').loading;
        },

        // Percentage calculations
        get onlinePercent() {
            if (this.total === 0) return 0;
            return Math.round((this.online / this.total) * 100);
        },
        get offlinePercent() {
            if (this.total === 0) return 0;
            return Math.round((this.offline / this.total) * 100);
        },

        // Status classes
        getStatusClass(type) {
            if (type === 'online') {
                return this.online > 0 ? 'stat-card-success' : '';
            } else if (type === 'offline') {
                return this.offline > 0 ? 'stat-card-danger' : '';
            }
            return '';
        },

        // Format number with animation placeholder
        formatNum(num) {
            return num.toLocaleString();
        }
    }));
});
