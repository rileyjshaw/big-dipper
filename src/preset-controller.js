/**
 * Preset system controller
 * Main orchestration module that ties all preset functionality together
 */

import { loadPreset, savePreset } from './preset-manager.js';
import { showPresetDialog } from './preset-dialog.js';
import { loadFromURL, syncToURL, setupURLSync } from './preset-url-sync.js';

// Store the preset button handler to allow removal
let presetButtonHandler = null;

/**
 * Extract preset data from row groups
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 * @returns {{settingsRowBytes: number[], instrumentRowBytes: number[][]}} Preset data
 */
function extractPresetData(getAllRowGroupsFn) {
	const groups = getAllRowGroupsFn();

	if (groups.length !== 9) {
		throw new Error('Expected 9 row groups (1 settings + 8 instrument)');
	}

	// Settings row: first 3 bytes (indices 0, 1, 2)
	const settingsRow = groups[0];
	const settingsRowBytes = settingsRow.getAllBytes().slice(0, 3);

	// Instrument rows: all 6 bytes from each of 8 rows
	const instrumentRowBytes = [];
	for (let i = 1; i <= 8; i++) {
		instrumentRowBytes.push(groups[i].getAllBytes());
	}

	return { settingsRowBytes, instrumentRowBytes };
}

/**
 * Apply preset data to row groups
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 * @param {{settingsRowBytes: number[], instrumentRowBytes: number[][]}} presetData - Preset data to apply
 */
function applyPresetData(getAllRowGroupsFn, presetData) {
	const groups = getAllRowGroupsFn();

	if (groups.length !== 9) {
		throw new Error('Expected 9 row groups (1 settings + 8 instrument)');
	}

	// Apply first 3 bytes to settings row (preserve bytes 3 and 4)
	const settingsRow = groups[0];
	const settingsRowAllBytes = settingsRow.getAllBytes();
	for (let i = 0; i < 3; i++) {
		settingsRowAllBytes[i] = presetData.settingsRowBytes[i];
	}
	settingsRow.setAllBytes(settingsRowAllBytes);

	// Apply all 6 bytes to each instrument row
	for (let i = 0; i < 8; i++) {
		groups[i + 1].setAllBytes(presetData.instrumentRowBytes[i]);
	}
}

/**
 * Load preset data and apply to UI
 * @param {number} presetNumber - Preset number (0-127)
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 * @returns {Promise<boolean>} True if preset was loaded successfully, false otherwise
 */
export function loadPresetData(presetNumber, getAllRowGroupsFn) {
	try {
		const presetData = loadPreset(presetNumber);

		if (!presetData) {
			console.warn(`Preset ${presetNumber} not found`);
			return false;
		}

		applyPresetData(getAllRowGroupsFn, presetData);

		// Sync to URL after loading
		syncToURL(getAllRowGroupsFn);

		return true;
	} catch (error) {
		console.error(`Error loading preset ${presetNumber}:`, error);
		return false;
	}
}

/**
 * Save current state to preset
 * @param {number} presetNumber - Preset number (0-127)
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 */
export function savePresetData(presetNumber, getAllRowGroupsFn) {
	try {
		const presetData = extractPresetData(getAllRowGroupsFn);
		savePreset(presetNumber, presetData.settingsRowBytes, presetData.instrumentRowBytes);

		// Sync to URL after saving
		syncToURL(getAllRowGroupsFn);
	} catch (error) {
		console.error(`Error saving preset ${presetNumber}:`, error);
		throw error;
	}
}

/**
 * Handle PRESET button click
 * Reads PRESET byte, determines mode and preset number, shows dialog, and executes action
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 * @param {HTMLElement} setRow - Settings row element
 */
export async function handlePresetButtonClick(getAllRowGroupsFn, setRow) {
	// Read PRESET byte from settings row (byte index 3)
	const presetByte = setRow.getByte(3)?.value;

	if (presetByte === undefined || presetByte === null) {
		console.error('Could not read PRESET byte');
		return;
	}

	// Extract mode (MSB) and preset number (7 LSB)
	const isSaveMode = !!(presetByte & 0x80); // Bit 7
	const presetNumber = presetByte & 0x7f; // Bits 0-6

	if (presetNumber < 0 || presetNumber > 127) {
		console.error(`Invalid preset number: ${presetNumber}`);
		return;
	}

	const type = isSaveMode ? 'save' : 'load';
	const confirmed = await showPresetDialog(type, presetNumber);

	if (!confirmed) {
		return;
	}

	if (isSaveMode) {
		// Save preset
		savePresetData(presetNumber, getAllRowGroupsFn);
	} else {
		// Load preset
		loadPresetData(presetNumber, getAllRowGroupsFn);
	}
}

/**
 * Initialize preset system
 * Sets up URL sync and loads initial preset (from URL or preset 1)
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 * @param {HTMLElement} setRow - Settings row element
 * @param {Function} updateRowValuesCacheFn - Optional function to update row values cache after loading
 */
export function initializePresetSystem(getAllRowGroupsFn, setRow, updateRowValuesCacheFn) {
	// Try to load from URL first
	const loadedFromURL = loadFromURL(getAllRowGroupsFn);

	if (loadedFromURL) {
		// Update cache if callback provided
		if (updateRowValuesCacheFn) {
			updateRowValuesCacheFn();
		}
	} else {
		// Fall back to preset 0
		loadPresetData(0, getAllRowGroupsFn);
		if (updateRowValuesCacheFn) {
			updateRowValuesCacheFn();
		}
	}

	// Set up automatic URL sync on changes
	setupURLSync(getAllRowGroupsFn, updateRowValuesCacheFn);

	// Set up PRESET button click handler
	const presetButton = document.getElementById('preset-button');
	if (presetButton) {
		if (presetButtonHandler) presetButton.removeEventListener('click', presetButtonHandler);
		presetButtonHandler = () => {
			handlePresetButtonClick(getAllRowGroupsFn, setRow);
		};
		presetButton.addEventListener('click', presetButtonHandler);
	} else {
		console.warn('PRESET button not found');
	}
}
