/**
 * URL synchronization for preset data
 * Encodes current state to URL and loads from URL on page load
 */

import { encodePreset, decodePreset } from './preset-encoder.js';

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
 * Sync current state to URL hash
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 */
export function syncToURL(getAllRowGroupsFn) {
	try {
		const presetData = extractPresetData(getAllRowGroupsFn);
		const encoded = encodePreset(presetData.settingsRowBytes, presetData.instrumentRowBytes);

		// Update URL hash without triggering navigation
		const url = new URL(window.location.href);
		url.hash = encoded;
		window.history.replaceState(null, '', url);
	} catch (error) {
		console.error('Error syncing to URL:', error);
	}
}

/**
 * Load preset from URL if present
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 * @returns {boolean} True if preset was loaded from URL, false otherwise
 */
export function loadFromURL(getAllRowGroupsFn) {
	try {
		const url = new URL(window.location.href);
		const hash = url.hash;

		// Check for #... format (hash should contain the encoded preset data)
		const encoded = hash.startsWith('#') ? hash.slice(1) : hash;
		if (!encoded || encoded.length === 0) {
			return false;
		}

		const presetData = decodePreset(encoded);
		applyPresetData(getAllRowGroupsFn, presetData);
		return true;
	} catch (error) {
		console.error('Error loading from URL:', error);
		return false;
	}
}

/**
 * Set up automatic URL sync on changes
 * @param {Function} getAllRowGroupsFn - Function that returns all row groups
 * @param {Function} onChangeCallback - Optional callback to call after URL sync
 */
export function setupURLSync(getAllRowGroupsFn, onChangeCallback) {
	// Sync to URL whenever any row group changes
	document.addEventListener(
		'change',
		e => {
			if (e.target.closest('dip-switch-group')) {
				syncToURL(getAllRowGroupsFn);
				if (onChangeCallback) {
					onChangeCallback();
				}
			}
		},
		true
	);
}
