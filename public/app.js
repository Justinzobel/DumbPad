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
    
    // Collaborative editing state
    const userId = Math.random().toString(36).substring(2, 15);
    const userColor = getRandomColor();
    const remoteUsers = new Map(); // Store other users' colors and cursors
    let lastCursorUpdate = 0;
    const CURSOR_UPDATE_INTERVAL = 50; // More frequent cursor updates
    
    // Operation management
    let localVersion = 0;  // Local operation counter
    let serverVersion = 0; // Last acknowledged server version
    const pendingOperations = new Map(); // Map of operation ID to operation
    let nextOperationId = 0;

    // Operation Types
    const OperationType = {
        INSERT: 'insert',
        DELETE: 'delete'
    };

    // Create an operation object with unique ID
    function createOperation(type, position, text = '') {
        const operationId = nextOperationId++;
        const operation = {
            id: operationId,
            type,
            position,
            text,
            userId,
            localVersion: localVersion++,
            serverVersion,
            timestamp: Date.now()
        };
        pendingOperations.set(operationId, operation);
        return operation;
    }

    // Apply an operation to the text
    function applyOperation(operation, text) {
        let result;
        switch (operation.type) {
            case OperationType.INSERT:
                result = text.slice(0, operation.position) + operation.text + text.slice(operation.position);
                break;
            case OperationType.DELETE:
                result = text.slice(0, operation.position) + text.slice(operation.position + operation.text.length);
                break;
            default:
                result = text;
        }
        return result;
    }

    // Handle operation acknowledgment
    function handleOperationAck(operationId, serverVer) {
        if (pendingOperations.has(operationId)) {
            console.log('Operation acknowledged:', operationId, 'server version:', serverVer);
            const operation = pendingOperations.get(operationId);
            operation.serverVersion = serverVer;
            pendingOperations.delete(operationId);
            serverVersion = Math.max(serverVersion, serverVer);
        }
    }

    // Send operation to server with retry logic
    function sendOperation(operation) {
        if (ws && ws.readyState === WebSocket.OPEN && !isReceivingUpdate) {
            console.log('Sending operation:', operation);
            ws.send(JSON.stringify({
                type: 'operation',
                operation,
                notepadId: currentNotepadId,
                userId
            }));

            // Set up retry if no acknowledgment received
            const retryTimeout = setTimeout(() => {
                if (pendingOperations.has(operation.id)) {
                    console.log('Operation not acknowledged, retrying:', operation.id);
                    sendOperation(operation);
                }
            }, 3000); // Retry after 3 seconds

            // Clear retry timeout if operation is acknowledged
            operation.retryTimeout = retryTimeout;
        }
    }

    // Transform operation against another operation with improved handling
    function transformOperation(operation, against) {
        if (operation.timestamp < against.timestamp) {
            return operation;
        }

        let newOperation = { ...operation };

        if (against.type === OperationType.INSERT) {
            if (operation.position > against.position) {
                newOperation.position += against.text.length;
            } else if (operation.position === against.position) {
                // For concurrent insertions at the same position,
                // order by user ID to ensure consistency
                if (operation.userId > against.userId) {
                    newOperation.position += against.text.length;
                }
            }
        } else if (against.type === OperationType.DELETE) {
            if (operation.type === OperationType.INSERT) {
                // Handle insert against delete
                if (operation.position >= against.position + against.text.length) {
                    newOperation.position -= against.text.length;
                } else if (operation.position > against.position) {
                    newOperation.position = against.position;
                }
            } else if (operation.type === OperationType.DELETE) {
                // Handle delete against delete
                if (operation.position >= against.position + against.text.length) {
                    newOperation.position -= against.text.length;
                } else if (operation.position + operation.text.length <= against.position) {
                    // No change needed
                } else {
                    // Handle overlapping deletions
                    const overlapStart = Math.max(operation.position, against.position);
                    const overlapEnd = Math.min(
                        operation.position + operation.text.length,
                        against.position + against.text.length
                    );
                    const overlap = overlapEnd - overlapStart;
                    
                    if (operation.position < against.position) {
                        // Our deletion starts before the other deletion
                        newOperation.text = operation.text.slice(0, against.position - operation.position);
                    } else {
                        // Our deletion starts within or after the other deletion
                        newOperation.position = against.position;
                        newOperation.text = operation.text.slice(overlap);
                    }
                    
                    if (newOperation.text.length === 0) {
                        return null; // Operation is no longer needed
                    }
                }
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
        cursor.style.color = color;
        
        const label = document.createElement('div');
        label.className = 'remote-cursor-label';
        label.style.color = color;
        label.setAttribute('data-user', `User ${userId.substr(0, 4)}`);
        
        cursor.appendChild(label);
        
        // Ensure the editor container exists
        const container = document.querySelector('.editor-container');
        if (!container) {
            console.error('Editor container not found');
            return null;
        }

        // Create selection container if it doesn't exist
        let selectionContainer = container.querySelector('.remote-selection-container');
        if (!selectionContainer) {
            selectionContainer = document.createElement('div');
            selectionContainer.className = 'remote-selection-container';
            container.appendChild(selectionContainer);
        }
        
        container.appendChild(cursor);
        console.log('Created remote cursor for user:', userId, 'color:', color);
        
        // Store user information
        remoteUsers.set(userId, { color, cursor, selections: [] });
        return cursor;
    }

    // Update remote user's selection
    function updateRemoteSelection(userId, start, end, color) {
        if (start === end) {
            clearRemoteSelections(userId);
            return;
        }

        const userInfo = remoteUsers.get(userId);
        if (!userInfo) return;

        // Clear previous selections
        clearRemoteSelections(userId);

        const container = document.querySelector('.remote-selection-container');
        if (!container) return;

        const text = editor.value;
        const selectionRects = calculateSelectionRects(text, start, end);
        
        userInfo.selections = selectionRects.map(rect => {
            const selection = document.createElement('div');
            selection.className = 'remote-selection';
            selection.style.color = color;
            selection.style.transform = `translate3d(${rect.left}px, ${rect.top - editor.scrollTop}px, 0)`;
            selection.style.width = `${rect.width}px`;
            selection.style.height = `${rect.height}px`;
            container.appendChild(selection);
            return selection;
        });
    }

    // Clear selections for a user
    function clearRemoteSelections(userId) {
        const userInfo = remoteUsers.get(userId);
        if (!userInfo) return;

        userInfo.selections.forEach(selection => selection.remove());
        userInfo.selections = [];
    }

    // Calculate selection rectangle positions
    function calculateSelectionRects(text, start, end) {
        const rects = [];
        const lines = text.slice(0, end).split('\n');
        const startLine = text.slice(0, start).split('\n').length - 1;
        const endLine = lines.length - 1;
        
        updateTextMetrics();
        const lineHeight = textMetrics.lineHeight;
        const editorPadding = parseFloat(getComputedStyle(editor).paddingLeft);

        for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
            const lineStart = text.split('\n').slice(0, lineNum).join('\n').length + (lineNum > 0 ? 1 : 0);
            const lineText = lines[lineNum];
            const lineEnd = lineStart + lineText.length;

            let selectionStart = Math.max(start - lineStart, 0);
            let selectionEnd = lineNum === endLine ? end - lineStart : lineText.length;

            if (selectionStart < selectionEnd) {
                // Measure text widths
                textMetrics.measurementDiv.textContent = lineText.substring(0, selectionStart);
                const startX = textMetrics.measurementDiv.offsetWidth;
                
                textMetrics.measurementDiv.textContent = lineText.substring(selectionStart, selectionEnd);
                const width = textMetrics.measurementDiv.offsetWidth;

                rects.push({
                    top: lineNum * lineHeight,
                    left: editorPadding + startX,
                    width: width,
                    height: lineHeight
                });
            }
        }

        return rects;
    }

    // Cache for text measurements
    let textMetrics = {
        lineHeight: 0,
        charWidth: 0,
        lastUpdate: 0,
        measurementDiv: null
    };

    // Initialize text measurements with debug logging
    function initializeTextMetrics() {
        const style = getComputedStyle(editor);
        textMetrics.measurementDiv = document.createElement('div');
        Object.assign(textMetrics.measurementDiv.style, {
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
        document.body.appendChild(textMetrics.measurementDiv);
        updateTextMetrics();
        
        // Debug text metrics initialization
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

    // Update text measurements periodically
    function updateTextMetrics() {
        const now = Date.now();
        if (now - textMetrics.lastUpdate > 5000) { // Update every 5 seconds
            const style = getComputedStyle(editor);
            textMetrics.lineHeight = parseFloat(style.lineHeight);
            if (isNaN(textMetrics.lineHeight)) {
                textMetrics.lineHeight = parseFloat(style.fontSize) * 1.2;
            }
            textMetrics.measurementDiv.textContent = 'X';
            textMetrics.charWidth = textMetrics.measurementDiv.offsetWidth;
            textMetrics.lastUpdate = now;
        }
    }

    // Update cursor position with improved measurements
    function updateCursorPosition(userId, position, color, selectionEnd) {
        if (userId === window.userId) return;
        
        let userInfo = remoteUsers.get(userId);
        let cursor;
        
        if (!userInfo) {
            cursor = createRemoteCursor(userId, color);
            if (!cursor) return; // Exit if cursor creation failed
        } else {
            cursor = userInfo.cursor;
            if (color !== userInfo.color) {
                cursor.style.color = color;
                cursor.querySelector('.remote-cursor-label').style.color = color;
                userInfo.color = color;
            }
        }

        // Update selection if provided
        if (typeof selectionEnd !== 'undefined') {
            updateRemoteSelection(userId, position, selectionEnd, color);
        }

        // Get text up to cursor position
        const text = editor.value.substring(0, position);
        const lines = text.split('\n');
        const currentLine = lines.length;
        const currentLineStart = text.lastIndexOf('\n') + 1;
        const currentLineText = text.slice(currentLineStart);
        
        updateTextMetrics();
        
        // Debug measurements
        console.log('Cursor position debug:', {
            userId,
            position,
            currentLine,
            currentLineText,
            lineHeight: textMetrics.lineHeight,
            charWidth: textMetrics.charWidth
        });
        
        // Measure current line
        textMetrics.measurementDiv.textContent = currentLineText;
        const left = textMetrics.measurementDiv.offsetWidth;
        
        const editorRect = editor.getBoundingClientRect();
        const containerRect = document.querySelector('.editor-container').getBoundingClientRect();
        const scrollTop = editor.scrollTop;
        
        // Calculate position relative to the editor's padding
        const editorPadding = parseFloat(getComputedStyle(editor).paddingLeft);
        const relativeLeft = editorPadding + left;
        const relativeTop = currentLine * textMetrics.lineHeight - textMetrics.lineHeight * 0.1; // Adjust for proper line alignment
        
        // Store position for scroll updates
        cursor.dataset.position = position;
        
        // Debug positioning
        console.log('Cursor positioning debug:', {
            measurements: {
                left,
                editorPadding,
                lineHeight: textMetrics.lineHeight,
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
        
        // Apply position with smooth transition
        cursor.style.transform = `translate3d(${relativeLeft}px, ${relativeTop - scrollTop}px, 0)`;
        cursor.style.height = `${textMetrics.lineHeight * 0.9}px`; // Slightly shorter than line height
        cursor.style.display = 'block'; // Ensure cursor is visible
    }

    // Track cursor position and selection with debounce
    let cursorUpdateTimeout;
    function updateLocalCursor() {
        clearTimeout(cursorUpdateTimeout);
        cursorUpdateTimeout = setTimeout(() => {
            const now = Date.now();
            if (now - lastCursorUpdate < CURSOR_UPDATE_INTERVAL) return;
            
            lastCursorUpdate = now;
            if (ws && ws.readyState === WebSocket.OPEN) {
                const position = editor.selectionStart;
                const selectionEnd = editor.selectionEnd;
                console.log('Sending cursor update, position:', position, 'selection end:', selectionEnd);
                ws.send(JSON.stringify({
                    type: 'cursor',
                    userId: userId,
                    color: userColor,
                    position: position,
                    selectionEnd: selectionEnd,
                    notepadId: currentNotepadId
                }));
            }
        }, 50); // 50ms debounce
    }

    // Initialize text metrics when the page loads
    initializeTextMetrics();

    // Track cursor position and selection
    editor.addEventListener('mouseup', updateLocalCursor);
    editor.addEventListener('keyup', updateLocalCursor);
    editor.addEventListener('click', updateLocalCursor);
    editor.addEventListener('scroll', () => {
        // Update all remote cursors and selections on scroll
        remoteUsers.forEach((userInfo, userId) => {
            const position = parseInt(userInfo.cursor.dataset.position);
            const selectionEnd = parseInt(userInfo.cursor.dataset.selectionEnd);
            if (!isNaN(position)) {
                updateCursorPosition(userId, position, userInfo.color, selectionEnd);
            }
        });
    });

    // Handle text input events
    editor.addEventListener('input', (e) => {
        console.log('Input event:', e.inputType, 'at position:', e.target.selectionStart);
        
        if (isReceivingUpdate) {
            console.log('Ignoring input event during remote update');
            return;
        }

        const target = e.target;
        const changeStart = target.selectionStart;
        const changeEnd = target.selectionEnd;
        
        // Handle different types of input
        if (e.inputType.startsWith('delete')) {
            // Calculate what was deleted by comparing with previous value
            const lengthDiff = previousEditorValue.length - target.value.length;
            
            // For bulk deletions (e.g., selecting text and pressing delete/backspace)
            // or continuous delete (holding delete key)
            if (lengthDiff > 0) {
                let deletedContent;
                let deletePosition;
                
                if (e.inputType === 'deleteContentBackward') {
                    // Backspace: deletion happens before cursor
                    deletePosition = changeStart;
                    deletedContent = previousEditorValue.substring(deletePosition, deletePosition + lengthDiff);
                } else {
                    // Delete key: deletion happens at cursor
                    deletePosition = changeStart;
                    deletedContent = previousEditorValue.substring(deletePosition, deletePosition + lengthDiff);
                }
                
                const operation = createOperation(
                    OperationType.DELETE,
                    deletePosition,
                    deletedContent
                );
                console.log('Created DELETE operation:', operation);
                sendOperation(operation);
            }
        } else {
            // For insertions, we need to determine what was actually inserted
            let insertedText;
            
            if (e.inputType === 'insertFromPaste') {
                // Handle pasted text
                insertedText = target.value.substring(changeStart - e.data.length, changeStart);
            } else if (e.inputType === 'insertLineBreak') {
                // Handle line breaks
                insertedText = '\n';
            } else {
                // Handle normal typing and other insertions
                insertedText = e.data || target.value.substring(changeStart - 1, changeStart);
            }
            
            const operation = createOperation(
                OperationType.INSERT,
                changeStart - insertedText.length,
                insertedText
            );
            console.log('Created INSERT operation:', operation);
            sendOperation(operation);
        }

        // Update previous value for next comparison
        previousEditorValue = target.value;
        
        debouncedSave(target.value);
        updateLocalCursor();
    });

    // Store previous editor value for detecting deletions
    let previousEditorValue = editor.value;
    
    // Handle composition events (for IME input)
    editor.addEventListener('compositionstart', () => {
        isReceivingUpdate = true;
    });
    
    editor.addEventListener('compositionend', (e) => {
        isReceivingUpdate = false;
        // Create a single operation for the entire composition
        const target = e.target;
        const endPosition = target.selectionStart;
        const composedText = e.data;
        
        if (composedText) {
            const operation = createOperation(
                OperationType.INSERT,
                endPosition - composedText.length,
                composedText
            );
            console.log('Created composition operation:', operation);
            sendOperation(operation);
        }
        
        debouncedSave(target.value);
        updateLocalCursor();
    });

    // WebSocket message handling
    const setupWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        console.log('Attempting WebSocket connection to:', wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received WebSocket message:', data);
                
                if (data.type === 'cursor' && data.notepadId === currentNotepadId) {
                    console.log('Updating cursor for user:', data.userId, 'at position:', data.position);
                    updateCursorPosition(data.userId, data.position, data.color, data.selectionEnd);
                }
                else if (data.type === 'ack') {
                    console.log('Operation acknowledged:', data.operationId);
                    handleOperationAck(data.operationId, data.serverVersion);
                }
                else if (data.type === 'operation' && data.notepadId === currentNotepadId) {
                    if (data.userId !== userId) {
                        console.log('Applying remote operation:', data.operation);
                        isReceivingUpdate = true;
                        
                        // Transform operation against pending operations
                        let operation = data.operation;
                        const pendingOps = Array.from(pendingOperations.values())
                            .sort((a, b) => a.timestamp - b.timestamp);
                        
                        for (const pending of pendingOps) {
                            const transformed = transformOperation(operation, pending);
                            if (transformed) {
                                operation = transformed;
                            } else {
                                console.log('Operation was nullified by transformation');
                                isReceivingUpdate = false;
                                return;
                            }
                        }
                        
                        // Save current cursor position
                        const currentPos = editor.selectionStart;
                        const currentEnd = editor.selectionEnd;
                        
                        // Apply the operation
                        editor.value = applyOperation(operation, editor.value);
                        
                        // Adjust cursor position based on operation type and position
                        let newPos = currentPos;
                        let newEnd = currentEnd;
                        
                        if (operation.type === OperationType.INSERT) {
                            if (operation.position < currentPos) {
                                newPos += operation.text.length;
                                newEnd += operation.text.length;
                            }
                        } else if (operation.type === OperationType.DELETE) {
                            if (operation.position < currentPos) {
                                newPos = Math.max(operation.position, 
                                    currentPos - operation.text.length);
                                newEnd = Math.max(operation.position, 
                                    currentEnd - operation.text.length);
                            }
                        }
                        
                        // Restore adjusted cursor position
                        editor.setSelectionRange(newPos, newEnd);
                        
                        isReceivingUpdate = false;
                        updateLocalCursor();
                    }
                }
                else if (data.type === 'notepad_change') {
                    loadNotepads();
                }
                else if (data.type === 'user_disconnected') {
                    handleUserDisconnection(data.userId);
                }
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed, cleaning up cursors');
            remoteUsers.forEach(userInfo => userInfo.cursor.remove());
            remoteUsers.clear();
            setTimeout(setupWebSocket, 5000);
        };

        ws.onopen = () => {
            console.log('WebSocket connection established');
            updateLocalCursor();
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
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

    // Handle user disconnection
    function handleUserDisconnection(userId) {
        console.log('User disconnected:', userId);
        const userInfo = remoteUsers.get(userId);
        if (userInfo) {
            userInfo.cursor.remove();
            remoteUsers.delete(userId);
        }
    }

    // Initialize WebSocket connection
    setupWebSocket();

    // Start the app immediately since PIN verification is handled by the server
    initializeApp();
}); 