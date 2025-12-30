/**
 * Preset storage and retrieval manager
 * Handles localStorage (user presets) and default presets file
 */

import { decodePreset, encodePreset } from './preset-encoder.js';
import presetsText from './presets.txt?raw';

const LOCALSTORAGE_KEY = 'big-dipper-presets';
const DEFAULT_PRESET = 'eMAAAAAAAAAAAQAAAAAAAgAAAAAAAwAAAAAABAAAAAAABQAAAAAABgAAAAAABwAAAAAA';

/**
 * Parse presets text into a Map
 * @returns {Map<number, string>} Map of preset number to Base64URL string
 */
const defaultPresetsMap = new Map();
(function parsePresets() {
	const lines = presetsText.split('\n');
	// Each line is a preset, line number (1-indexed) is preset number
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line && line.length > 0) {
			defaultPresetsMap.set(i, line);
		}
	}
})();

/**
 * Get user presets from localStorage
 * @returns {Map<number, string>} Map of preset number to Base64URL string
 */
function getUserPresets() {
	const presets = new Map();

	try {
		const stored = localStorage.getItem(LOCALSTORAGE_KEY);
		if (stored) {
			const data = JSON.parse(stored);
			for (const [key, value] of Object.entries(data)) {
				const presetNumber = parseInt(key, 10);
				if (!isNaN(presetNumber) && presetNumber >= 0 && presetNumber <= 127) {
					presets.set(presetNumber, value);
				}
			}
		}
	} catch (error) {
		console.error('Error reading user presets from localStorage:', error);
	}

	return presets;
}

/**
 * Save preset to localStorage
 * @param {number} presetNumber - Preset number (0-127)
 * @param {string} base64Data - Base64URL encoded preset data
 */
function saveUserPreset(presetNumber, base64Data) {
	if (presetNumber < 0 || presetNumber > 127) {
		throw new Error(`Invalid preset number: ${presetNumber} (must be 0-127)`);
	}

	try {
		const stored = localStorage.getItem(LOCALSTORAGE_KEY);
		const data = stored ? JSON.parse(stored) : {};
		data[presetNumber] = base64Data;
		localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(data));
	} catch (error) {
		console.error('Error saving preset to localStorage:', error);
		throw error;
	}
}

/**
 * Get preset data (user presets take precedence over default presets)
 * @param {number} presetNumber - Preset number (0-127)
 * @returns {{settingsRowBytes: number[], instrumentRowBytes: number[][]}|null} Decoded preset data or null if not found
 */
export function getPreset(presetNumber) {
	if (presetNumber < 0 || presetNumber > 127) {
		throw new Error(`Invalid preset number: ${presetNumber} (must be 0-127)`);
	}

	// Check user presets first
	const userPresets = getUserPresets();
	if (userPresets.has(presetNumber)) {
		try {
			return decodePreset(userPresets.get(presetNumber));
		} catch (error) {
			console.error(`Error decoding user preset ${presetNumber}:`, error);
			// Fall through to default presets
		}
	}

	// Check default presets
	if (defaultPresetsMap.has(presetNumber)) {
		try {
			return decodePreset(defaultPresetsMap.get(presetNumber));
		} catch (error) {
			console.error(`Error decoding default preset ${presetNumber}:`, error);
			// Fall through to default preset
		}
	}

	// Fall back to default preset (all zeros)
	try {
		return decodePreset(DEFAULT_PRESET);
	} catch (error) {
		console.error('Error decoding default fallback preset:', error);
		return null;
	}
}

/**
 * Save preset to localStorage
 * @param {number} presetNumber - Preset number (0-127)
 * @param {number[]} settingsRowBytes - First 3 bytes from settings row
 * @param {number[][]} instrumentRowBytes - Array of 8 arrays, each containing 6 bytes
 */
export function savePreset(presetNumber, settingsRowBytes, instrumentRowBytes) {
	if (presetNumber < 0 || presetNumber > 127) {
		throw new Error(`Invalid preset number: ${presetNumber} (must be 0-127)`);
	}

	const base64Data = encodePreset(settingsRowBytes, instrumentRowBytes);
	saveUserPreset(presetNumber, base64Data);
}

/**
 * Load preset and return decoded data (alias for getPreset for consistency)
 * @param {number} presetNumber - Preset number (0-127)
 * @returns {{settingsRowBytes: number[], instrumentRowBytes: number[][]}|null} Decoded preset data or null if not found
 */
export function loadPreset(presetNumber) {
	return getPreset(presetNumber);
}
