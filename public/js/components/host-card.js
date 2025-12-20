/**
 * Host Card Component
 * Alpine.js component for individual host card display
 * Provides reactive status, latency, and action handling
 */
document.addEventListener('alpine:init', () => {
    Alpine.data('hostCard', (hostData) => ({
        host: hostData,
        showActions: false,

        // Computed properties
        get statusClass() {
            const status = this.host.status;
            if (status === 'online') return 'status-online';
            if (status === 'offline') return 'status-offline';
            return 'status-unknown';
        },
        get statusText() {
            const status = this.host.status;
            if (status === 'online') return 'Online';
            if (status === 'offline') return 'Offline';
            return 'Unknown';
        },
        get latencyDisplay() {
            if (this.host.latency === null || this.host.latency === undefined) return '-';
            return `${this.host.latency} ms`;
        },
        get lastCheckFormatted() {
            if (!this.host.lastCheck) return 'Never';
            return new Date(this.host.lastCheck).toLocaleString();
        },
        get hasLocation() {
            return this.host.latitude && this.host.longitude;
        },
        get hasSnmp() {
            return this.host.snmpEnabled && this.host.traffic;
        },
        get trafficIn() {
            if (!this.host.traffic) return '-';
            const val = this.host.traffic.traffic_in;
            return val ? `${val.toFixed(2)} Mbps` : '-';
        },
        get trafficOut() {
            if (!this.host.traffic) return '-';
            const val = this.host.traffic.traffic_out;
            return val ? `${val.toFixed(2)} Mbps` : '-';
        },

        // Actions - These call global functions in app.js for now
        // Will be refactored to use Alpine events later
        pingHost() {
            if (typeof window.pingHost === 'function') {
                window.pingHost(this.host.id);
            }
        },
        editHost() {
            if (typeof window.openEditHostModal === 'function') {
                window.openEditHostModal(this.host.id);
            }
        },
        deleteHost() {
            if (typeof window.deleteHost === 'function') {
                window.deleteHost(this.host.id);
            }
        },
        showHistory() {
            if (typeof window.showHostHistory === 'function') {
                window.showHostHistory(this.host.id);
            }
        },
        showTraffic() {
            if (typeof window.showTrafficModal === 'function') {
                window.showTrafficModal(this.host.id);
            }
        },
        showOnMap() {
            if (typeof window.focusHostOnMap === 'function') {
                window.focusHostOnMap(this.host.id);
            }
        },
        openPingModal() {
            if (typeof window.openPingModal === 'function') {
                window.openPingModal(this.host.host);
            }
        },
        openTracerouteModal() {
            if (typeof window.openTracerouteModal === 'function') {
                window.openTracerouteModal(this.host.host);
            }
        },

        // Update host data (called from store updates)
        updateHost(newData) {
            this.host = { ...this.host, ...newData };
        },

        init() {
            // Listen for host updates from SSE via store
            this.$watch('$store.app.hosts', (hosts) => {
                const updated = hosts.find(h => h.id === this.host.id);
                if (updated) {
                    this.host = updated;
                }
            });
        }
    }));
});
