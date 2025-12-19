import './style.css';
import './dip-switch.css';
import './dip-switch.js';
import './dip-switch-group.css';
import './dip-switch-group.js';
import { SequencerClock } from './sequencer-clock.js';
import { SamplePlayer } from './sample-player.js';

const numRows = 9; // 1 settings row + 8 instrument rows.

// Default values stored by index
const defaultValues = [
	{ settings: 0b0111100000000000, notes: 0 }, // Index 0: SET row
	{ notes: 0b10001000100010001000100010000000 },
	{ notes: 0b1000 },
	{ notes: 0b100000000000000010000000 },
	{ notes: 0b1 },
	{ notes: 0b10000000000000001000000000000000 },
	{ notes: 0b100000000000000010000000 },
	{ notes: 0b10000000000000101000100000100000 },
	{ notes: 0b0 },
].map((row, i) => (i ? { settings: (i - 1) << 8, notes: row.notes } : row));

document.querySelector('#app').innerHTML = `
    <div class="description">
      <p>The observable universe has about 1,000,000,000,000,000,000,000 stars. A single one of these rows has nearly the same number of possible configurations. I know, it surprised me too. How many possible configurations exist if you have five rows hooked together? Let’s put it like this. Imagine each star in our universe contains its own universe full of stars. Enter a star; any star will do. Good choice. Now – see all the stars in this sub-universe? They’re also universes full of stars. We’re getting closer… but we're still about one trevigintillion stars short.</p>
      <p>This machine is full of almost limitless songs. Your job is to discover them.</p>
    </div>
    <div class="circuit-board">
      ${Array.from(
			{ length: numRows },
			(_, i) => `
        <dip-switch-group${i === 0 ? ' data-settings' : ''}></dip-switch-group>
      `
		).join('')}
    </div>
`;

// Set default values after elements are created
Array.from(document.querySelectorAll('dip-switch-group')).forEach((group, i) => {
	if (defaultValues[i] !== undefined) {
		group.value = defaultValues[i];
	}
});

// Initialize sequencer clock
const clock = new SequencerClock();

// Initialize sample player (will be set up after audio context is ready)
let samplePlayer = null;

// Get the SET row (has data-settings flag) and listen for changes
const setRow = document.querySelector('dip-switch-group[data-settings]');

// Expert mode state
let selectedByte = null; // { rowIndex: number, byteIndex: number } | null
let clipboard = null; // { type: 'byte' | 'row', value: number | number[] } | null

// Hold durations
const HOLD_DURATION = 500;
const LONG_HOLD_DURATION = 2000;

// Expert shortcuts registry
const expertShortcuts = {
	pressHandlers: new Map(),
	holdHandlers: new Map(),
	longHoldHandlers: new Map(), // Handlers after 1s
	highlightTimeouts: new Map(), // key -> array of timeout IDs
	keyDownTimes: new Map(), // key -> timestamp
	heldKeys: new Set(), // Keys currently being held
	invalidKeys: new Set(), // Keys that became invalid due to selection change
};

const getAllRowGroups = () => {
	return Array.from(document.querySelectorAll('dip-switch-group'));
};

// Check if expert mode is active
// Expert mode is controlled by bit 1 (2nd from right, labeled "7") of the last byte (byte index 5) of the settings row
const isExpertModeActive = () => {
	if (!setRow) return false;
	const lastByte = setRow.getByte(5); // Last byte is index 5
	if (!lastByte) return false;
	const byteValue = lastByte.value;
	// Bit 1 (0-indexed from right) = data-bit="1" (0-indexed from left)
	// Check if bit 1 is set: (byteValue >> 1) & 0b1
	return ((byteValue >> 1) & 0b1) === 1;
};

// Expose to window for dip-switch hover handler
window.isExpertModeActive = isExpertModeActive;

// Get the currently selected byte element
const getSelectedByteElement = () => {
	if (!selectedByte) return null;
	const groups = getAllRowGroups();
	const group = groups[selectedByte.rowIndex];
	if (!group) return null;
	return group.getByte(selectedByte.byteIndex);
};

