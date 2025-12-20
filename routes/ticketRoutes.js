/**
 * Ticket Management Routes
 * Handles CRUD operations for tickets and comments
 */
const express = require('express');
const xlsx = require('xlsx');

/**
 * Factory function to create ticket routes
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getTickets - Get tickets array
 * @param {Function} deps.getHosts - Get hosts array
 * @param {Function} deps.getUsers - Get users array
 * @param {Function} deps.saveTickets - Save tickets to file
 * @param {Function} deps.createTicket - Create ticket function
 * @param {Function} deps.addAuditLog - Add audit log entry
 * @param {Function} deps.broadcastSSE - Broadcast SSE event
 * @param {Object} deps.upload - Multer upload middleware
 * @param {Object} deps.middleware - { requireAuth }
 * @returns {express.Router}
 */
function createTicketRoutes(deps) {
    const router = express.Router();
    const {
        getTickets, getHosts, getUsers, saveTickets, createTicket,
        addAuditLog, broadcastSSE, upload, middleware
    } = deps;

    // GET /api/tickets - Get all tickets
    router.get('/', middleware.requireAuth, (req, res) => {
        res.json(getTickets());
    });

    // GET /api/tickets/export - Export tickets to Excel
    router.get('/export', middleware.requireAuth, (req, res) => {
        try {
            const tickets = getTickets();
            const dataToExport = tickets.map(t => {
                const start = new Date(t.createdAt);
                const end = t.resolvedAt ? new Date(t.resolvedAt) : null;
                const firstResp = t.firstResponseAt ? new Date(t.firstResponseAt) : null;

                let duration = '-';
                if (end) {
                    const diffMs = end - start;
                    const diffMins = Math.floor(diffMs / 60000);
                    const hrs = Math.floor(diffMins / 60);
                    const mins = diffMins % 60;
                    duration = `${hrs}h ${mins}m`;
                }

                let responseTime = '-';
                if (firstResp) {
                    const diffMs = firstResp - start;
                    const diffMins = Math.floor(diffMs / 60000);
                    const hrs = Math.floor(diffMins / 60);
                    const mins = diffMins % 60;
                    responseTime = `${hrs}h ${mins}m`;
                }

                const actionResolution = t.comments && t.comments.length > 0
                    ? t.comments.map(c => `[${new Date(c.createdAt).toLocaleString()}] ${c.authorName}: ${c.text}`).join('\n')
                    : '';

                return {
                    'No': t.ticketId || t.id,
                    'Issue / Task': t.title,
                    'Customer Name': t.hostName || 'Unknown',
                    'Date / Start Time': new Date(t.createdAt).toLocaleString(),
                    'Ticket': t.id,
                    'Status': t.status.toUpperCase(),
                    'Date / Respond Time': t.firstResponseAt ? new Date(t.firstResponseAt).toLocaleString() : '-',
                    'Date / End Time': t.resolvedAt ? new Date(t.resolvedAt).toLocaleString() : '-',
                    'Duration': duration,
                    'Respond Time': responseTime,
                    'On Duty': t.submitterName || 'System',
                    'Resolved By': t.resolverName || '-',
                    'Information / Root Cause': t.description,
                    'Action / Resolution': actionResolution
                };
            });

            const wb = xlsx.utils.book_new();
            const ws = xlsx.utils.json_to_sheet(dataToExport);

            const wscols = [
                { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 20 },
                { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 20 },
                { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 20 },
                { wch: 50 }, { wch: 50 }
            ];
            ws['!cols'] = wscols;
            xlsx.utils.book_append_sheet(wb, ws, 'Tickets');

            const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=Tickets_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
            res.send(buffer);
        } catch (error) {
            console.error('Export error:', error);
            res.status(500).json({ error: 'Failed to export tickets' });
        }
    });

    // POST /api/tickets - Create ticket manually
    router.post('/', middleware.requireAuth, upload.array('images', 5), (req, res) => {
        const { hostId, title, description, priority, picName, createdAt, firstResponseAt } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        let hostName = 'Unknown';
        let hostCid = null;
        let validHostId = null;
        const hosts = getHosts();

        if (hostId) {
            const host = hosts.find(h => h.id === hostId);
            if (host) {
                validHostId = host.id;
                hostName = host.name;
                hostCid = host.cid;
            } else {
                // If Host ID was sent but not found, treat as general ticket (Host: Unknown)
                // This prevents Foreign Key constraint errors
                validHostId = null;
            }
        }

        const attachments = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];

        let submitterId = null;
        let submitterName = null;
        const users = getUsers();
        if (req.session && req.session.userId) {
            const user = users.find(u => u.id === req.session.userId);
            if (user) {
                submitterId = user.id;
                submitterName = user.name;
            }
        }

        const ticket = createTicket(
            validHostId, hostName, hostCid, title, description || '',
            'manual', priority || 'medium', attachments,
            null, picName || null, submitterId, submitterName, createdAt || null
        );

        if (firstResponseAt) {
            ticket.firstResponseAt = firstResponseAt;
            saveTickets();
            broadcastSSE('ticket-updated', ticket);
        }

        const user = users.find(u => u.id === req.session?.userId);
        addAuditLog(req.session?.userId || 'system', user?.username || 'anonymous', 'ticket_create', `Created ticket: ${ticket.ticketId}`, { ticketId: ticket.id });

        res.status(201).json(ticket);
    });

    // PUT /api/tickets/:id - Update ticket
    router.put('/:id', middleware.requireAuth, (req, res) => {
        const { id } = req.params;
        const { status, priority, description, picName, createdAt, firstResponseAt } = req.body;
        const tickets = getTickets();
        const users = getUsers();

        const ticket = tickets.find(t => t.id === id);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const previousStatus = ticket.status;

        if (status !== undefined) {
            ticket.status = status;

            if (previousStatus === 'open' && (status === 'in_progress' || status === 'resolved')) {
                if (!ticket.firstResponseAt && !firstResponseAt) {
                    ticket.firstResponseAt = new Date().toISOString();
                }
            }

            if (status === 'resolved') {
                if (!ticket.firstResponseAt && !firstResponseAt) {
                    ticket.firstResponseAt = new Date().toISOString();
                }
                if (!ticket.resolvedAt && !req.body.resolvedAt) {
                    ticket.resolvedAt = new Date().toISOString();
                }
                // Set resolver info
                if (req.session && req.session.userId) {
                    const user = users.find(u => u.id === req.session.userId);
                    if (user) {
                        ticket.resolverId = user.id;
                        ticket.resolverName = user.name;
                    }
                }
            }
        }

        if (priority !== undefined) ticket.priority = priority;
        if (description !== undefined) ticket.description = description;
        if (picName !== undefined) ticket.picName = picName || null;
        if (createdAt !== undefined && ticket.source !== 'auto') ticket.createdAt = createdAt;
        if (firstResponseAt !== undefined) ticket.firstResponseAt = firstResponseAt || null;

        saveTickets();
        broadcastSSE('ticket-updated', ticket);

        const actionUser = users.find(u => u.id === req.session?.userId);
        addAuditLog(req.session?.userId || 'system', actionUser?.username || 'anonymous', 'ticket_update', `Updated ticket: ${ticket.ticketId} (status: ${ticket.status})`, { ticketId: id });

        res.json(ticket);
    });

    // DELETE /api/tickets/:id - Delete ticket
    router.delete('/:id', middleware.requireAuth, (req, res) => {
        const { id } = req.params;
        const tickets = getTickets();
        const index = tickets.findIndex(t => t.id === id);

        if (index === -1) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const deleted = tickets.splice(index, 1)[0];
        saveTickets();
        broadcastSSE('ticket-deleted', { id });

        res.json({ message: 'Ticket deleted', ticket: deleted });
    });

    // POST /api/tickets/:id/comments - Add comment
    router.post('/:id/comments', middleware.requireAuth, upload.single('image'), (req, res) => {
        const { id } = req.params;
        const { text } = req.body;
        const hasImage = req.file ? true : false;
        const tickets = getTickets();
        const users = getUsers();

        if ((!text || !text.trim()) && !hasImage) {
            return res.status(400).json({ error: 'Comment text or image is required' });
        }

        const ticket = tickets.find(t => t.id === id);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        if (!ticket.comments) ticket.comments = [];

        const user = users.find(u => u.id === req.session.userId);
        const comment = {
            id: Date.now().toString(),
            text: text ? text.trim() : '',
            image: hasImage ? '/uploads/' + req.file.filename : null,
            author: user ? user.name : 'Unknown',
            authorId: req.session.userId,
            createdAt: new Date().toISOString()
        };

        if (!ticket.firstResponseAt && req.session.userId !== ticket.submitterId) {
            ticket.firstResponseAt = new Date().toISOString();
        }

        ticket.comments.push(comment);
        ticket.updatedAt = new Date().toISOString();
        saveTickets();

        broadcastSSE('ticket-updated', ticket);
        res.status(201).json(comment);
    });

    // DELETE /api/tickets/:ticketId/comments/:commentId - Delete comment
    router.delete('/:ticketId/comments/:commentId', middleware.requireAuth, (req, res) => {
        const { ticketId, commentId } = req.params;
        const userId = req.session.userId;
        const userRole = req.session.userRole;
        const tickets = getTickets();

        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        if (!ticket.comments) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        const commentIndex = ticket.comments.findIndex(c => c.id === commentId);
        if (commentIndex === -1) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        const comment = ticket.comments[commentIndex];
        if (comment.authorId !== userId && userRole !== 'admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        ticket.comments.splice(commentIndex, 1);
        saveTickets();

        broadcastSSE('ticket-updated', ticket);
        res.json({ success: true });
    });

    return router;
}

module.exports = { createTicketRoutes };
