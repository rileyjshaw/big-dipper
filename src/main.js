import './dip-switch.js';
import './dip-switch-group.js';
import { SequencerClock } from './sequencer-clock.js';
import { SamplePlayer } from './sample-player.js';
import { CrossTabSync } from './cross-tab-sync.js';
import { MidiOutput } from './midi-output.js';

const numRows = 9;

const defaultValues = [
	{
		settings: 0b0111100011000000,
		notes: 0b10111111000000000000000000000010,
		labels: ['BPM', 'BPM Mod', 'Volume', 'MIDI Scale', 'Preset', 'Play'],
	},
	{ notes: 0b10001000100010001000100010000000 },
	{ notes: 0b1000 },
	{ notes: 0b100000000000000010000000 },
	{ notes: 0b1 },
	{ notes: 0b10000000000000001000000000000000 },
	{ notes: 0b100000000000000010000000 },
	{ notes: 0b10000000000000101000100000100000 },
	{ notes: 0b0 },
].map((row, i) => (i ? { ...row, settings: (i - 1) << 8, labels: ['Instrument', 'Mode'] } : row));

document.querySelector('.circuit-board').innerHTML = `
      ${Array.from(
			{ length: numRows },
			(_, i) => `
        <dip-switch-group${i === 0 ? ' data-settings' : ''}></dip-switch-group>
      `
		).join('')}
`;

const clock = new SequencerClock();

let crossTabSync = null;

let samplePlayer = null;

let midiOutput = null;

let leaderBaseTempo = null;

let preloadedSampleData = new Map();

const setRow = document.querySelector('dip-switch-group[data-settings]');

let selectedByte = null;
let clipboard = null;

const HOLD_DURATION = 500;
const LONG_HOLD_DURATION = 2000;

const expertShortcuts = {
	pressHandlers: new Map(),
	holdHandlers: new Map(),
	longHoldHandlers: new Map(),
	highlightTimeouts: new Map(),
	keyDownTimes: new Map(),
	heldKeys: new Set(),
	invalidKeys: new Set(),
};

let cachedRowGroups = null;
function getAllRowGroups() {
	if (cachedRowGroups === null) {
		cachedRowGroups = Array.from(document.querySelectorAll('dip-switch-group'));
	}
	return cachedRowGroups;
}

getAllRowGroups().forEach((group, i) => {
	const value = defaultValues[i];

	for (let j = 0; j < 6; ++j) {
		const switchEl = group.getByte(j);
		if (!value || !switchEl) continue;
		const label = value.labels?.[j];
		let bits = 0;
		if (j < 2) bits = value.settings >>> ((1 - j) * 8);
		else bits = value.notes >>> ((5 - j) * 8);

		if (bits) switchEl.value = bits & 0xff;
		if (label) switchEl.label = label;
	}
});

const getSelectedByteElement = () => {
	if (!selectedByte) return null;
	const groups = getAllRowGroups();
	const group = groups[selectedByte.rowIndex];
	if (!group) return null;
	return group.getByte(selectedByte.byteIndex);
};

const getSelectedByteType = () => {
	if (!selectedByte) return null;
	if (selectedByte.rowIndex === 0) return 'settingsRow';
	return selectedByte.byteIndex < 2 ? 'settings' : 'notes';
};

