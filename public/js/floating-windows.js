/**
 * Floating Windows Manager
 * Creates draggable, minimizable popup windows for Ping and Traceroute
 * Supports multiple simultaneous windows
 */

// Window Manager State
const FloatingWindowManager = {
    windows: new Map(),
    nextWindowId: 1,
    baseZIndex: 1000,
    highestZIndex: 1000,
    minimizedWindowsBar: null,

    init() {
        // Create container for floating windows if not exists
        if (!document.getElementById('floatingWindowsContainer')) {
            const container = document.createElement('div');
            container.id = 'floatingWindowsContainer';
            document.body.appendChild(container);
        }

        // Create minimized windows bar if not exists
        if (!document.getElementById('minimizedWindowsBar')) {
            const bar = document.createElement('div');
            bar.id = 'minimizedWindowsBar';
            bar.className = 'minimized-windows-bar';
            document.body.appendChild(bar);
            this.minimizedWindowsBar = bar;
        } else {
            this.minimizedWindowsBar = document.getElementById('minimizedWindowsBar');
        }
    },

    createWindow(options) {
        const windowId = `floating-window-${this.nextWindowId++}`;
        const { title, type, hostId, hostName, hostIp, onClose } = options;

        // Calculate position (cascade effect)
        const offset = (this.windows.size % 5) * 30;
        const startX = 100 + offset;
        const startY = 80 + offset;

        // Create window element
        const windowEl = document.createElement('div');
        windowEl.id = windowId;
        windowEl.className = 'floating-window';
        windowEl.dataset.type = type;
        windowEl.dataset.hostId = hostId;
        windowEl.style.left = `${startX}px`;
        windowEl.style.top = `${startY}px`;
        windowEl.style.zIndex = ++this.highestZIndex;

        windowEl.innerHTML = `
            <div class="floating-window-header">
                <div class="floating-window-title">
                    <span class="floating-window-icon">${type === 'ping' ? '📶' : '🔀'}</span>
                    <span class="floating-window-title-text">${title}</span>
                </div>
                <div class="floating-window-controls">
                    <button class="floating-window-btn floating-window-minimize" title="Minimize">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M5 12h14"/>
                        </svg>
                    </button>
                    <button class="floating-window-btn floating-window-close" title="Close">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="floating-window-body">
                <div class="terminal-container">
                    <pre class="terminal-output">Initializing ${type}...</pre>
                </div>
            </div>
            <div class="floating-window-footer">
                <span class="floating-window-status">Running...</span>
                <button class="btn btn-sm btn-ghost floating-window-action" data-action="stop">Stop</button>
            </div>
        `;

        // Add to container
        document.getElementById('floatingWindowsContainer').appendChild(windowEl);

        // Create window object
        const windowObj = {
            id: windowId,
            element: windowEl,
            type,
            hostId,
            hostName,
            hostIp,
            title,
            isMinimized: false,
            isRunning: true,
            abortController: new AbortController(),
            outputElement: windowEl.querySelector('.terminal-output'),
            statusElement: windowEl.querySelector('.floating-window-status'),
            actionBtn: windowEl.querySelector('.floating-window-action'),
            onClose
        };

        this.windows.set(windowId, windowObj);

        // Setup event handlers
        this.setupWindowEvents(windowObj);

        // Bring to front on click
        windowEl.addEventListener('mousedown', () => this.bringToFront(windowId));

        return windowObj;
    },

    setupWindowEvents(windowObj) {
        const { element, id } = windowObj;
        const header = element.querySelector('.floating-window-header');
        const minimizeBtn = element.querySelector('.floating-window-minimize');
        const closeBtn = element.querySelector('.floating-window-close');
        const actionBtn = windowObj.actionBtn;

        // Drag functionality
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        // Mouse drag events
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.floating-window-btn')) return; // Don't drag on buttons
            isDragging = true;
            dragOffsetX = e.clientX - element.offsetLeft;
            dragOffsetY = e.clientY - element.offsetTop;
            element.classList.add('dragging');
            this.bringToFront(id);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const newX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffsetX));
            const newY = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffsetY));
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.classList.remove('dragging');
            }
        });

        // Touch drag events for mobile
        header.addEventListener('touchstart', (e) => {
            if (e.target.closest('.floating-window-btn')) return;
            isDragging = true;
            const touch = e.touches[0];
            dragOffsetX = touch.clientX - element.offsetLeft;
            dragOffsetY = touch.clientY - element.offsetTop;
            element.classList.add('dragging');
            this.bringToFront(id);
            e.preventDefault(); // Prevent scrolling when starting drag
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            e.preventDefault(); // Prevent page scroll during drag
            const touch = e.touches[0];
            const newX = Math.max(0, Math.min(window.innerWidth - 100, touch.clientX - dragOffsetX));
            const newY = Math.max(0, Math.min(window.innerHeight - 50, touch.clientY - dragOffsetY));
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
        }, { passive: false });

        document.addEventListener('touchend', () => {
            if (isDragging) {
                isDragging = false;
                element.classList.remove('dragging');
            }
        });

        // Minimize
        minimizeBtn.addEventListener('click', () => this.minimizeWindow(id));

        // Close
        closeBtn.addEventListener('click', () => this.closeWindow(id));

        // Action button (Stop/Start)
        actionBtn.addEventListener('click', () => {
            if (windowObj.isRunning) {
                // Stop the operation
                windowObj.abortController.abort();
                windowObj.isRunning = false;
                windowObj.statusElement.textContent = 'Stopped';
                actionBtn.textContent = 'Start';
                actionBtn.dataset.action = 'start';
                actionBtn.classList.remove('btn-ghost');
                actionBtn.classList.add('btn-primary');
            } else {
                // Restart the operation
                this.restartOperation(id);
            }
        });
    },

    restartOperation(windowId) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;

        // Reset state
        windowObj.isRunning = true;
        windowObj.abortController = new AbortController();
        windowObj.statusElement.textContent = 'Running...';
        windowObj.actionBtn.textContent = 'Stop';
        windowObj.actionBtn.dataset.action = 'stop';
        windowObj.actionBtn.classList.remove('btn-primary');
        windowObj.actionBtn.classList.add('btn-ghost');

        // Clear output
        windowObj.outputElement.textContent = `Restarting ${windowObj.type}...\n`;

        // Start new operation based on type
        if (windowObj.type === 'ping') {
            this.runPingStream(windowObj);
        } else if (windowObj.type === 'traceroute') {
            this.runTracerouteStream(windowObj);
        }
    },

    async runPingStream(windowObj) {
        try {
            const response = await fetch(`/api/ping-stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host: windowObj.hostIp }),
                signal: windowObj.abortController.signal
            });

            if (!response.ok) {
                throw new Error('Failed to start ping');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                // Append raw text directly to preserve formatting
                this.appendRawOutput(windowObj.id, text);
            }

            this.setStatus(windowObj.id, 'Completed');
            this.setActionToStart(windowObj.id);
        } catch (error) {
            if (error.name === 'AbortError') {
                this.setStatus(windowObj.id, 'Stopped');
            } else {
                this.appendOutput(windowObj.id, `Error: ${error.message}`, true);
                this.setStatus(windowObj.id, 'Error');
            }
            this.setActionToStart(windowObj.id);
        }
    },

    async runTracerouteStream(windowObj) {
        try {
            const response = await fetch(`/api/traceroute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host: windowObj.hostIp }),
                signal: windowObj.abortController.signal
            });

            if (!response.ok) {
                throw new Error('Failed to start traceroute');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                // Append raw text directly to preserve formatting
                this.appendRawOutput(windowObj.id, text);
            }

            this.setStatus(windowObj.id, 'Completed');
            this.setActionToStart(windowObj.id);
        } catch (error) {
            if (error.name === 'AbortError') {
                this.setStatus(windowObj.id, 'Stopped');
            } else {
                this.appendOutput(windowObj.id, `Error: ${error.message}`, true);
                this.setStatus(windowObj.id, 'Error');
            }
            this.setActionToStart(windowObj.id);
        }
    },

    setActionToStart(windowId) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;

        windowObj.isRunning = false;
        windowObj.actionBtn.textContent = 'Start';
        windowObj.actionBtn.dataset.action = 'start';
        windowObj.actionBtn.classList.remove('btn-ghost');
        windowObj.actionBtn.classList.add('btn-primary');
    },

    bringToFront(windowId) {
        const windowObj = this.windows.get(windowId);
        if (windowObj) {
            windowObj.element.style.zIndex = ++this.highestZIndex;
        }
    },

    minimizeWindow(windowId) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;

        windowObj.isMinimized = true;
        windowObj.element.classList.add('minimized');

        // Add to minimized bar
        const minItem = document.createElement('div');
        minItem.className = 'minimized-window-item';
        minItem.dataset.windowId = windowId;
        minItem.innerHTML = `
            <span class="minimized-window-icon">${windowObj.type === 'ping' ? '📶' : '🔀'}</span>
            <span class="minimized-window-name">${windowObj.hostName || windowObj.hostIp}</span>
        `;
        minItem.addEventListener('click', () => this.restoreWindow(windowId));
        this.minimizedWindowsBar.appendChild(minItem);
    },

    restoreWindow(windowId) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;

        windowObj.isMinimized = false;
        windowObj.element.classList.remove('minimized');
        this.bringToFront(windowId);

        // Remove from minimized bar
        const minItem = this.minimizedWindowsBar.querySelector(`[data-window-id="${windowId}"]`);
        if (minItem) minItem.remove();
    },

    closeWindow(windowId) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;

        // Abort any ongoing operation
        windowObj.abortController.abort();

        // Call onClose callback
        if (windowObj.onClose) windowObj.onClose();

        // Remove from DOM
        windowObj.element.remove();

        // Remove from minimized bar if minimized
        const minItem = this.minimizedWindowsBar?.querySelector(`[data-window-id="${windowId}"]`);
        if (minItem) minItem.remove();

        // Remove from map
        this.windows.delete(windowId);
    },

    appendOutput(windowId, text, isError = false) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;

        const output = windowObj.outputElement;
        if (output.textContent === `Initializing ${windowObj.type}...` ||
            output.textContent === `Restarting ${windowObj.type}...\n`) {
            output.textContent = '';
        }

        const line = document.createElement('span');
        line.className = isError ? 'terminal-error' : 'terminal-line';
        line.textContent = text + '\n';
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;
    },

    // Append raw text directly preserving original formatting
    appendRawOutput(windowId, text) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;

        const output = windowObj.outputElement;
        if (output.textContent === `Initializing ${windowObj.type}...` ||
            output.textContent === `Restarting ${windowObj.type}...\n`) {
            output.textContent = '';
        }

        // Append text directly to preserve formatting
        output.textContent += text;
        output.scrollTop = output.scrollHeight;
    },

    setStatus(windowId, status) {
        const windowObj = this.windows.get(windowId);
        if (!windowObj) return;
        windowObj.statusElement.textContent = status;
    },

    getAbortSignal(windowId) {
        const windowObj = this.windows.get(windowId);
        return windowObj?.abortController.signal;
    },

    closeAllOfType(type) {
        for (const [id, window] of this.windows) {
            if (window.type === type) {
                this.closeWindow(id);
            }
        }
    }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FloatingWindowManager.init());
} else {
    FloatingWindowManager.init();
}

// Export for use in app.js
window.FloatingWindowManager = FloatingWindowManager;

/**
 * Open a new Ping floating window
 * @param {string} hostId - Host ID
 * @param {string} hostName - Host display name
 * @param {string} hostIp - Host IP/hostname
 */
async function openPingWindow(hostId, hostName, hostIp) {
    const windowObj = FloatingWindowManager.createWindow({
        title: `Ping - ${hostName}`,
        type: 'ping',
        hostId,
        hostName,
        hostIp
    });

    FloatingWindowManager.runPingStream(windowObj);
}

/**
 * Open a new Traceroute floating window
 * @param {string} hostId - Host ID
 * @param {string} hostName - Host display name
 * @param {string} hostIp - Host IP/hostname
 */
async function openTracerouteWindow(hostId, hostName, hostIp) {
    const windowObj = FloatingWindowManager.createWindow({
        title: `Traceroute - ${hostName}`,
        type: 'traceroute',
        hostId,
        hostName,
        hostIp
    });

    FloatingWindowManager.runTracerouteStream(windowObj);
}

// Export functions
window.openPingWindow = openPingWindow;
window.openTracerouteWindow = openTracerouteWindow;
