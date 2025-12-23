/**
 * Sample player for step sequencer
 * Loads audio samples and plays them when steps are active
 */
export class SamplePlayer {
	constructor(audioContext) {
		this.audioContext = audioContext;
		this.buffers = new Map();
		this.euclideanCache = new Map();
		this.masterGainNode = null;
		this.setupMasterGain();
		// Checks if a step is active for a given step / mode / settings.
		this.stepCheckers = [
			this.isStepActive,
			this.isStepActiveEuclidean,
			// Modes 2-7 reserved for future use.
		];
	}

	setupMasterGain() {
		if (this.masterGainNode) return; // Already set up
		this.masterGainNode = this.audioContext.createGain();
		this.masterGainNode.gain.value = 1.0;
		this.masterGainNode.connect(this.audioContext.destination);
	}

	/**
	 * Decode preloaded sample data (ArrayBuffers) into AudioBuffers
	 * Used when samples were preloaded before AudioContext was ready
	 * @param {Map<string, ArrayBuffer>} preloadedData - Map of buffer keys to ArrayBuffer objects
	 */
	async decodePreloadedSamples(preloadedData) {
		const decodePromises = [];

		for (const [key, arrayBuffer] of preloadedData.entries()) {
			decodePromises.push(
				this.audioContext
					.decodeAudioData(arrayBuffer.slice(0))
					.then(audioBuffer => {
						this.buffers.set(key, audioBuffer);
					})
					.catch(error => {
						console.error(`Failed to decode preloaded sample ${key}:`, error);
					})
			);
		}

		await Promise.all(decodePromises);
	}

	/**
	 * Play a sample for a given sound bank and note
	 * @param {number} soundBank - Sound bank index (0-7)
	 * @param {number} note - Note number (0-7)
	 * @param {number} time - Audio context time to play at (optional)
	 * @param {number} volume - Volume level (0-127, optional)
	 */
	async playSample(soundBank, note, time = null, volume = 127) {
		console.log('playSample', soundBank, note, time, volume);
		const key = `${soundBank}-${note}`;
		const buffer = this.buffers.get(key);
		if (!buffer) {
			return;
		}
		if (this.audioContext.state === 'suspended') {
			try {
				await this.audioContext.resume();
			} catch (err) {
				console.error('Error resuming AudioContext:', err);
				return;
			}
		}

		const source = this.audioContext.createBufferSource();
		source.buffer = buffer;

		// Create a gain node for this sample with volume control
		const gainNode = this.audioContext.createGain();
		// Convert volume (0-127) to gain (0.0-1.0)
		const gainValue = volume / 127;
		gainNode.gain.value = gainValue;

		source.connect(gainNode);
		gainNode.connect(this.masterGainNode || this.audioContext.destination);

		const playTime = time !== null ? time : this.audioContext.currentTime;
		source.start(playTime);
	}

	/**
	 * Check if a step is active in a row value
	 * Only checks the blue switches (last 32 bits, bits 0-31)
	 * @param {number} index - Row index (unused for step mode)
	 * @param {number} notes - The row value (48-bit number, but only last 32 bits are used)
	 * @param {number} tickCount - Current tick count from the clock
	 * @param {number} modeSettings - Mode-specific settings (unused for step mode)
	 * @returns {boolean}
	 */
	isStepActive(index, notes, tickCount, modeSettings) {
		const bitPosition = 31 - (tickCount % 32);
		const bigValue = BigInt(notes);
		const bitMask = 1n << BigInt(bitPosition);
		return (bigValue & bitMask) !== 0n;
	}

	/**
	 * Extract per-row settings from the settings bytes
	 * @param {number} settings - Settings value (first 2 bytes, 16 bits)
	 * @returns {Object} Object with solo, mute, midiChannel, note, mode, and modeSettings properties
	 *   - solo: boolean - Whether this row is soloed
	 *   - mute: boolean - Whether this row is muted
	 *   - midiChannel: number - MIDI channel (0-7)
	 *   - note: number - Note number (0-7)
	 *   - mode: number - Step mode (0-7, 0=step, 1=euclidean, 2-7 reserved)
	 *   - modeSettings: number - Mode-specific settings (5 bits, 0-31)
	 */
	extractRowSettings(settings) {
		const firstByte = (settings >> 8) & 0xff;

		const solo = !!((firstByte >> 7) & 0b1);
		const mute = !!((firstByte >> 6) & 0b1);
		const midiChannel = (firstByte >> 3) & 0b111;
		const note = (firstByte >> 0) & 0b111;

		const secondByte = settings & 0xff;

		const mode = (secondByte >> 0) & 0b111;
		const modeSettings = (secondByte >> 3) & 0b11111;

		return {
			solo,
			mute,
			midiChannel,
			note,
			mode,
			modeSettings,
		};
	}

	/**
	 * Generate a Euclidean rhythm pattern
	 * Distributes k pulses as evenly as possible across n steps
	 * Uses the standard step-counter method (most common in hardware sequencers)
	 * @param {number} n - Total number of steps
	 * @param {number} k - Number of pulses
	 * @returns {boolean[]} Array of n booleans indicating which steps are active
	 */
	generateEuclideanPattern(n, k) {
		if (k === 0) {
			return new Array(n).fill(false);
		}
		if (k >= n) {
			return new Array(n).fill(true);
		}

		const pattern = new Array(n);
		for (let i = 0; i < n; i++) {
			pattern[i] = (i * k) % n < k;
		}

		return pattern;
	}

