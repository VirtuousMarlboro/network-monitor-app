// ========================================
// Tooltip Helper Functions
// ========================================

function showChartTooltip(e, time, latency) {
    let tooltip = document.getElementById('chartTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'chartTooltip';
        tooltip.className = 'chart-tooltip';
        document.body.appendChild(tooltip);
    }

    tooltip.innerHTML = `<div class="tooltip-time">${time}</div><div class="tooltip-val">${latency}</div>`;
    tooltip.style.display = 'block';
    tooltip.style.left = (e.pageX + 10) + 'px';
    tooltip.style.top = (e.pageY + 10) + 'px';
}

function hideChartTooltip() {
    const tooltip = document.getElementById('chartTooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}