window.setSelectedByteFromElement = byteElement => {
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

window.getSelectedByteElement = getSelectedByteElement;

window.isByteSelected = byteElement => {
	const selected = getSelectedByteElement();
	return selected === byteElement;
};

const setSelectedByte = (rowIndex, byteIndex) => {
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

	const groups = getAllRowGroups();
	if (rowIndex < 0 || rowIndex >= groups.length) return;
	const group = groups[rowIndex];
	if (!group || byteIndex < 0 || byteIndex >= 6) return;

	selectedByte = { rowIndex, byteIndex };
	const byte = group.getByte(byteIndex);
	if (byte) {
		byte.classList.add('expert-focus');
	}
};

const navigateByte = direction => {
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

const copyByte = byteElement => {
	if (!byteElement) return;
	clipboard = { type: 'byte', value: byteElement.value };
};

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

const copyEntireRow = rowElement => {
	if (!rowElement || !selectedByte) return;
	const bytes = rowElement.getAllBytes();
	if (selectedByte.rowIndex === 0) {
		clipboard = { type: 'settingsRow', value: [...bytes] };
	} else {
		clipboard = { type: 'instrumentRow', value: [...bytes] };
	}
};

const copyInstrumentSettings = rowElement => {
	if (!rowElement) return;
	const bytes = rowElement.getAllBytes();
	clipboard = { type: 'instrumentSettings', value: [bytes[0], bytes[1]] };
	flashBytes(rowElement, [0, 1]);
};

const copyInstrumentNotes = rowElement => {
	if (!rowElement) return;
	const bytes = rowElement.getAllBytes();
	clipboard = { type: 'instrumentNotes', value: [bytes[2], bytes[3], bytes[4], bytes[5]] };
	flashBytes(rowElement, [2, 3, 4, 5]);
};

const isValidClipboardForSelection = () => {
	if (!selectedByte || !clipboard) return false;
	const rowIndex = selectedByte.rowIndex;
	const byteIndex = selectedByte.byteIndex;

	if (clipboard.type === 'byte') return true;
	if (rowIndex === 0) return clipboard.type === 'settingsRow';
	if (clipboard.type === 'instrumentRow') return true;
	return byteIndex < 2 === (clipboard.type === 'instrumentSettings');
};

const pasteBytes = () => {
	if (!clipboard || !selectedByte || !isValidClipboardForSelection()) return;

	const groups = getAllRowGroups();
	const row = groups[selectedByte.rowIndex];
	if (!row) return;

	const rowIndex = selectedByte.rowIndex;
	const byteIndex = selectedByte.byteIndex;
	const bytes = row.getAllBytes();

	if (clipboard.type === 'byte') {
		const byte = row.getByte(byteIndex);
		if (byte) byte.value = clipboard.value;
	} else if (clipboard.type === 'settingsRow' && Array.isArray(clipboard.value)) {
		if (rowIndex === 0) {
			row.setAllBytes(clipboard.value);
		}
	} else if (clipboard.type === 'instrumentRow' && Array.isArray(clipboard.value)) {
		if (rowIndex > 0) {
			row.setAllBytes(clipboard.value);
		}
	} else if (clipboard.type === 'instrumentSettings' && Array.isArray(clipboard.value)) {
		if (rowIndex > 0) {
			bytes[0] = clipboard.value[0] ?? bytes[0];
			bytes[1] = clipboard.value[1] ?? bytes[1];
			row.setAllBytes(bytes);
		}
	} else if (clipboard.type === 'instrumentNotes' && Array.isArray(clipboard.value)) {
		if (rowIndex > 0) {
			bytes[2] = clipboard.value[0] ?? bytes[2];
			bytes[3] = clipboard.value[1] ?? bytes[3];
			bytes[4] = clipboard.value[2] ?? bytes[4];
			bytes[5] = clipboard.value[3] ?? bytes[5];
			row.setAllBytes(bytes);
		}
	}
};

const handleKeyboardShortcut = (key, event) => {
	const byteElement = getSelectedByteElement();
	if (!byteElement) return false;

	const keyLower = key.toLowerCase();
	const holdHandler = expertShortcuts.holdHandlers.get(keyLower);
	const longHoldHandler = expertShortcuts.longHoldHandlers.get(keyLower);
	const pressHandler = expertShortcuts.pressHandlers.get(keyLower);

	if (holdHandler || longHoldHandler) {
		if (event.repeat) return false;

		expertShortcuts.heldKeys.add(keyLower);

		clearHighlights();

		const timeouts = expertShortcuts.highlightTimeouts.get(keyLower) || [];

		if (holdHandler) {
			const timeout = setTimeout(() => {
				if (expertShortcuts.invalidKeys.has(keyLower)) return;
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

		expertShortcuts.keyDownTimes.set(keyLower, Date.now());
		return true;
	}

	if (pressHandler) {
		pressHandler();
		return true;
	}

	return false;
};

const clearHighlights = () => {
	document.querySelectorAll('.expert-highlight').forEach(el => {
		el.classList.remove('expert-highlight');
	});
};

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

const handleKeyDown = e => {
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

	if (e.key === 'Tab' && selectedByte && !e.ctrlKey && !e.altKey) {
		const byteElement = getSelectedByteElement();
		if (byteElement) {
			e.preventDefault();
			byteElement.focusFirstBit();
		}
		return;
	}

	if (!e.metaKey && !e.ctrlKey && !e.altKey) {
		const handled = handleKeyboardShortcut(e.key, e);
		if (handled) {
			e.preventDefault();
		}
	}
};

const handleKeyUp = e => {
	const keyLower = e.key.toLowerCase();
	const keyDownTime = expertShortcuts.keyDownTimes.get(keyLower);
	expertShortcuts.keyDownTimes.delete(keyLower);
	if (!keyDownTime) return;

	expertShortcuts.heldKeys.delete(keyLower);

	const timeouts = expertShortcuts.highlightTimeouts.get(keyLower);
	if (timeouts) {
		timeouts.forEach(timeout => clearTimeout(timeout));
		timeouts.length = 0;
	}

	clearHighlights();

	if (expertShortcuts.invalidKeys.has(keyLower)) {
		expertShortcuts.invalidKeys.delete(keyLower);
		return;
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

const byteElement = () => getSelectedByteElement();

registerExpertShortcut('b', () => {
	const el = byteElement();
	if (el) el.value = Math.max(0, el.value - 1);
});

registerExpertShortcut('g', () => {
	const el = byteElement();
	if (el) el.value = Math.min(255, el.value + 1);
});

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
		const groups = getAllRowGroups();
		if (selectedByte) {
			const row = groups[selectedByte.rowIndex];
			if (row) copyEntireRow(row);
		}
	}
);

registerExpertShortcut('v', () => {
	pasteBytes();
});

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

registerExpertShortcut('r', () => {
	const el = byteElement();
	if (el) el.value = Math.floor(Math.random() * 256);
});

registerExpertShortcut('t', () => {
	const el = byteElement();
	if (el) el.value = el.value ^ 0xff;
});

for (let i = 1; i <= 8; i++) {
	registerExpertShortcut(String(i), () => {
		const el = byteElement();
		if (el) el.toggleBit(i);
	});
}

document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

let cachedRowValues = new Map();

const updateRowValuesCache = () => {
	cachedRowValues.clear();
	const groups = getAllRowGroups();
	groups.forEach((group, i) => {
		cachedRowValues.set(i, group.value);
	});
};

const getAllRowValues = () => {
	return cachedRowValues;
};

updateRowValuesCache();

const extractVolumeSettings = () => {
	const setRowValue = setRow.value;
	const notes = setRowValue.notes || 0;
	const volumeByte = (notes >> 24) & 0xff;
	const isOn = (volumeByte >> 7) & 0b1;
	const volume = volumeByte & 0x7f; // Bits 6-0 (0-127)
	return isOn * volume;
};

const handleTick = async (tickCount, settings, isLeader = false) => {
	if (!samplePlayer) return;
	const shouldPlay = (setRow.value.notes ?? 0) & 0b1;
	if (!shouldPlay) return;
	if (!clock.shouldProcessTick(tickCount, settings)) return;

	const effectiveTickCount = clock.calculateEffectiveTickCount(tickCount, settings);
	if (!isLeader) clock.tickCount = tickCount;

	const masterVolume = extractVolumeSettings();
	const rowValues = getAllRowValues();
	await samplePlayer.processTick(effectiveTickCount, rowValues, masterVolume);

	// Process MIDI output (only if MIDI API is supported)
	if (midiOutput && MidiOutput.isSupported()) {
		const settingsRowNotes = setRow.value.notes ?? 0;
		await midiOutput.processTick(
			effectiveTickCount,
			rowValues,
			settingsRowNotes,
			samplePlayer.extractRowSettings.bind(samplePlayer),
			samplePlayer.stepCheckers
		);
	}
};

document.addEventListener(
	'change',
	e => {
		if (e.target.closest('dip-switch-group')) {
			updateRowValuesCache();
		}
	},
	true
);

async function initializeSequencer() {
	samplePlayer = new SamplePlayer(clock.audioContext);

	await samplePlayer.decodePreloadedSamples(preloadedSampleData);
	preloadedSampleData = null;

	// Create MIDI output instance but don't initialize until toggle is enabled
	midiOutput = new MidiOutput();

	crossTabSync = new CrossTabSync(clock);

	clock.onTick(async (time, tickCount) => {
		const setRowValue = setRow.value;
		const settings = setRowValue.settings || 0;

		if (crossTabSync?.isLeader) {
			crossTabSync.broadcastTick(time, tickCount, settings);
		}

		await handleTick(tickCount, settings, true);
	});

	updateClockBPM();
	setRow.addEventListener('change', updateClockBPM);
}

async function updateClockBPM() {
	const setRowValue = setRow.value;
	const settings = setRowValue.settings || 0;
	const notes = setRowValue.notes || 0;

	const tempoSettings = clock.extractTempoSettings(settings);
	const { baseTempo } = tempoSettings;

	const bpm = clock.calculateBPM(settings);

	const maxBPM = clock.calculateMaxBPM(baseTempo);

	const shouldPlay = (notes & 0b1) === 1;

	const canPlay = shouldPlay && bpm > 0;

	const clockBPM = bpm > 0 ? maxBPM : bpm;

	clock.setBPM(clockBPM);

	if (canPlay && !clock.isRunning && samplePlayer !== null) {
		await clock
			.start()
			.then(() => {
				if (crossTabSync && bpm > 0) {
					crossTabSync.startLeader(bpm, maxBPM, settings);
				}
			})
			.catch(err => {
				console.error('Error starting clock:', err);
			});
	} else if (!canPlay && clock.isRunning) {
		clock.stop();
	}

	if (crossTabSync) {
		if (bpm > 0) {
			clock.isFollowingExternal = false;
			crossTabSync.stopFollower();
			if (canPlay && clock.isRunning) {
				crossTabSync.startLeader(bpm, maxBPM, settings);
			} else if (!canPlay) {
				crossTabSync.stopLeader();
			}
		} else {
			crossTabSync.stopLeader();
			clock.isFollowingExternal = true;

			leaderBaseTempo = null;

			crossTabSync.startFollower(async (time, tickCount, leaderSettings) => {
				// Extract tempo settings once if provided
				if (leaderSettings !== undefined && leaderSettings !== null) {
					const { baseTempo } = clock.extractTempoSettings(leaderSettings);
					leaderBaseTempo = baseTempo;
				}

				if (time === null) return;

				if (leaderBaseTempo !== null && leaderBaseTempo > 0) {
					const currentSettings = setRow.value.settings || 0;
					const { isMultiply, tempoFactorExponent } = clock.extractTempoSettings(currentSettings);

					const effectiveSettings =
						(leaderBaseTempo << 8) | (isMultiply ? 0x80 : 0x00) | (tempoFactorExponent << 5);

					await handleTick(tickCount, effectiveSettings, false);
				} else {
					clock.tickCount = tickCount;
				}
			});
		}
	}
}

async function startOnInteraction(e) {
	if (!clock.audioContext) {
		clock.audioContext = new (window.AudioContext || window.webkitAudioContext)();
	}

	if (clock.audioContext.state === 'suspended') {
		try {
			await clock.audioContext.resume();
		} catch (err) {
			console.error('Error resuming AudioContext:', err);
		}
	}

	await initializeSequencer();

	document.removeEventListener('click', startOnInteraction);
	document.removeEventListener('touchstart', startOnInteraction);
	document.removeEventListener('keydown', startOnInteraction);
}
document.addEventListener('click', startOnInteraction, { once: true });
document.addEventListener('touchstart', startOnInteraction, { once: true });
document.addEventListener('keydown', startOnInteraction, { once: true });

const preloadSamples = async () => {
	const loadingOverlay = document.getElementById('loading-overlay');
	if (!loadingOverlay) return;

	const soundBanks = [
		'drum - koan remnants',
		'note - massive x astral float',
		'drum - alix perez x eprom',
		'note - noire felt',
	];

	try {
		const baseUrl = import.meta.env.BASE_URL;
		const preloadedData = new Map();
		const loadPromises = [];

		for (let soundBank = 0; soundBank < soundBanks.length; soundBank++) {
			const bankDir = soundBanks[soundBank];
			for (let note = 0; note < 8; note++) {
				const fileNum = String(note + 1).padStart(2, '0');
				const url = `${baseUrl}samples/${bankDir}/${fileNum}.wav`;
				const key = `${soundBank}-${note}`;

				loadPromises.push(
					fetch(url)
						.then(response => {
							if (!response.ok) {
								throw new Error(`HTTP ${response.status}: ${response.statusText}`);
							}
							return response.arrayBuffer();
						})
						.then(arrayBuffer => {
							if (arrayBuffer.byteLength === 0) {
								throw new Error('Empty response');
							}
							preloadedData.set(key, arrayBuffer);
						})
						.catch(error => {
							console.error(
								`Failed to preload sample for sound bank ${soundBank}, note ${note} from ${url}:`,
								error
							);
						})
				);
			}
		}

		await Promise.all(loadPromises);

		preloadedSampleData = preloadedData;

		loadingOverlay.classList.add('hidden');
	} catch (error) {
		console.error('Error preloading samples:', error);
		loadingOverlay.classList.add('hidden');
	}
};

preloadSamples();
