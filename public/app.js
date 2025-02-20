document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('editor');
    const themeToggle = document.getElementById('theme-toggle');
    const saveStatus = document.getElementById('save-status');
    const notepadSelector = document.getElementById('notepad-selector');
    const newNotepadBtn = document.getElementById('new-notepad');
    const renameNotepadBtn = document.getElementById('rename-notepad');
    const downloadNotepadBtn = document.getElementById('download-notepad');
    const printNotepadBtn = document.getElementById('print-notepad');
    const deleteNotepadBtn = document.getElementById('delete-notepad');
    const renameModal = document.getElementById('rename-modal');
    const deleteModal = document.getElementById('delete-modal');
    const renameInput = document.getElementById('rename-input');
    const renameCancel = document.getElementById('rename-cancel');
    const renameConfirm = document.getElementById('rename-confirm');
    const deleteCancel = document.getElementById('delete-cancel');
    const deleteConfirm = document.getElementById('delete-confirm');
    
    let saveTimeout;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 2000;
    let currentNotepadId = 'default';
    let baseUrl = '';
    let ws = null;
    let isReceivingUpdate = false;
    let revision = 0;
    
    // Collaborative editing state
    const userId = Math.random().toString(36).substring(2, 15);
    window.userId = userId; // Make userId globally accessible
    const userColor = getRandomColor();
    const remoteCursors = new Map();
    let lastCursorUpdate = 0;
    const CURSOR_UPDATE_INTERVAL = 100;
    let localCursorPosition = 0;

    // Operation Types
    const OperationType = {
        INSERT: 'insert',
        DELETE: 'delete'
    };

    // Create an operation object
    function createOperation(type, position, text) {
        return {
            type,
            position,
            text,
            userId,
            revision: revision++,
            cursorPosition: editor.selectionStart
        };
    }

    // Transform operation against another operation
    function transformOperation(operation, against) {
        if (!against || operation.revision <= against.revision) {
            return operation;
        }

        const newOp = { ...operation };

        if (against.type === OperationType.INSERT) {
            // Adjust position if operation is after the insertion point
            if (operation.position > against.position) {
                newOp.position += against.text.length;
            }
            // Adjust cursor position if it's after the insertion point
            if (operation.cursorPosition > against.position) {
                newOp.cursorPosition += against.text.length;
            }
        } else if (against.type === OperationType.DELETE) {
            // Adjust position if operation is after the deletion point
            if (operation.position > against.position) {
                newOp.position -= Math.min(
                    against.text.length,
                    operation.position - against.position
                );
            }
            // Adjust cursor position if it's after the deletion point
            if (operation.cursorPosition > against.position) {
                newOp.cursorPosition -= Math.min(
                    against.text.length,
                    operation.cursorPosition - against.position
                );
            }
        }

        return newOp;
    }

    // Apply an operation to the text
    function applyOperation(operation, text) {
        switch (operation.type) {
            case OperationType.INSERT:
                return text.slice(0, operation.position) + 
                       operation.text + 
                       text.slice(operation.position);
            case OperationType.DELETE:
                return text.slice(0, operation.position) + 
                       text.slice(operation.position + operation.text.length);
            default:
                return text;
        }
    }

    // Generate a random color for the user
    function getRandomColor() {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
            '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB',
            '#E67E22', '#27AE60', '#F1C40F', '#E74C3C'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    // Create and update remote cursors
    function createRemoteCursor(userId, color) {
        const cursor = document.createElement('div');
        cursor.className = 'remote-cursor';
        cursor.style.backgroundColor = color;
        cursor.style.position = 'absolute';
        cursor.style.width = '2px';
        cursor.style.height = '20px';
        cursor.style.pointerEvents = 'none';
        cursor.style.transition = 'transform 0.1s ease';
        
        const label = document.createElement('div');
        label.className = 'remote-cursor-label';
        label.style.backgroundColor = color;
        label.style.color = '#fff';
        label.style.padding = '2px 6px';
        label.style.borderRadius = '3px';
        label.style.fontSize = '12px';
        label.style.position = 'absolute';
        label.style.top = '-20px';
        label.style.left = '0';
        label.style.whiteSpace = 'nowrap';
        label.textContent = `User ${userId.substr(0, 4)}`;
        
        cursor.appendChild(label);
        document.querySelector('.editor-container').appendChild(cursor);
        return cursor;
    }

    // Update cursor position
    function updateCursorPosition(userId, position, color) {
        if (userId === window.userId) return; // Don't show own cursor
        
        let cursor = remoteCursors.get(userId);
        if (!cursor) {
            cursor = createRemoteCursor(userId, color);
            remoteCursors.set(userId, cursor);
        }

        // Get the position in the editor
        const textArea = editor;
        const rect = textArea.getBoundingClientRect();
        const lineHeight = parseInt(getComputedStyle(textArea).lineHeight);
        const { left, top } = getCaretCoordinates(textArea, position);

        cursor.style.transform = `translate(${left + rect.left}px, ${top + rect.top}px)`;
    }

    // Get caret coordinates in the textarea
    function getCaretCoordinates(element, position) {
        const div = document.createElement('div');
        const text = element.value.substring(0, position);
        const styles = getComputedStyle(element);
        
        div.style.position = 'absolute';
        div.style.top = '0';
        div.style.left = '0';
        div.style.visibility = 'hidden';
        div.style.whiteSpace = 'pre-wrap';
        div.style.wordWrap = 'break-word';
        div.style.width = styles.width;
        div.style.font = styles.font;
        div.style.padding = styles.padding;
        
        div.textContent = text;
        document.body.appendChild(div);
        
        const coordinates = {
            left: div.offsetWidth,
            top: div.offsetHeight
        };
        
        document.body.removeChild(div);
        return coordinates;
    }

    // Add CSS for remote cursors
    const style = document.createElement('style');
    style.textContent = `
        .remote-cursor {
            pointer-events: none;
            z-index: 1000;
        }
        .remote-cursor-label {
            pointer-events: none;
            z-index: 1000;
        }
        .editor-container {
            position: relative;
        }
    `;
    document.head.appendChild(style);

    // Theme handling
    const initializeTheme = () => {
        if (localStorage.getItem('theme') === 'dark' || 
            (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
        }
    };

    const toggleTheme = () => {
        document.body.classList.toggle('dark-mode');
        document.body.classList.toggle('light-mode');
        localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    };

    // Initialize theme immediately
    initializeTheme();
    themeToggle.addEventListener('click', toggleTheme);

    // Load notepads list
    const loadNotepads = async () => {
        try {
            const response = await fetchWithPin('/api/notepads');
            const data = await response.json();

            // Read the existing cookie value
            currentNotepadId = data['note_history'];
            
            // Set the appropriate selector value based on the history
            notepadSelector.innerHTML = data.notepads_list.notepads
                .map(pad => `<option value="${pad.id}"${pad.id === currentNotepadId?'selected':''}>${pad.name}</option>`)
                .join('');
        } catch (err) {
            console.error('Error loading notepads:', err);
            return [];
        }
    };

    // Create new notepad
    const createNotepad = async () => {
        try {
            const response = await fetchWithPin('/api/notepads', { method: 'POST' });
            const newNotepad = await response.json();
            await loadNotepads();
            notepadSelector.value = newNotepad.id;
            currentNotepadId = newNotepad.id;
            editor.value = '';
            
            // Broadcast notepad change
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'notepad_change'
                }));
            }
        } catch (err) {
            console.error('Error creating notepad:', err);
        }
    };

    // Rename notepad
    const renameNotepad = async (newName) => {
        try {
            await fetchWithPin(`/api/notepads/${currentNotepadId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newName }),
            });
            await loadNotepads();
            notepadSelector.value = currentNotepadId;
        } catch (err) {
            console.error('Error renaming notepad:', err);
        }
    };

    // Load notes
    const loadNotes = async (notepadId) => {
        try {
            const response = await fetchWithPin(`/api/notes/${notepadId}`);
            const data = await response.json();
            editor.value = data.content;
        } catch (err) {
            console.error('Error loading notes:', err);
        }
    };

    // Save notes with debounce
    const saveNotes = async (content) => {
        try {
            await fetchWithPin(`/api/notes/${currentNotepadId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content }),
            });
            
            // Broadcast the update to other clients
            if (ws && ws.readyState === WebSocket.OPEN && !isReceivingUpdate) {
                ws.send(JSON.stringify({
                    type: 'update',
                    notepadId: currentNotepadId,
                    content: content
                }));
            }
            
            // Show save status
            saveStatus.textContent = 'Saved';
            saveStatus.classList.add('visible');
            lastSaveTime = Date.now();
            setTimeout(() => {
                saveStatus.classList.remove('visible');
            }, 2000);
        } catch (err) {
            console.error('Error saving notes:', err);
            saveStatus.textContent = 'Error saving';
            saveStatus.classList.add('visible');
            setTimeout(() => {
                saveStatus.classList.remove('visible');
            }, 2000);
        }
    };

    // Check if we should do a periodic save
    const checkPeriodicSave = (content) => {
        const now = Date.now();
        if (now - lastSaveTime >= SAVE_INTERVAL) {
            saveNotes(content);
        }
    };

    // Debounced save
    const debouncedSave = (content) => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveNotes(content);
        }, 300); // Reduced from 1000 to 300 milliseconds
    };

    // Event Listeners
    editor.addEventListener('input', (e) => {
        if (isReceivingUpdate) return;

        const currentValue = e.target.value;
        const previousValue = editor.previousValue || '';
        editor.previousValue = currentValue;

        // Determine the operation type and details
        let operation;
        if (currentValue.length > previousValue.length) {
            // Insert operation
            const position = e.target.selectionStart - 
                           (currentValue.length - previousValue.length);
            const insertedText = currentValue.slice(position, e.target.selectionStart);
            operation = createOperation(OperationType.INSERT, position, insertedText);
            localCursorPosition = e.target.selectionStart;
        } else {
            // Delete operation
            const position = e.target.selectionStart;
            const deletedText = previousValue.slice(
                position,
                position + (previousValue.length - currentValue.length)
            );
            operation = createOperation(OperationType.DELETE, position, deletedText);
            localCursorPosition = position;
        }

        // Send operation through WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'operation',
                notepadId: currentNotepadId,
                operation,
                userId
            }));
        }

        debouncedSave(currentValue);
        checkPeriodicSave(currentValue);
    });

    // Track cursor position and selection
    editor.addEventListener('mouseup', updateLocalCursor);
    editor.addEventListener('keyup', updateLocalCursor);
    editor.addEventListener('click', updateLocalCursor);

    function updateLocalCursor() {
        const now = Date.now();
        if (now - lastCursorUpdate < CURSOR_UPDATE_INTERVAL) return;
        
        lastCursorUpdate = now;
        localCursorPosition = editor.selectionStart;
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'cursor',
                userId: userId,
                color: userColor,
                position: localCursorPosition,
                notepadId: currentNotepadId
            }));
        }
    }

    notepadSelector.addEventListener('change', (e) => {
        currentNotepadId = e.target.value;
        loadNotes(currentNotepadId);
    });

    newNotepadBtn.addEventListener('click', createNotepad);

    renameNotepadBtn.addEventListener('click', () => {
        const currentNotepad = notepadSelector.options[notepadSelector.selectedIndex];
        renameInput.value = currentNotepad.text;
        renameModal.classList.add('visible');
    });

    renameCancel.addEventListener('click', () => {
        renameModal.classList.remove('visible');
    });

    renameConfirm.addEventListener('click', async () => {
        const newName = renameInput.value.trim();
        if (newName) {
            await renameNotepad(newName);
            renameModal.classList.remove('visible');
        }
    });

    // Delete notepad
    const deleteNotepad = async () => {
        try {
            if (currentNotepadId === 'default') {
                alert('Cannot delete the default notepad');
                return;
            }

            const response = await fetchWithPin(`/api/notepads/${currentNotepadId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete notepad');
            }

            await loadNotepads();
            currentNotepadId = 'default';
            notepadSelector.value = currentNotepadId;
            await loadNotes(currentNotepadId);
            
            // Broadcast notepad change
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'notepad_change'
                }));
            }
            
            // Show deletion status
            saveStatus.textContent = 'Notepad deleted';
            saveStatus.classList.add('visible');
            setTimeout(() => {
                saveStatus.classList.remove('visible');
            }, 2000);
        } catch (err) {
            console.error('Error deleting notepad:', err);
            saveStatus.textContent = 'Error deleting notepad';
            saveStatus.classList.add('visible');
            setTimeout(() => {
                saveStatus.classList.remove('visible');
            }, 2000);
        }
    };

    // Event Listeners
    deleteNotepadBtn.addEventListener('click', () => {
        if (currentNotepadId === 'default') {
            alert('Cannot delete the default notepad');
            return;
        }
        deleteModal.classList.add('visible');
    });

    deleteCancel.addEventListener('click', () => {
        deleteModal.classList.remove('visible');
    });

    deleteConfirm.addEventListener('click', async () => {
        await deleteNotepad();
        deleteModal.classList.remove('visible');
    });

    // Handle Ctrl+S
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveNotes(editor.value);
        }
    });

    // Download current notepad
    const downloadNotepad = () => {
        const notepadName = notepadSelector.options[notepadSelector.selectedIndex].text;
        const content = editor.value;
        
        // Create blob with content
        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        
        // Create temporary link and trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = `${notepadName}.txt`;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        // Show download status
        saveStatus.textContent = 'Downloaded';
        saveStatus.classList.add('visible');
        setTimeout(() => {
            saveStatus.classList.remove('visible');
        }, 2000);
    };

    // Print current notepad
    const printNotepad = () => {
        const notepadName = notepadSelector.options[notepadSelector.selectedIndex].text;
        const content = editor.value;
        
        // Create a new window for printing
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${notepadName}</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        line-height: 1.6;
                        padding: 2rem;
                        white-space: pre-wrap;
                    }
                    @media print {
                        body {
                            padding: 0;
                        }
                    }
                </style>
            </head>
            <body>
                ${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>')}
            </body>
            </html>
        `);
        
        printWindow.document.close();
        printWindow.focus();
        
        // Wait for content to load before printing
        setTimeout(() => {
            printWindow.print();
            // Close the window after printing (some browsers may do this automatically)
            printWindow.close();
        }, 250);

        // Show print status
        saveStatus.textContent = 'Printing...';
        saveStatus.classList.add('visible');
        setTimeout(() => {
            saveStatus.classList.remove('visible');
        }, 2000);
    };

    // Add event listeners for download and print after function definitions
    downloadNotepadBtn.addEventListener('click', downloadNotepad);
    printNotepadBtn.addEventListener('click', printNotepad);

    // Initialize the app
    const initializeApp = () => {
        // Fetch site configuration
        fetch(`/api/config`)
            .then(response => response.json())
            .then(config => {
                document.getElementById('page-title').textContent = `${config.siteTitle} - Simple Notes`;
                document.getElementById('header-title').textContent = config.siteTitle;
                baseUrl = config.baseUrl;

                // Initialize notepads
                loadNotepads().then(() => {
                    loadNotes(currentNotepadId);
                });
            })
            .catch(err => console.error('Error loading site configuration:', err));
    };

    // Add credentials to all API requests
    const fetchWithPin = async (url, options = {}) => {
        // Add credentials to include cookies
        options.credentials = 'same-origin';
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        return fetch(fullUrl, options);
    };

    // WebSocket setup
    const setupWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);

        ws.onmessage = handleWebSocketMessage;

        ws.onclose = () => {
            remoteCursors.forEach(cursor => cursor.remove());
            remoteCursors.clear();
            setTimeout(setupWebSocket, 5000);
        };

        ws.onopen = () => {
            // Send initial cursor position and color
            if (editor) {
                ws.send(JSON.stringify({
                    type: 'cursor',
                    userId: userId,
                    color: userColor,
                    position: editor.selectionStart,
                    notepadId: currentNotepadId
                }));
            }
        };
    };

    // Add handleWebSocketMessage function before setupWebSocket
    const handleWebSocketMessage = (event) => {
        const message = JSON.parse(event.data);

        switch (message.type) {
            case 'operation':
                if (message.notepadId === currentNotepadId && message.userId !== userId) {
                    isReceivingUpdate = true;
                    const operation = transformOperation(message.operation, {
                        revision: revision - 1
                    });
                    editor.value = applyOperation(operation, editor.value);
                    editor.previousValue = editor.value;
                    isReceivingUpdate = false;
                }
                break;

            case 'cursor':
                if (message.notepadId === currentNotepadId && message.userId !== userId) {
                    updateCursorPosition(message.userId, message.position, message.color);
                }
                break;

            case 'notepad_change':
                loadNotepads().then(() => {
                    if (notepadSelector.value !== currentNotepadId) {
                        currentNotepadId = notepadSelector.value;
                        loadNotes(currentNotepadId);
                    }
                });
                break;

            case 'update':
                if (message.notepadId === currentNotepadId && message.userId !== userId) {
                    isReceivingUpdate = true;
                    editor.value = message.content;
                    editor.previousValue = editor.value;
                    isReceivingUpdate = false;
                }
                break;
        }
    };

    // Initialize WebSocket connection
    setupWebSocket();

    // Start the app immediately since PIN verification is handled by the server
    initializeApp();
}); 