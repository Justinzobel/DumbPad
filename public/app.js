document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('editor');
    const themeToggle = document.getElementById('theme-toggle');
    const saveStatus = document.getElementById('save-status');
    const notepadSelector = document.getElementById('notepad-selector');
    const newNotepadBtn = document.getElementById('new-notepad');
    const renameNotepadBtn = document.getElementById('rename-notepad');
    const downloadNotepadBtn = document.getElementById('download-notepad');
    const deleteNotepadBtn = document.getElementById('delete-notepad');
    const renameModal = document.getElementById('rename-modal');
    const deleteModal = document.getElementById('delete-modal');
    const renameInput = document.getElementById('rename-input');
    const renameCancel = document.getElementById('rename-cancel');
    const renameConfirm = document.getElementById('rename-confirm');
    const deleteCancel = document.getElementById('delete-cancel');
    const deleteConfirm = document.getElementById('delete-confirm');
    const downloadNotepadBtn = document.getElementById('download-notepad');
    const printNotepadBtn = document.getElementById('print-notepad');
    
    let saveTimeout;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 10000; // Save every 10 seconds while typing
    let currentNotepadId = 'default';
    let verifiedPin = null;
    let pinLength = 4;
    let pinDigits = [];
    let baseUrl = '';

    // Create PIN input boxes
    function createPinInputs(length) {
        pinContainer.innerHTML = '';
        pinDigits = [];
        
        for (let i = 0; i < length; i++) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pin-digit';
            input.maxLength = 1;
            input.pattern = '[0-9]';
            input.inputMode = 'numeric';
            input.autocomplete = 'off';
            
            input.addEventListener('input', (e) => handlePinInput(e, i));
            input.addEventListener('keydown', (e) => handlePinKeydown(e, i));
            input.addEventListener('paste', (e) => e.preventDefault());
            
            pinContainer.appendChild(input);
            pinDigits.push(input);
        }
    }

    // Check if PIN is required
    const checkPinRequired = async () => {
        try {
            const response = await fetch(`${baseUrl}/api/pin-required`);
            const { required, length } = await response.json();
            if (required) {
                pinLength = length;
                createPinInputs(length);
                pinModal.classList.add('visible');
            } else {
                initializeApp();
            }
        } catch (err) {
            console.error('Error checking PIN requirement:', err);
        }
    };

    // Handle PIN input
    const handlePinInput = (e, index) => {
        const input = e.target;
        const value = input.value;

        // Only allow numbers
        if (!/^\d*$/.test(value)) {
            input.value = '';
            return;
        }

        if (value) {
            input.classList.add('filled');
            // Move to next input if available
            if (index < pinDigits.length - 1) {
                pinDigits[index + 1].focus();
            } else if (index === pinDigits.length - 1) {
                // If this is the last digit and it's filled
                const pin = Array.from(pinDigits).map(digit => digit.value).join('');
                if (pin.length === pinLength) {
                    // Add a small delay to show the last digit being filled
                    setTimeout(() => {
                        verifyPin(pin);
                    }, 150);
                }
            }
        } else {
            input.classList.remove('filled');
        }
    };

    const handlePinKeydown = (e, index) => {
        // Handle backspace
        if (e.key === 'Backspace' && !e.target.value) {
            if (index > 0) {
                pinDigits[index - 1].focus();
                pinDigits[index - 1].value = '';
                pinDigits[index - 1].classList.remove('filled');
            }
        }
        // Handle left arrow
        else if (e.key === 'ArrowLeft' && index > 0) {
            pinDigits[index - 1].focus();
        }
        // Handle right arrow
        else if (e.key === 'ArrowRight' && index < pinDigits.length - 1) {
            pinDigits[index + 1].focus();
        }
        // Handle enter
        else if (e.key === 'Enter') {
            submitPin();
        }
    };

    const submitPin = () => {
        const pin = Array.from(pinDigits).map(digit => digit.value).join('');
        if (pin.length === pinLength) {
            verifyPin(pin);
        }
    };

    // Clear PIN inputs
    const clearPinInputs = () => {
        pinDigits.forEach(digit => {
            digit.value = '';
            digit.classList.remove('filled');
        });
        pinDigits[0].focus();
    };

    // Set up PIN input event listeners
    pinDigits.forEach((digit, index) => {
        digit.addEventListener('input', (e) => handlePinInput(e, index));
        digit.addEventListener('keydown', (e) => handlePinKeydown(e, index));
        // Prevent copy/paste
        digit.addEventListener('paste', (e) => e.preventDefault());
    });

    // Update verifyPin function
    const verifyPin = async (pin) => {
        try {
            const response = await fetch(`${baseUrl}/api/verify-pin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pin }),
            });

            const data = await response.json();
            if (data.success) {
                verifiedPin = pin;
                pinModal.classList.remove('visible');
                pinError.textContent = '';
                initializeApp();
            } else {
                pinError.textContent = 'Invalid PIN';
                clearPinInputs();
            }
        } catch (err) {
            console.error('Error verifying PIN:', err);
            pinError.textContent = 'Error verifying PIN';
            clearPinInputs();
        }
    };

    // Update PIN submit button handler
    pinSubmit.addEventListener('click', submitPin);

    // Focus first PIN input when modal is shown
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.classList.contains('visible')) {
                pinDigits[0].focus();
            }
        });
    });

    observer.observe(pinModal, { attributes: true, attributeFilter: ['class'] });

    let baseUrl = '';

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
        }, 1000);
    };

    // Event Listeners
    editor.addEventListener('input', (e) => {
        debouncedSave(e.target.value);
        checkPeriodicSave(e.target.value);
    });

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

    // Initialize the app after PIN verification
    const initializeApp = () => {
        // Fetch site configuration
        fetch(`${baseUrl}/api/config`)
            .then(response => response.json())
            .then(config => {
                document.getElementById('site-title').textContent = config.siteTitle;
                document.getElementById('page-title').textContent = `${config.siteTitle} - Simple Notes`;
                document.getElementById('header-title').textContent = config.siteTitle;
                baseUrl = config.baseUrl;
            })
            .catch(err => console.error('Error loading site configuration:', err));

        // Event Listeners
        editor.addEventListener('input', (e) => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                saveNotes(e.target.value);
            }, 1000);
        });

        notepadSelector.addEventListener('change', (e) => {
            currentNotepadId = e.target.value;
            loadNotes(currentNotepadId);
        });

        newNotepadBtn.addEventListener('click', createNotepad);
        downloadNotepadBtn.addEventListener('click', downloadNotepad);
        printNotepadBtn.addEventListener('click', printNotepad);

        renameNotepadBtn.addEventListener('click', () => {
            const currentNotepad = notepadSelector.options[notepadSelector.selectedIndex];
            renameInput.value = currentNotepad.text;
            renameModal.classList.add('visible');
        });

        deleteNotepadBtn.addEventListener('click', () => {
            if (currentNotepadId === 'default') {
                alert('Cannot delete the default notepad');
                return;
            }
            deleteModal.classList.add('visible');
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

        deleteCancel.addEventListener('click', () => {
            deleteModal.classList.remove('visible');
        });

        deleteConfirm.addEventListener('click', async () => {
            await deleteNotepad();
            deleteModal.classList.remove('visible');
        });

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

    // Initialize the app
    const initializeApp = () => {
        // Fetch site configuration
        fetch(`/api/config`)
            .then(response => response.json())
            .then(config => {
                document.getElementById('page-title').textContent = `${config.siteTitle} - Simple Notes`;
                document.getElementById('header-title').textContent = config.siteTitle;
                baseUrl = config.baseUrl;

                // Event Listeners
                editor.addEventListener('input', (e) => {
                    debouncedSave(e.target.value);
                    checkPeriodicSave(e.target.value);
                });

                notepadSelector.addEventListener('change', (e) => {
                    currentNotepadId = e.target.value;
                    loadNotes(currentNotepadId);
                });

                newNotepadBtn.addEventListener('click', createNotepad);
                if (downloadNotepadBtn) downloadNotepadBtn.addEventListener('click', downloadNotepad);
                if (printNotepadBtn) printNotepadBtn.addEventListener('click', printNotepad);

                renameNotepadBtn.addEventListener('click', () => {
                    const currentNotepad = notepadSelector.options[notepadSelector.selectedIndex];
                    renameInput.value = currentNotepad.text;
                    renameModal.classList.add('visible');
                });

                deleteNotepadBtn.addEventListener('click', () => {
                    if (currentNotepadId === 'default') {
                        alert('Cannot delete the default notepad');
                        return;
                    }
                    deleteModal.classList.add('visible');
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

                deleteCancel.addEventListener('click', () => {
                    deleteModal.classList.remove('visible');
                });

                deleteConfirm.addEventListener('click', async () => {
                    await deleteNotepad();
                    deleteModal.classList.remove('visible');
                });

                document.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                        e.preventDefault();
                        saveNotes(editor.value);
                    }
                });

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


    // Start the app immediately since PIN verification is handled by the server
    initializeApp();
}); 