	/**
	 * Get or generate cached base Euclidean pattern for a row (without rotation)
	 * @param {number} index - Row index
	 * @param {number} notes - Notes value (48-bit, but using last 32 bits)
	 *   - Bits 31-24 (most significant byte): Total Steps (8 bits, 0-255)
	 *   - Bits 23-16 (2nd byte): Total Pulses (8 bits, 0-255)
	 *   - Bits 15-8 (3rd byte): Initial Rotation (8 bits, 0-255, treated as signed -128 to 127)
	 *   - Bits 7-0 (4th byte): Rotation Increment (8 bits, 0-255, treated as signed -128 to 127)
	 * @returns {{pattern: boolean[], totalSteps: number, pulses: number, initialRotation: number, rotationIncrement: number}|null}
	 */
	getEuclideanPattern(index, notes) {
		const totalSteps = (notes >> 24) & 0xff;

		if (totalSteps === 0) {
			return null;
		}

		const pulses = (notes >> 16) & 0xff;

		const initialRotationRaw = (notes >> 8) & 0xff;
		const initialRotation = initialRotationRaw > 127 ? 128 - initialRotationRaw : initialRotationRaw;

		const rotationIncrementRaw = notes & 0xff;
		const rotationIncrement = rotationIncrementRaw > 127 ? 128 - rotationIncrementRaw : rotationIncrementRaw;

		const effectivePulses = Math.max(0, Math.min(totalSteps, pulses));

		const cached = this.euclideanCache.get(index);
		if (
			cached &&
			cached.totalSteps === totalSteps &&
			cached.pulses === effectivePulses &&
			cached.initialRotation === initialRotation &&
			cached.rotationIncrement === rotationIncrement
		) {
			return cached;
		}

		const pattern = this.generateEuclideanPattern(totalSteps, effectivePulses);

		const cacheEntry = {
			pattern: pattern,
			totalSteps: totalSteps,
			pulses: effectivePulses,
			initialRotation: initialRotation,
			rotationIncrement: rotationIncrement,
		};
		this.euclideanCache.set(index, cacheEntry);

		return cacheEntry;
	}

	/**
	 * Check if a step is active using Euclidean sequencer
	 * @param {number} index - Row index (for caching)
	 * @param {number} notes - Notes value (48-bit, but using last 32 bits)
	 *   - Bits 31-24 (most significant byte): Total Steps (8 bits, 0-255)
	 *   - Bits 23-16 (2nd byte): Total Pulses (8 bits, 0-255)
	 *   - Bits 15-8 (3rd byte): Initial Rotation (8 bits, 0-255, treated as signed -128 to 127)
	 *   - Bits 7-0 (4th byte): Rotation Increment (8 bits, 0-255, treated as signed -128 to 127)
	 * @param {number} tickCount - Current tick count from the clock
	 * @param {number} modeSettings - Mode-specific settings (unused for euclidean mode)
	 * @returns {boolean}
	 */
	isStepActiveEuclidean(index, notes, tickCount, modeSettings) {
		const cacheEntry = this.getEuclideanPattern(index, notes);

		if (cacheEntry === null) return false;

		const { pattern, totalSteps, initialRotation, rotationIncrement } = cacheEntry;

		const repeats = Math.floor(tickCount / totalSteps);
		const currentRotation = initialRotation + rotationIncrement * repeats;

		const mappedIndex = tickCount % totalSteps;
		const rotatedIndex = (mappedIndex - currentRotation + totalSteps) % totalSteps;
		const isActive = pattern[rotatedIndex];

		return isActive;
	}

	/**
	 * Process a tick - check all rows and play samples for active steps
	 * @param {number} tickCount - Current tick count
	 * @param {Map<number, {settings: number, notes: number}>} rowValues - Map of row indices to their current values
	 * @param {number} masterVolume - Master volume level (0-127, optional, defaults to 127)
	 */
	async processTick(tickCount, rowValues, masterVolume = 127) {
		if (this.audioContext.state === 'suspended') {
			try {
				await this.audioContext.resume();
			} catch (err) {
				console.error('Error resuming AudioContext:', err);
				return;
			}
		}

		const instrumentRows = Array.from(rowValues.entries()).slice(1);
		let hasAnySolo = false;
		const rowSettings = new Map();
		for (const [index, value] of instrumentRows) {
			const settings = this.extractRowSettings(value.settings || 0);
			rowSettings.set(index, settings);
			if (settings.solo) hasAnySolo = true;
		}

		for (const [index, value] of instrumentRows) {
			const settings = rowSettings.get(index);
			if (!settings || settings.mute || (hasAnySolo && !settings.solo)) continue;

			const stepChecker = this.stepCheckers[settings.mode];
			if (!stepChecker) continue;
			if (stepChecker(index, value.notes || 0, tickCount, settings.modeSettings)) {
				const playTime = this.audioContext.currentTime;
				await this.playSample(settings.midiChannel, settings.note, playTime, masterVolume);
			}
		}
	}
}