// Determine if selected byte is a settings byte (0-1) or notes byte (2-5)
const getSelectedByteType = () => {
	if (!selectedByte) return null;
	if (selectedByte.rowIndex === 0) return 'settingsRow';
	return selectedByte.byteIndex < 2 ? 'settings' : 'notes';
};

// Expose function to set selected byte from hover
window.setSelectedByteFromElement = byteElement => {
	if (!isExpertModeActive()) return;

	// Find the row and byte index for this element
	const groups = getAllRowGroups();
	for (let rowIndex = 0; rowIndex < groups.length; rowIndex++) {
		const group = groups[rowIndex];
		for (let byteIndex = 0; byteIndex < 6; byteIndex++) {
			if (group.getByte(byteIndex) === byteElement) {
				setSelectedByte(rowIndex, byteIndex);
				return;
			}
		}
	}
};

// Expose function to get selected byte element for hover leave check
window.getSelectedByteElement = getSelectedByteElement;

// Expose function to check if a byte element is currently selected
window.isByteSelected = byteElement => {
	const selected = getSelectedByteElement();
	return selected === byteElement;
};

// Set the selected byte and update UI
const setSelectedByte = (rowIndex, byteIndex) => {
	// If selection is changing and there are held keys, invalidate them
	if (selectedByte && (selectedByte.rowIndex !== rowIndex || selectedByte.byteIndex !== byteIndex)) {
		if (expertShortcuts.heldKeys.size > 0) {
			expertShortcuts.heldKeys.forEach(key => {
				expertShortcuts.invalidKeys.add(key);
			});
			clearHighlights();
			expertShortcuts.heldKeys.forEach(key => {
				const timeouts = expertShortcuts.highlightTimeouts.get(key);
				if (timeouts) {
					timeouts.forEach(timeout => clearTimeout(timeout));
					timeouts.length = 0;
				}
			});
		}
	}

	// Remove previous selection
	if (selectedByte) {
		const prevGroups = getAllRowGroups();
		const prevGroup = prevGroups[selectedByte.rowIndex];
		if (prevGroup) {
			const prevByte = prevGroup.getByte(selectedByte.byteIndex);
			if (prevByte) {
				prevByte.classList.remove('expert-focus');
			}
		}
	}

	// Validate indices
	const groups = getAllRowGroups();
	if (rowIndex < 0 || rowIndex >= groups.length) return;
	const group = groups[rowIndex];
	if (!group || byteIndex < 0 || byteIndex >= 6) return;

	// Set new selection
	selectedByte = { rowIndex, byteIndex };
	const byte = group.getByte(byteIndex);
	if (byte) {
		byte.classList.add('expert-focus');
	}
};

// Navigate to adjacent byte with wrapping
const navigateByte = direction => {
	// If no selection, start at first byte of first row
	if (!selectedByte) {
		setSelectedByte(0, 0);
		return;
	}

	const groups = getAllRowGroups();
	const numRows = groups.length;
	const bytesPerRow = 6;

	let newRowIndex = selectedByte.rowIndex;
	let newByteIndex = selectedByte.byteIndex;

	switch (direction) {
		case 'left':
			newByteIndex--;
			if (newByteIndex < 0) {
				newByteIndex = bytesPerRow - 1;
				newRowIndex--;
				if (newRowIndex < 0) newRowIndex = numRows - 1;
			}
			break;
		case 'right':
			newByteIndex++;
			if (newByteIndex >= bytesPerRow) {
				newByteIndex = 0;
				newRowIndex++;
				if (newRowIndex >= numRows) newRowIndex = 0;
			}
			break;
		case 'up':
			newRowIndex--;
			if (newRowIndex < 0) newRowIndex = numRows - 1;
			break;
		case 'down':
			newRowIndex++;
			if (newRowIndex >= numRows) newRowIndex = 0;
			break;
	}

	setSelectedByte(newRowIndex, newByteIndex);
};

