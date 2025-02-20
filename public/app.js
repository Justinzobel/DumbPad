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
    
    // Theme handling
    const THEME_KEY = 'dumbpad_theme';
    let currentTheme = localStorage.getItem(THEME_KEY) || 'light';
    
    // Apply initial theme
    document.body.classList.toggle('dark-mode', currentTheme === 'dark');
    themeToggle.innerHTML = currentTheme === 'dark' ? '<span class="sun">☀</span>' : '<span class="moon">☽</span>';
    
    // Theme toggle handler
    themeToggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.body.classList.toggle('dark-mode');
        themeToggle.innerHTML = currentTheme === 'dark' ? '<span class="sun">☀</span>' : '<span class="moon">☽</span>';
        localStorage.setItem(THEME_KEY, currentTheme);
    });

    let saveTimeout;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 2000;
    let currentNotepadId = 'default';
    let baseUrl = '';
    let ws = null;
    let isReceivingUpdate = false;
    let version = 0;  // Document version for OT
    let pendingOperations = [];  // Queue of pending operations
    
    // Collaborative editing state
    const userId = Math.random().toString(36).substring(2, 15);
    const userColor = getRandomColor();
    const remoteCursors = new Map(); // Store other users' cursors
    let lastCursorUpdate = 0;
    const CURSOR_UPDATE_INTERVAL = 50; // More frequent cursor updates

    // Operation Types
    const OperationType = {
        INSERT: 'insert',
        DELETE: 'delete'
    };

    // Create an operation object
    function createOperation(type, position, text = '') {
        return {
            type,
            position,
            text,
            userId,
            version: version++,
            timestamp: Date.now()
        };
    }

    // Apply an operation to the text
    function applyOperation(operation, text) {
        switch (operation.type) {
            case OperationType.INSERT:
                return text.slice(0, operation.position) + operation.text + text.slice(operation.position);
            case OperationType.DELETE:
                return text.slice(0, operation.position) + text.slice(operation.position + operation.text.length);
            default:
                return text;
        }
    }

    // Transform operation against another operation
    function transformOperation(operation, against) {
        if (operation.timestamp < against.timestamp) {
            return operation;
        }

        let newOperation = { ...operation };

        if (against.type === OperationType.INSERT) {
            if (operation.position > against.position) {
                newOperation.position += against.text.length;
            }
        } else if (against.type === OperationType.DELETE) {
            if (operation.position > against.position) {
                newOperation.position -= against.text.length;
            }
        }

        return newOperation;
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

    // Event Listeners
    editor.addEventListener('input', (e) => {
        const target = e.target;
        const changeStart = target.selectionStart;
        const changeEnd = target.selectionEnd;
        
        // Determine if it's an insertion or deletion
        if (e.inputType.includes('delete')) {
            const operation = createOperation(OperationType.DELETE, changeStart, e.target.value.substring(changeStart, changeEnd));
            sendOperation(operation);
        } else {
            const insertedText = e.target.value.substring(changeStart - 1, changeStart);
            const operation = createOperation(OperationType.INSERT, changeStart - 1, insertedText);
            sendOperation(operation);
        }

        debouncedSave(e.target.value);
        updateLocalCursor();
    });

    // Send operation to server
    function sendOperation(operation) {
        if (ws && ws.readyState === WebSocket.OPEN && !isReceivingUpdate) {
            ws.send(JSON.stringify({
                type: 'operation',
                operation,
                notepadId: currentNotepadId,
                userId
            }));
        }
    }

    // Track cursor position and selection
    editor.addEventListener('mouseup', updateLocalCursor);
    editor.addEventListener('keyup', updateLocalCursor);
    editor.addEventListener('click', updateLocalCursor);
    editor.addEventListener('scroll', updateCursorPositions); // Update cursors on scroll

    function updateLocalCursor() {
        const now = Date.now();
        if (now - lastCursorUpdate < CURSOR_UPDATE_INTERVAL) return;
        
        lastCursorUpdate = now;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'cursor',
                userId: userId,
                color: userColor,
                position: editor.selectionStart,
                notepadId: currentNotepadId
            }));
        }
    }

    function updateCursorPositions() {
        remoteCursors.forEach((cursor, userId) => {
            const position = parseInt(cursor.dataset.position);
            if (!isNaN(position)) {
                updateCursorPosition(userId, position);
            }
        });
    }

    // Update cursor position with improved positioning
    function updateCursorPosition(userId, position) {
        if (userId === window.userId) return;
        
        let cursor = remoteCursors.get(userId);
        if (!cursor) {
            cursor = createRemoteCursor(userId, getRandomColor());
            remoteCursors.set(userId, cursor);
        }

        cursor.dataset.position = position;

        const textArea = editor;
        const text = textArea.value.substring(0, position);
        const lines = text.split('\n');
        const currentLine = lines.length;
        const currentLineStart = text.lastIndexOf('\n') + 1;
        const currentLineText = text.slice(currentLineStart);
        
        // Create a hidden div to measure text
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        div.style.whiteSpace = 'pre';
        div.style.font = getComputedStyle(textArea).font;
        div.textContent = currentLineText;
        document.body.appendChild(div);
        
        const rect = textArea.getBoundingClientRect();
        const lineHeight = parseInt(getComputedStyle(textArea).lineHeight);
        const scrollTop = textArea.scrollTop;
        
        const left = div.offsetWidth;
        const top = (currentLine - 1) * lineHeight - scrollTop;
        
        document.body.removeChild(div);

        cursor.style.transform = `translate(${left + rect.left + textArea.scrollLeft}px, ${top + rect.top}px)`;
        cursor.style.height = `${lineHeight}px`;
    }

    // WebSocket message handling
    const setupWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'cursor' && data.notepadId === currentNotepadId) {
                    updateCursorPosition(data.userId, data.position);
                }
                else if (data.type === 'operation' && data.notepadId === currentNotepadId) {
                    if (data.userId !== userId) {
                        isReceivingUpdate = true;
                        
                        // Transform and apply the operation
                        let operation = data.operation;
                        for (const pending of pendingOperations) {
                            operation = transformOperation(operation, pending);
                        }
                        
                        const currentPos = editor.selectionStart;
                        editor.value = applyOperation(operation, editor.value);
                        
                        // Adjust cursor position if needed
                        if (operation.type === OperationType.INSERT && currentPos > operation.position) {
                            editor.setSelectionRange(currentPos + operation.text.length, currentPos + operation.text.length);
                        } else if (operation.type === OperationType.DELETE && currentPos > operation.position) {
                            editor.setSelectionRange(currentPos - operation.text.length, currentPos - operation.text.length);
                        } else {
                            editor.setSelectionRange(currentPos, currentPos);
                        }
                        
                        isReceivingUpdate = false;
                        updateLocalCursor();
                    }
                }
                else if (data.type === 'notepad_change') {
                    loadNotepads();
                }
                else if (data.type === 'user_disconnected') {
                    const cursor = remoteCursors.get(data.userId);
                    if (cursor) {
                        cursor.remove();
                        remoteCursors.delete(data.userId);
                    }
                }
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        };

        ws.onclose = () => {
            remoteCursors.forEach(cursor => cursor.remove());
            remoteCursors.clear();
            setTimeout(setupWebSocket, 5000);
        };

        ws.onopen = () => {
            updateLocalCursor();
        };
    };

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

    // Initialize WebSocket connection
    setupWebSocket();

    // Start the app immediately since PIN verification is handled by the server
    initializeApp();
}); 