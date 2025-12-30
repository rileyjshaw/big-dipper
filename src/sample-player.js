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
		].map(fn => fn.bind(this));
	}

	setupMasterGain() {
		if (this.masterGainNode) return;
		this.masterGainNode = this.audioContext.createGain();
		this.masterGainNode.gain.value = 1.0;
		this.masterGainNode.connect(this.audioContext.destination);
	}

	/**
	 * Decode preloaded sample data into AudioBuffers
	 * @param {Map<string, ArrayBuffer>} preloadedData
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
	 * @param {number} volume - Volume level (0-1, optional)
	 */
	async playSample(soundBank, note, time = null, volume = 1) {
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

		const gainNode = this.audioContext.createGain();
		gainNode.gain.value = volume;

		source.connect(gainNode);
		gainNode.connect(this.masterGainNode || this.audioContext.destination);

		const playTime = time !== null ? time : this.audioContext.currentTime;
		source.start(playTime);
	}

	/**
	 * Check if a step is active in step mode
	 * @param {number} _index - Row index (unused)
	 * @param {number} notes - Row value (uses last 32 bits)
	 * @param {number} tickCount - Current tick count
	 * @param {number} modeSettings - Sequence length
	 * @returns {boolean}
	 */
	isStepActive(_index, notes, tickCount, modeSettings) {
		const sequenceLength = modeSettings || 32;
		const bitPosition = 31 - (tickCount % sequenceLength);
		const bitMask = 1 << bitPosition;
		return !!(notes & bitMask);
	}

	/**
	 * Extract per-row settings from settings bytes
	 * @param {number} settings - Settings value (16 bits)
	 * @returns {Object} {solo, mute, midiChannel, note, mode, modeSettings}
	 */
	extractRowSettings(settings) {
		const firstByte = (settings >> 8) & 0xff;

		const solo = !!((firstByte >> 7) & 0b1);
		const mute = !!((firstByte >> 6) & 0b1);
		const midiChannel = (firstByte >> 3) & 0b111;
		const note = (firstByte >> 0) & 0b111;

		const secondByte = settings & 0xff;

		const mode = (secondByte >> 0) & 0b1; // TODO: Once more modes are added, & 0b111 instead.
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
	 * @param {number} n - Steps per cycle
	 * @param {number} k - Pulses per cycle
	 * @returns {boolean[]}
	 */
	generateEuclideanPattern(n, k) {
		if (k === 0) return new Array(n).fill(false);
		if (k >= n) return new Array(n).fill(true);

		const pattern = new Array(n);
		for (let i = 0; i < n; i++) {
			pattern[i] = (i * k) % n < k;
		}
		return pattern;
	}

	/**
	 * Get or generate cached Euclidean pattern for a row
	 * @param {number} index - Row index
	 * @param {number} notes - Notes value (bits 31-24: steps, 23-16: pulses, 15-8: initial rotation, 7-0: rotation increment)
	 * @returns {{pattern: boolean[], stepsPerCycle: number, pulsesPerCycle: number, initialRotation: number, rotationIncrement: number}|null}
	 */
	getEuclideanPattern(index, notes) {
		const stepsPerCycle = (notes >> 24) & 0xff;

		if (stepsPerCycle === 0) return null;

		const pulsesPerCycleRaw = (notes >> 16) & 0xff;
		const pulsesPerCycle = Math.max(0, Math.min(stepsPerCycle, pulsesPerCycleRaw));
		const initialRotationRaw = (notes >> 8) & 0xff;
		const initialRotation = initialRotationRaw > 127 ? 128 - initialRotationRaw : initialRotationRaw;
		const rotationIncrementRaw = notes & 0xff;
		const rotationIncrement = rotationIncrementRaw > 127 ? 128 - rotationIncrementRaw : rotationIncrementRaw;

		const cached = this.euclideanCache.get(index);
		if (
			cached &&
			cached.stepsPerCycle === stepsPerCycle &&
			cached.pulsesPerCycle === pulsesPerCycle &&
			cached.initialRotation === initialRotation &&
			cached.rotationIncrement === rotationIncrement
		) {
			return cached;
		}

		const pattern = this.generateEuclideanPattern(stepsPerCycle, pulsesPerCycle);

		const cacheEntry = { pattern, stepsPerCycle, pulsesPerCycle, initialRotation, rotationIncrement };
		this.euclideanCache.set(index, cacheEntry);

		return cacheEntry;
	}

	/**
	 * Check if a step is active using Euclidean sequencer
	 * @param {number} index - Row index
	 * @param {number} notes - Notes value (bits 31-24: steps, 23-16: pulses, 15-8: initial rotation, 7-0: rotation increment)
	 * @param {number} tickCount - Current tick count
	 * @param {number} modeSettings - Mode settings (bit 4: enable, bit 3: skip/play, bits 2-0: nth note)
	 * @returns {boolean}
	 */
	isStepActiveEuclidean(index, notes, tickCount, modeSettings) {
		const cacheEntry = this.getEuclideanPattern(index, notes);

		if (cacheEntry === null) return false;

		const { pattern, stepsPerCycle, pulsesPerCycle, initialRotation, rotationIncrement } = cacheEntry;

		const elapsedCycles = Math.floor(tickCount / stepsPerCycle);
		const rotation = (initialRotation + rotationIncrement * elapsedCycles) % stepsPerCycle;
		const stepIdx = (tickCount + stepsPerCycle - rotation) % stepsPerCycle;
		const isActive = pattern[stepIdx];

		const isSkipEnabled = (modeSettings >> 4) & 0b1;
		if (!(isSkipEnabled && isActive)) return isActive;

		const isSkipMode = !!((modeSettings >> 3) & 0b1);
		const nthNote = (modeSettings & 0b111) + 1;

		// Calculate how many active steps have occurred overall in prior cycles.
		let noteIdx = elapsedCycles * pulsesPerCycle;
		// Add the number of active steps already played in this cycle.
		const cycleProgress = tickCount % stepsPerCycle;
		for (let i = 0; i <= cycleProgress; ++i) {
			const rotatedIdx = (i + stepsPerCycle - rotation) % stepsPerCycle;
			if (pattern[rotatedIdx]) ++noteIdx;
		}
		const isNthStep = noteIdx % nthNote === 0;
		return isSkipMode === isNthStep;
	}

	/**
	 * Process a tick - check all rows and play samples for active steps
	 * @param {number} tickCount - Current tick count
	 * @param {Map<number, {settings: number, notes: number}>} rowValues - Map of row indices to values
	 * @param {number} masterVolume - Master volume (0-1, default 1)
	 */
	async processTick(tickCount, rowValues, masterVolume = 1) {
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