// Register an expert mode shortcut
// keys: string or array of strings (e.g., 'c' or ['0', 'z', 'Z'])
// onPress: callback for immediate press action (optional)
// onHold: callback for hold action after 500ms (optional)
// onLongHold: callback for long hold action after 1000ms (optional)
const registerExpertShortcut = (keys, onPress, onHold, onLongHold) => {
	const keyArray = Array.isArray(keys) ? keys : [keys];
	keyArray.forEach(key => {
		const keyLower = key.toLowerCase();
		if (onPress) expertShortcuts.pressHandlers.set(keyLower, onPress);
		if (onHold) expertShortcuts.holdHandlers.set(keyLower, onHold);
		if (onLongHold) expertShortcuts.longHoldHandlers.set(keyLower, onLongHold);
		if (onHold || onLongHold) expertShortcuts.highlightTimeouts.set(keyLower, []);
	});
};

// Copy byte value
const copyByte = byteElement => {
	if (!byteElement) return;
	clipboard = { type: 'byte', value: byteElement.value };
};

// Helper to flash specific bytes in a row
const flashBytes = (rowElement, byteIndices) => {
	if (!rowElement || !byteIndices) return;
	byteIndices.forEach(index => {
		const byte = rowElement.getByte(index);
		if (byte) {
			byte.classList.add('expert-focus');
			setTimeout(() => {
				byte.classList.remove('expert-focus');
			}, 200);
		}
	});
};

// Copy entire row (for long hold)
const copyEntireRow = rowElement => {
	if (!rowElement || !selectedByte) return;
	const bytes = rowElement.getAllBytes();
	if (selectedByte.rowIndex === 0) {
		clipboard = { type: 'settingsRow', value: [...bytes] };
	} else {
		clipboard = { type: 'instrumentRow', value: [...bytes] };
	}
};

// Copy settings bytes (first 2 bytes) - only for instrument rows
const copyInstrumentSettings = rowElement => {
	if (!rowElement) return;
	const bytes = rowElement.getAllBytes();
	clipboard = { type: 'instrumentSettings', value: [bytes[0], bytes[1]] };
	flashBytes(rowElement, [0, 1]);
};

// Copy notes bytes (last 4 bytes) - only for instrument rows
const copyInstrumentNotes = rowElement => {
	if (!rowElement) return;
	const bytes = rowElement.getAllBytes();
	clipboard = { type: 'instrumentNotes', value: [bytes[2], bytes[3], bytes[4], bytes[5]] };
	flashBytes(rowElement, [2, 3, 4, 5]);
};

// Check if clipboard type is valid for current selection
const isValidClipboardForSelection = () => {
	if (!selectedByte || !clipboard) return false;
	const rowIndex = selectedByte.rowIndex;
	const byteIndex = selectedByte.byteIndex;

	if (clipboard.type === 'byte') return true;
	if (rowIndex === 0) return clipboard.type === 'settingsRow';
	if (clipboard.type === 'instrumentRow') return true;
	return byteIndex < 2 === (clipboard.type === 'instrumentSettings');
};

// Paste bytes - handles all paste operations
const pasteBytes = () => {
	if (!clipboard || !selectedByte || !isValidClipboardForSelection()) return;

	const groups = getAllRowGroups();
	const row = groups[selectedByte.rowIndex];
	if (!row) return;

	const rowIndex = selectedByte.rowIndex;
	const byteIndex = selectedByte.byteIndex;
	const bytes = row.getAllBytes();

	if (clipboard.type === 'byte') {
		// Paste single byte to selected byte
		const byte = row.getByte(byteIndex);
		if (byte) byte.value = clipboard.value;
	} else if (clipboard.type === 'settingsRow' && Array.isArray(clipboard.value)) {
		// Paste entire settings row
		if (rowIndex === 0) {
			row.setAllBytes(clipboard.value);
		}
	} else if (clipboard.type === 'instrumentRow' && Array.isArray(clipboard.value)) {
		// Paste entire instrument row
		if (rowIndex > 0) {
			row.setAllBytes(clipboard.value);
		}
	} else if (clipboard.type === 'instrumentSettings' && Array.isArray(clipboard.value)) {
		// Paste instrument settings bytes
		if (rowIndex > 0) {
			bytes[0] = clipboard.value[0] ?? bytes[0];
			bytes[1] = clipboard.value[1] ?? bytes[1];
			row.setAllBytes(bytes);
		}
	} else if (clipboard.type === 'instrumentNotes' && Array.isArray(clipboard.value)) {
		// Paste instrument notes bytes
		if (rowIndex > 0) {
			bytes[2] = clipboard.value[0] ?? bytes[2];
			bytes[3] = clipboard.value[1] ?? bytes[3];
			bytes[4] = clipboard.value[2] ?? bytes[4];
			bytes[5] = clipboard.value[3] ?? bytes[5];
			row.setAllBytes(bytes);
		}
	}
};

