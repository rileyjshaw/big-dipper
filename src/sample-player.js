/**
 * Sample player for step sequencer
 * Loads audio samples and plays them when steps are active
 */
export class SamplePlayer {
	constructor(audioContext) {
		this.audioContext = audioContext;
		this.samples = new Map();
		this.buffers = new Map(); // Map key: "soundBank-note" (e.g., "0-1" for drum bank, note 1)
		// Cache for base Euclidean patterns (without rotation): Map<index, {pattern: boolean[], totalSteps: number, pulses: number}>
		this.euclideanCache = new Map();

		// Sound bank directory names
		this.soundBanks = [
			'drum - koan remnants',
			'note - massive x astral float',
			'drum - alix perez x eprom',
			'placeholder-3',
			'placeholder-4',
			'placeholder-5',
			'placeholder-6',
			'placeholder-7',
		];
	}

	/**
	 * Load a sample from a URL
	 * @param {number} soundBank - Sound bank index (0-7)
	 * @param {number} note - Note number (0-7)
	 * @param {string} url - URL to the audio file
	 */
	async loadSample(soundBank, note, url) {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			const arrayBuffer = await response.arrayBuffer();
			if (arrayBuffer.byteLength === 0) {
				throw new Error('Empty response');
			}
			const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
			const key = `${soundBank}-${note}`;
			this.buffers.set(key, audioBuffer);
			return true;
		} catch (error) {
			console.error(`Failed to load sample for sound bank ${soundBank}, note ${note} from ${url}:`, error);
			return false;
		}
	}

	/**
	 * Load all samples for all sound banks
	 */
	async loadAllSamples() {
		const baseUrl = import.meta.env.BASE_URL;
		const loadPromises = [];

		// Load samples for each sound bank
		// For now, we only have samples for banks 0 and 1
		// Bank 0: drum - koan remnants (8 samples: 01.wav through 08.wav)
		// Bank 1: note - massive x astral float (8 samples: 01.wav through 08.wav)
		for (let soundBank = 0; soundBank < 3; soundBank++) {
			const bankDir = this.soundBanks[soundBank];
			// Load 8 samples per bank (notes 0-7, files 01.wav through 08.wav)
			for (let note = 0; note < 8; note++) {
				const fileNum = String(note + 1).padStart(2, '0');
				const url = `${baseUrl}samples/${bankDir}/${fileNum}.wav`;
				console.log(url);
				loadPromises.push(this.loadSample(soundBank, note, url));
			}
		}

		await Promise.all(loadPromises);
		console.log('All samples loaded');
	}

	/**
	 * Play a sample for a given sound bank and note
	 * @param {number} soundBank - Sound bank index (0-7)
	 * @param {number} note - Note number (0-7)
	 * @param {number} time - Audio context time to play at (optional)
	 */
	playSample(soundBank, note, time = null) {
		const key = `${soundBank}-${note}`;
		const buffer = this.buffers.get(key);
		if (!buffer) {
			return;
		}

		const source = this.audioContext.createBufferSource();
		source.buffer = buffer;
		source.connect(this.audioContext.destination);

		const playTime = time !== null ? time : this.audioContext.currentTime;
		source.start(playTime);
	}

	/**
	 * Check if a step is active in a row value
	 * Only checks the blue switches (last 32 bits, bits 0-31)
	 * @param {number} value - The row value (48-bit number, but only last 32 bits are used)
	 * @param {number} tickCount - Current tick count from the clock
	 * @returns {boolean}
	 */
	isStepActive(value, tickCount) {
		// Only use the last 32 bits (blue switches)
		// Steps are numbered from left to right within the blue switches
		// Step 0 maps to bit 31 (leftmost blue switch bit)
		// Step 31 maps to bit 0 (rightmost blue switch bit)
		const bitPosition = 31 - (tickCount % 32);
		// Use BigInt for bit operations
		const bigValue = BigInt(value);
		const bitMask = 1n << BigInt(bitPosition);
		return (bigValue & bitMask) !== 0n;
	}

	/**
	 * Extract per-row settings from the settings bytes
	 * @param {number} settings - Settings value (first 2 bytes, 16 bits)
	 * @returns {Object} Object with solo, mute, midiChannel, note, and euclideanMode properties
	 */
	extractRowSettings(settings) {
		// Extract first byte (bits 15-8, the leftmost byte)
		const firstByte = (settings >> 8) & 0xff;

		// Bit 7 (leftmost bit of first byte): solo
		const solo = (firstByte >> 7) & 0b1;

		// Bit 6: mute
		const mute = (firstByte >> 6) & 0b1;

		// Bits 5-3: MIDI Channel (sound bank selection, 0-7)
		const midiChannel = (firstByte >> 3) & 0b111;

		// Bits 2-0: note (0-7)
		const note = (firstByte >> 0) & 0b111;

		// Extract second byte (bits 7-0, the rightmost byte)
		const secondByte = settings & 0xff;

		// Bit 0 (last bit of second byte): Euclidean sequencer mode
		const euclideanMode = (secondByte >> 0) & 0b1;

		return { solo: solo === 1, mute: mute === 1, midiChannel, note, euclideanMode: euclideanMode === 1 };
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

		// Use standard Euclidean rhythm algorithm (threshold method)
		// This ensures the first step is active when k > 0, matching common sequencer behavior
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
		// Extract most significant byte (bits 31-24): Total Steps
		const totalSteps = (notes >> 24) & 0xff;

		// If totalSteps is 0, don't play anything
		if (totalSteps === 0) {
			return null;
		}

		// Extract 2nd byte (bits 23-16): Total Pulses
		const pulses = (notes >> 16) & 0xff;

		// Extract 3rd byte (bits 15-8): Initial Rotation (treat as signed)
		const initialRotationRaw = (notes >> 8) & 0xff;
		const initialRotation = initialRotationRaw > 127 ? 128 - initialRotationRaw : initialRotationRaw;

		// Extract 4th byte (bits 7-0): Rotation Increment (treat as signed)
		const rotationIncrementRaw = notes & 0xff;
		const rotationIncrement = rotationIncrementRaw > 127 ? 128 - rotationIncrementRaw : rotationIncrementRaw;

		// Clamp pulses to valid range (0 to totalSteps)
		const effectivePulses = Math.max(0, Math.min(totalSteps, pulses));

		// Check cache for base pattern (without rotation)
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

		// Parameters changed or not cached - regenerate base pattern
		const pattern = this.generateEuclideanPattern(totalSteps, effectivePulses);

		// Cache the base pattern and parameters
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
	 * @returns {boolean}
	 */
	isStepActiveEuclidean(index, notes, tickCount) {
		// Get cached base pattern and parameters (or generate if needed)
		const cacheEntry = this.getEuclideanPattern(index, notes);

		// If pattern is null (totalSteps is 0), don't play
		if (cacheEntry === null) {
			return false;
		}

		const { pattern, totalSteps, initialRotation, rotationIncrement } = cacheEntry;

		// Calculate current rotation: Initial Rotation + Rotation Increment * # completed cycles
		// Rotation advances after completing a full cycle
		const repeats = Math.floor(tickCount / totalSteps);
		const currentRotation = initialRotation + rotationIncrement * repeats;

		// Apply rotation as an index offset instead of rotating the array
		const mappedIndex = tickCount % totalSteps;
		const rotatedIndex = (mappedIndex - currentRotation + totalSteps) % totalSteps;
		const isActive = pattern[rotatedIndex];

		return isActive;
	}

	/**
	 * Process a tick - check all rows and play samples for active steps
	 * @param {number} tickCount - Current tick count
	 * @param {Map<number, {settings: number, notes: number}>} rowValues - Map of row indices to their current values
	 */
	processTick(tickCount, rowValues) {
		// Ensure audio context is running
		if (this.audioContext.state === 'suspended') {
			this.audioContext.resume().catch(err => {
				console.error('Error resuming audio context:', err);
			});
		}

		// First pass: check if any row has solo enabled
		let hasAnySolo = false;
		const rowSettings = new Map();
		for (const [index, value] of rowValues.entries()) {
			if (index === 0) continue; // Skip SET row (index 0)
			const settings = this.extractRowSettings(value.settings || 0);
			rowSettings.set(index, settings);
			if (settings.solo) {
				hasAnySolo = true;
			}
		}

		// Second pass: play samples based on solo/mute logic
		for (const [index, value] of rowValues.entries()) {
			// Skip SET row (index 0, it's for BPM control, not audio)
			if (index === 0) continue;

			const settings = rowSettings.get(index);
			if (!settings) continue;

			// Check mute: if muted, don't play
			if (settings.mute) {
				continue;
			}

			// Check solo: if any row has solo, only play rows with solo enabled
			if (hasAnySolo && !settings.solo) {
				continue;
			}

			// Check if step is active (normal or Euclidean mode)
			let stepActive = false;
			if (settings.euclideanMode) {
				// Euclidean sequencer: use notes value to determine pattern
				stepActive = this.isStepActiveEuclidean(index, value.notes || 0, tickCount);
			} else {
				// Normal sequencer: use notes switches directly
				stepActive = this.isStepActive(value.notes || 0, tickCount);
			}

			if (stepActive) {
				// Use audio context time for precise timing
				const playTime = this.audioContext.currentTime;
				this.playSample(settings.midiChannel, settings.note, playTime);
			}
		}
	}
}
