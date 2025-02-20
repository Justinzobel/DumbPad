export class CursorManager {
    constructor({ editor }) {
        this.editor = editor;
        this.remoteUsers = new Map(); // Store other users' colors and cursors
        this.DEBUG = false;

        // Cache for text measurements
        this.textMetrics = {
            lineHeight: 0,
            charWidth: 0,
            lastUpdate: 0,
            measurementDiv: null
        };

        this.initializeTextMetrics();
    }

    // Initialize text measurements with debug logging
    initializeTextMetrics() {
        const style = getComputedStyle(this.editor);
        this.textMetrics.measurementDiv = document.createElement('div');
        Object.assign(this.textMetrics.measurementDiv.style, {
            position: 'absolute',
            visibility: 'hidden',
            whiteSpace: 'pre',
            font: style.font,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
            padding: '0',
            border: 'none',
            margin: '0'
        });
        document.body.appendChild(this.textMetrics.measurementDiv);
        this.updateTextMetrics();
        
        if (this.DEBUG) {
            console.log('Text metrics initialized:', {
                font: style.font,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                letterSpacing: style.letterSpacing,
                editorStyle: {
                    font: style.font,
                    lineHeight: style.lineHeight,
                    padding: style.padding
                }
            });
        }
    }

    // Update text measurements periodically
    updateTextMetrics() {
        const now = Date.now();
        if (now - this.textMetrics.lastUpdate > 5000) { // Update every 5 seconds
            const style = getComputedStyle(this.editor);
            this.textMetrics.lineHeight = parseFloat(style.lineHeight);
            if (isNaN(this.textMetrics.lineHeight)) {
                this.textMetrics.lineHeight = parseFloat(style.fontSize) * 1.2;
            }
            this.textMetrics.measurementDiv.textContent = 'X';
            this.textMetrics.charWidth = this.textMetrics.measurementDiv.offsetWidth;
            this.textMetrics.lastUpdate = now;
        }
    }

    // Create and update remote cursors
    createRemoteCursor(remoteUserId, color) {
        // Double check we never create our own cursor
        if (remoteUserId === window.userId) {
            if (this.DEBUG) {
                console.warn('Attempted to create cursor for our own userId:', remoteUserId);
            }
            return null;
        }
        
        const cursor = document.createElement('div');
        cursor.className = 'remote-cursor';
        cursor.style.color = color;
        
        // Ensure the editor container exists
        const container = document.querySelector('.editor-container');
        if (!container) {
            console.error('Editor container not found');
            return null;
        }
        
        container.appendChild(cursor);
        if (this.DEBUG) {
            console.log('Created remote cursor for user:', remoteUserId, 'color:', color);
        }
        
        // Store user information
        this.remoteUsers.set(remoteUserId, { color, cursor });
        return cursor;
    }

    // Update cursor position with improved measurements
    updateCursorPosition(remoteUserId, position, color) {
        // Don't create or update cursor for our own user ID
        if (remoteUserId === window.userId) {
            return;
        }
        
        let userInfo = this.remoteUsers.get(remoteUserId);
        let cursor;
        
        if (!userInfo) {
            cursor = this.createRemoteCursor(remoteUserId, color);
            if (!cursor) return; // Exit if cursor creation failed
        } else {
            cursor = userInfo.cursor;
            if (color !== userInfo.color) {
                cursor.style.color = color;
                userInfo.color = color;
            }
        }

        // Get text up to cursor position
        const text = this.editor.value.substring(0, position);
        const lines = text.split('\n');
        const currentLine = lines.length;
        const currentLineStart = text.lastIndexOf('\n') + 1;
        const currentLineText = text.slice(currentLineStart);
        
        this.updateTextMetrics();
        
        if (this.DEBUG) {
            console.log('Cursor position debug:', {
                userId: remoteUserId,
                position,
                currentLine,
                currentLineText,
                lineHeight: this.textMetrics.lineHeight,
                charWidth: this.textMetrics.charWidth
            });
        }
        
        // Measure current line
        this.textMetrics.measurementDiv.textContent = currentLineText;
        const left = this.textMetrics.measurementDiv.offsetWidth;
        
        const editorRect = this.editor.getBoundingClientRect();
        const containerRect = document.querySelector('.editor-container').getBoundingClientRect();
        const scrollTop = this.editor.scrollTop;
        
        // Calculate position relative to the editor's padding
        const editorPadding = parseFloat(getComputedStyle(this.editor).paddingLeft);
        const relativeLeft = editorPadding + left;
        const relativeTop = currentLine * this.textMetrics.lineHeight - this.textMetrics.lineHeight * 0.1; // Adjust for proper line alignment
        
        // Store position for scroll updates
        cursor.dataset.position = position;
        
        if (this.DEBUG) {
            console.log('Cursor positioning debug:', {
                measurements: {
                    left,
                    editorPadding,
                    lineHeight: this.textMetrics.lineHeight,
                    scrollTop
                },
                rects: {
                    editor: editorRect,
                    container: containerRect
                },
                computed: {
                    relativeLeft,
                    relativeTop
                }
            });
        }
        
        // Apply position with smooth transition
        cursor.style.transform = `translate3d(${relativeLeft}px, ${relativeTop - scrollTop}px, 0)`;
        cursor.style.height = `${this.textMetrics.lineHeight * 0.9}px`; // Slightly shorter than line height
        cursor.style.display = 'block'; // Ensure cursor is visible
    }

    // Handle user disconnection
    handleUserDisconnection(userId) {
        if (this.DEBUG) {
            console.log('User disconnected:', userId);
        }
        const userInfo = this.remoteUsers.get(userId);
        if (userInfo) {
            userInfo.cursor.remove();
            this.remoteUsers.delete(userId);
        }
    }

    // Update all cursors (e.g., on scroll)
    updateAllCursors() {
        this.remoteUsers.forEach((userInfo, userId) => {
            const position = parseInt(userInfo.cursor.dataset.position);
            if (!isNaN(position)) {
                this.updateCursorPosition(userId, position, userInfo.color);
            }
        });
    }

    // Clean up resources
    cleanup() {
        if (this.textMetrics.measurementDiv) {
            this.textMetrics.measurementDiv.remove();
        }
        this.remoteUsers.forEach(userInfo => userInfo.cursor.remove());
        this.remoteUsers.clear();
    }
} 