// Handle keyboard shortcuts
const handleKeyboardShortcut = (key, event) => {
	if (!isExpertModeActive()) return false;

	const byteElement = getSelectedByteElement();
	if (!byteElement) return false;

	const keyLower = key.toLowerCase();
	const holdHandler = expertShortcuts.holdHandlers.get(keyLower);
	const longHoldHandler = expertShortcuts.longHoldHandlers.get(keyLower);
	const pressHandler = expertShortcuts.pressHandlers.get(keyLower);

	// If there's a hold or longHold handler, set up highlight timeouts
	if (holdHandler || longHoldHandler) {
		if (event.repeat) return false;

		expertShortcuts.heldKeys.add(keyLower);

		// Clear any existing highlights
		clearHighlights();

		// Get timeout array for this key
		const timeouts = expertShortcuts.highlightTimeouts.get(keyLower) || [];

		// Determine which cells to highlight based on key and selection
		if (holdHandler) {
			const timeout = setTimeout(() => {
				if (expertShortcuts.invalidKeys.has(keyLower)) return;
				// Copy: highlight settings or notes bytes
				const byteType = getSelectedByteType();
				if (byteType === 'settings') {
					highlightCells([0, 1]);
				} else if (byteType === 'notes') {
					highlightCells([2, 3, 4, 5]);
				}
			}, HOLD_DURATION);
			timeouts.push(timeout);
		}

		if (longHoldHandler) {
			const timeout = setTimeout(() => {
				if (expertShortcuts.invalidKeys.has(keyLower)) return;
				highlightCells([0, 1, 2, 3, 4, 5]);
			}, LONG_HOLD_DURATION);
			timeouts.push(timeout);
		}

		// Record when key was pressed
		expertShortcuts.keyDownTimes.set(keyLower, Date.now());
		return true;
	}

	// No hold handler, run press handler immediately
	if (pressHandler) {
		pressHandler();
		return true;
	}

	return false;
};

// Clear all highlights
const clearHighlights = () => {
	document.querySelectorAll('.expert-highlight').forEach(el => {
		el.classList.remove('expert-highlight');
	});
};

// Highlight cells that will be affected
const highlightCells = byteIndices => {
	if (!selectedByte) return;
	const groups = getAllRowGroups();
	const row = groups[selectedByte.rowIndex];
	if (!row) return;
	byteIndices.forEach(index => {
		const byte = row.getByte(index);
		if (byte) byte.classList.add('expert-highlight');
	});
};

// Handle keyboard events
const handleKeyDown = e => {
	if (!isExpertModeActive()) return;

	// Handle arrow keys for navigation
	if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
		e.preventDefault();
		const directionMap = {
			ArrowLeft: 'left',
			ArrowRight: 'right',
			ArrowUp: 'up',
			ArrowDown: 'down',
		};
		navigateByte(directionMap[e.key]);
		return;
	}

	// Handle Tab key to focus first bit of selected byte
	if (e.key === 'Tab' && selectedByte && !e.ctrlKey && !e.altKey) {
		const byteElement = getSelectedByteElement();
		if (byteElement) {
			e.preventDefault();
			byteElement.focusFirstBit();
		}
		return;
	}

	// Handle shortcuts (only if not using Ctrl/Alt for browser shortcuts)
	if (!e.metaKey && !e.ctrlKey && !e.altKey) {
		const handled = handleKeyboardShortcut(e.key, e);
		if (handled) {
			e.preventDefault();
		}
	}
};

