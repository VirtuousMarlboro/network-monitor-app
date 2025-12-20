document.addEventListener('alpine:init', () => {
    Alpine.data('trafficChart', () => ({
        chart: null,

        init() {
            // Watch for data updates in the store
            this.$watch('$store.traffic.data', (data) => {
                if (this.chart && data) {
                    this.updateChart(data);
                } else if (!this.chart && data && data.length > 0) {
                    this.initChart();
                    this.updateChart(data);
                }
            });

            // Watch for modal open state to init/destroy
            this.$watch('$store.traffic.isOpen', (isOpen) => {
                if (isOpen) {
                    this.$nextTick(() => {
                        if (!this.chart) this.initChart();
                        // Trigger fetch if empty? Store handles fetch.
                    });
                } else {
                    // Optional: Destroy chart to save memory, or keep it.
                    // this.destroyChart(); 
                }
            });
        },

        initChart() {
            const ctx = this.$refs.canvas.getContext('2d');
            if (this.chart) this.chart.destroy();

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Inbound (Mbps)',
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            data: [],
                            fill: true,
                            tension: 0.4
                        },
                        {
                            label: 'Outbound (Mbps)',
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            data: [],
                            fill: true,
                            tension: 0.4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: 'index' },
                    plugins: {
                        legend: { labels: { color: '#9ca3af' } },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return context.dataset.label + ': ' + context.parsed.y + ' Mbps';
                                }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                        y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' }, beginAtZero: true }
                    },
                    animation: false
                }
            });
        },

        updateChart(data) {
            if (!this.chart) return;

            const labels = data.map(h => new Date(h.timestamp).toLocaleTimeString());
            const dataIn = data.map(h => parseFloat((h.traffic_in || 0).toFixed(2)));
            const dataOut = data.map(h => parseFloat((h.traffic_out || 0).toFixed(2)));

            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = dataIn;
            this.chart.data.datasets[1].data = dataOut;
            this.chart.update();
        },

        destroyChart() {
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
        }
    }));
});
