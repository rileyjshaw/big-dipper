/**
 * Preset encoding/decoding utilities
 * Encodes preset data (settings row first 3 bytes + all instrument row bytes) as Base64URL
 */

/**
 * Encode preset data to Base64URL string
 * @param {number[]} settingsRowBytes - First 3 bytes from settings row (indices 0, 1, 2)
 * @param {number[][]} instrumentRowBytes - Array of 8 arrays, each containing 6 bytes from an instrument row
 * @returns {string} Base64URL encoded string
 */
export function encodePreset(settingsRowBytes, instrumentRowBytes) {
	if (!Array.isArray(settingsRowBytes) || settingsRowBytes.length < 3) {
		throw new Error('Settings row must have at least 3 bytes');
	}
	if (!Array.isArray(instrumentRowBytes) || instrumentRowBytes.length !== 8) {
		throw new Error('Must have exactly 8 instrument rows');
	}

	// Create Uint8Array with 51 bytes: 3 from settings + 48 from instruments
	const data = new Uint8Array(51);

	// First 3 bytes from settings row
	for (let i = 0; i < 3; i++) {
		data[i] = settingsRowBytes[i] & 0xff;
	}

	// Next 48 bytes from 8 instrument rows (6 bytes each)
	let offset = 3;
	for (let row = 0; row < 8; row++) {
		if (!Array.isArray(instrumentRowBytes[row]) || instrumentRowBytes[row].length !== 6) {
			throw new Error(`Instrument row ${row} must have exactly 6 bytes`);
		}
		for (let i = 0; i < 6; i++) {
			data[offset++] = instrumentRowBytes[row][i] & 0xff;
		}
	}

	// Convert to Base64, then make it URL-safe
	const base64 = btoa(String.fromCharCode(...data));
	// Replace + with -, / with _, and remove padding =
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode Base64URL string to preset data
 * @param {string} base64String - Base64URL encoded string
 * @returns {{settingsRowBytes: number[], instrumentRowBytes: number[][]}} Decoded preset data
 */
export function decodePreset(base64String) {
	if (!base64String || typeof base64String !== 'string') {
		throw new Error('Invalid base64 string');
	}

	// Convert Base64URL back to standard Base64
	// Replace - with +, _ with /, and add padding if needed
	let base64 = base64String.replace(/-/g, '+').replace(/_/g, '/');
	// Add padding if needed
	while (base64.length % 4) {
		base64 += '=';
	}

	try {
		// Decode Base64 to binary string
		const binaryString = atob(base64);

		// Convert to Uint8Array
		const data = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			data[i] = binaryString.charCodeAt(i);
		}

		// Validate length (should be exactly 51 bytes)
		if (data.length !== 51) {
			throw new Error(`Invalid preset data length: expected 51 bytes, got ${data.length}`);
		}

		// Extract first 3 bytes for settings row
		const settingsRowBytes = [data[0], data[1], data[2]];

		// Extract next 48 bytes for 8 instrument rows (6 bytes each)
		const instrumentRowBytes = [];
		let offset = 3;
		for (let row = 0; row < 8; row++) {
			instrumentRowBytes[row] = [
				data[offset],
				data[offset + 1],
				data[offset + 2],
				data[offset + 3],
				data[offset + 4],
				data[offset + 5],
			];
			offset += 6;
		}

		return { settingsRowBytes, instrumentRowBytes };
	} catch (error) {
		throw new Error(`Failed to decode preset: ${error.message}`);
	}
}