// Handle key up - check duration and run appropriate handler
const handleKeyUp = e => {
	const keyLower = e.key.toLowerCase();
	const keyDownTime = expertShortcuts.keyDownTimes.get(keyLower);
	expertShortcuts.keyDownTimes.delete(keyLower);
	if (!keyDownTime) return;

	expertShortcuts.heldKeys.delete(keyLower);

	// Clear highlight timeouts
	const timeouts = expertShortcuts.highlightTimeouts.get(keyLower);
	if (timeouts) {
		timeouts.forEach(timeout => clearTimeout(timeout));
		timeouts.length = 0; // Clear the array
	}

	clearHighlights();

	if (expertShortcuts.invalidKeys.has(keyLower)) {
		expertShortcuts.invalidKeys.delete(keyLower);
		return; // Do nothing if keypress was invalidated
	}

	const holdDuration = Date.now() - keyDownTime;
	const longHoldHandler = expertShortcuts.longHoldHandlers.get(keyLower);
	const holdHandler = expertShortcuts.holdHandlers.get(keyLower);
	const pressHandler = expertShortcuts.pressHandlers.get(keyLower);

	if (holdDuration >= LONG_HOLD_DURATION && longHoldHandler) {
		longHoldHandler();
	} else if (holdDuration >= HOLD_DURATION && holdHandler) {
		holdHandler();
	} else if (pressHandler) {
		pressHandler();
	}
};

// Register all expert mode shortcuts
const byteElement = () => getSelectedByteElement();

// B: Decrease binary number
registerExpertShortcut('b', () => {
	const el = byteElement();
	if (el) el.value = Math.max(0, el.value - 1);
});

// G: Increase binary number
registerExpertShortcut('g', () => {
	const el = byteElement();
	if (el) el.value = Math.min(255, el.value + 1);
});

// C: Copy byte (hold for settings/notes, longHold for entire row)
registerExpertShortcut(
	'c',
	() => {
		const el = byteElement();
		if (el) copyByte(el);
	},
	() => {
		const groups = getAllRowGroups();
		if (selectedByte) {
			const row = groups[selectedByte.rowIndex];
			if (!row) return;
			const byteType = getSelectedByteType();
			if (byteType === 'settings') {
				copyInstrumentSettings(row);
			} else if (byteType === 'notes') {
				copyInstrumentNotes(row);
			}
		}
	},
	() => {
		// Long hold (1s): copy entire row
		const groups = getAllRowGroups();
		if (selectedByte) {
			const row = groups[selectedByte.rowIndex];
			if (row) copyEntireRow(row);
		}
	}
);

// V: Paste
registerExpertShortcut('v', () => {
	pasteBytes();
});

// 0/Z: Set byte to 0 (hold for settings/notes/row)
registerExpertShortcut(
	['0', 'z', 'Z'],
	() => {
		const el = byteElement();
		if (el) el.value = 0;
	},
	() => {
		const groups = getAllRowGroups();
		if (selectedByte) {
			const row = groups[selectedByte.rowIndex];
			if (!row) return;
			const byteType = getSelectedByteType();
			const bytes = row.getAllBytes();
			if (byteType === 'settings') {
				bytes[0] = 0;
				bytes[1] = 0;
			} else if (byteType === 'notes') {
				bytes[2] = 0;
				bytes[3] = 0;
				bytes[4] = 0;
				bytes[5] = 0;
			} else {
				bytes.fill(0);
			}
			row.setAllBytes(bytes);
		}
	}
);

// 9/A: Set byte to 255 (hold for settings/notes/row)
registerExpertShortcut(
	['9', 'a', 'A'],
	() => {
		const el = byteElement();
		if (el) el.value = 255;
	},
	() => {
		const groups = getAllRowGroups();
		if (selectedByte) {
			const row = groups[selectedByte.rowIndex];
			if (!row) return;
			const byteType = getSelectedByteType();
			const bytes = row.getAllBytes();
			if (byteType === 'settings') {
				bytes[0] = 255;
				bytes[1] = 255;
			} else if (byteType === 'notes') {
				bytes[2] = 255;
				bytes[3] = 255;
				bytes[4] = 255;
				bytes[5] = 255;
			} else {
				bytes.fill(255);
			}
			row.setAllBytes(bytes);
		}
	}
);

// R: Randomize byte
registerExpertShortcut('r', () => {
	const el = byteElement();
	if (el) el.value = Math.floor(Math.random() * 256);
});

// T: Toggle all bits
registerExpertShortcut('t', () => {
	const el = byteElement();
	if (el) el.value = el.value ^ 0xff;
});

// 1-8: Toggle bits
for (let i = 1; i <= 8; i++) {
	registerExpertShortcut(String(i), () => {
		const el = byteElement();
		if (el) el.toggleBit(i);
	});
}

document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

// Update expert mode state when settings row changes
if (setRow) {
	setRow.addEventListener('change', () => {
		// Clear selection when expert mode is turned off
		if (!isExpertModeActive() && selectedByte) {
			const groups = getAllRowGroups();
			if (selectedByte) {
				const group = groups[selectedByte.rowIndex];
				const byte = group?.getByte(selectedByte.byteIndex);
				byte?.classList.remove('expert-focus');
			}
			selectedByte = null;
		}
	});
}

// Function to get all row values
const getAllRowValues = () => {
	const rowValues = new Map();
	const groups = Array.from(document.querySelectorAll('dip-switch-group'));
	groups.forEach((group, i) => {
		rowValues.set(i, group.value);
	});
	return rowValues;
};

// Function to initialize sample player and start sequencer
const initializeSequencer = async () => {
	// Wait for audio context to be ready
	await clock.init();

	// Create sample player
	samplePlayer = new SamplePlayer(clock.audioContext);

	// Load all samples
	await samplePlayer.loadAllSamples();

	// Set up tick listener to play samples
	clock.onTick((time, tickCount) => {
		if (samplePlayer) {
			const rowValues = getAllRowValues();
			// Pass full row values (settings and notes) to sample player
			// This allows access to solo, mute, and note settings
			samplePlayer.processTick(tickCount, rowValues);
		}
	});

	console.log('Sequencer initialized and ready');
};

if (setRow) {
	// Function to update clock BPM and play/stop state from SET row
	const updateClockBPM = () => {
		const setRowValue = setRow.value;
		const settings = setRowValue.settings || 0;
		const notes = setRowValue.notes || 0;
		const bpm = clock.calculateBPM(settings);

		// Extract bit 0 (right-most bit of entire row) to control play/stop
		// The rightmost bit is bit 0 of the notes section (switch 5, bit 0)
		const shouldPlay = (notes & 0b1) === 1;

		// Don't play if BPM is 0 or if play bit is off
		const canPlay = shouldPlay && bpm > 0;

		// Update BPM first (this won't stop/start the clock, just updates timing)
		clock.setBPM(bpm);

		// Control play/stop state independently
		// Only try to start if sequencer is initialized (samplePlayer exists)
		if (canPlay && !clock.isRunning && samplePlayer !== null) {
			clock.start().catch(err => console.error('Error starting clock:', err));
		} else if (!canPlay && clock.isRunning) {
			clock.stop();
		}
	};

	// Listen for changes to the SET row
	setRow.addEventListener('change', updateClockBPM);

	// Initialize with current value
	updateClockBPM();

	// Start the clock and initialize sequencer on first user interaction
	// Browsers require user interaction before AudioContext can be created
	let sequencerStarted = false;
	const startSequencer = async () => {
		if (sequencerStarted) return;
		sequencerStarted = true;

		try {
			await initializeSequencer();
			// Don't auto-start - let updateClockBPM handle starting based on play bit
			// This ensures it respects the initial play/stop state
			updateClockBPM();
			console.log('Sequencer initialized successfully');
		} catch (error) {
			console.error('Error starting sequencer:', error);
		}
	};

	// Wait for user interaction before starting
	const startOnInteraction = e => {
		startSequencer();
		// Remove listeners after first interaction
		document.removeEventListener('click', startOnInteraction);
		document.removeEventListener('touchstart', startOnInteraction);
		document.removeEventListener('keydown', startOnInteraction);
	};

	// Listen for various user interactions
	document.addEventListener('click', startOnInteraction, { once: true });
	document.addEventListener('touchstart', startOnInteraction, { once: true });
	document.addEventListener('keydown', startOnInteraction, { once: true });
}
