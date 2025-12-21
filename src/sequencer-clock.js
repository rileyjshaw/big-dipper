/**
 * High-precision sequencer clock with drift correction
 * BPM is determined by bits in the SET row:
 * - First byte (bits 15-8): Tempo value (0-255)
 * - Second byte (bits 7-0):
 *   - Bit 7 (MSB): Multiply/divide flag (0 = divide, 1 = multiply, defaults to divide when down)
 *   - Bits 6-5: Tempo factor exponent (2 bits, 0-3, factor = 2^n)
 *   - Bits 4-0: Unused
 * BPM = (base tempo) times/divided by (2^n) / 4
 */
export class SequencerClock {
	constructor() {
		this.audioContext = null;
		this.isRunning = false;
		this.currentBPM = 120;
		this.tickInterval = 0;
		this.listeners = new Set();
		this.timeoutId = null;
		this.startTime = 0;
		this.expectedTickTime = 0;
		this.tickCount = 0;
		this.isFollowingExternal = false;
	}

	/**
	 * Extract tempo settings from the settings value
	 * @param {number} settings - The settings value from the SET row (16 bits: first 2 switches × 8 bits)
	 * @returns {{baseTempo: number, isMultiply: boolean, tempoFactorExponent: number}}
	 */
	extractTempoSettings(settings) {
		const baseTempo = (settings >> 8) & 0xff;

		const secondByte = settings & 0xff;

		const isMultiply = ((secondByte >> 7) & 0b1) === 1;

		const tempoFactorExponent = (secondByte >> 5) & 0b11;

		return { baseTempo, isMultiply, tempoFactorExponent };
	}

	/**
	 * Calculate BPM from the settings value (first 16 bits)
	 * @param {number} settings - The settings value from the SET row (16 bits: first 2 switches × 8 bits)
	 * @returns {number} The calculated BPM
	 */
	calculateBPM(settings) {
		const { baseTempo, isMultiply, tempoFactorExponent } = this.extractTempoSettings(settings);

		const factor = Math.pow(2, tempoFactorExponent);

		if (isMultiply) {
			return (baseTempo * factor) / 4;
		} else {
			return baseTempo / (factor * 4);
		}
	}

	/**
	 * Calculate the maximum possible BPM for a given base tempo
	 * This is used for broadcasting ticks at the maximum rate
	 * @param {number} baseTempo - The base tempo value (0-255)
	 * @returns {number} The maximum BPM (when multiply is on and exponent is 3, factor = 8)
	 */
	calculateMaxBPM(baseTempo) {
		return baseTempo * 2;
	}

	/**
	 * Calculate tick interval in milliseconds from BPM
	 * Each tick represents a sixteenth note
	 * @param {number} bpm - Beats per minute
	 * @returns {number} Tick interval in milliseconds, or 0 if BPM is invalid
	 */
	calculateTickInterval(bpm) {
		if (bpm <= 0) return 0;
		return ((60 / bpm) * 1000) / 4;
	}

	/**
	 * Start the clock
	 */
	async start() {
		if (this.isRunning) return;

		if (this.currentBPM <= 0) return;

		if (!this.audioContext) {
			throw new Error('AudioContext not created - must be created in user gesture handler');
		} else if (this.audioContext.state === 'suspended') {
			await this.audioContext.resume();
		}

		this.isRunning = true;
		this.tickCount = 0;

		this.tickInterval = this.calculateTickInterval(this.currentBPM);

		this.startTime = performance.now();
		this.expectedTickTime = this.startTime;

		this.scheduleNextTick();
	}

	/**
	 * Stop the clock
	 */
	stop() {
		this.isRunning = false;
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}

	/**
	 * Update the BPM and recalculate timing
	 * @param {number} bpm - New BPM value
	 */
	setBPM(bpm) {
		this.currentBPM = bpm;
		this.tickInterval = this.calculateTickInterval(bpm);
	}

	/**
	 * Schedule the next tick with drift correction
	 */
	scheduleNextTick() {
		if (!this.isRunning) return;

		const now = performance.now();
		const drift = now - this.expectedTickTime;

		this.expectedTickTime += this.tickInterval;
		const delay = Math.max(0, this.tickInterval - drift);

		this.timeoutId = setTimeout(() => {
			if (!this.isRunning) return;

			this.emitTick();

			this.scheduleNextTick();
		}, delay);
	}

	/**
	 * Emit a tick event to all listeners
	 */
	emitTick() {
		const now = this.audioContext ? this.audioContext.currentTime : performance.now() / 1000;
		this.listeners.forEach(listener => {
			try {
				listener(now, this.tickCount);
			} catch (error) {
				console.error('Error in clock listener:', error);
			}
		});
		this.tickCount++;
	}

	/**
	 * Add a listener for clock ticks
	 * @param {Function} callback - Function to call on each tick (receives time, tickCount)
	 */
	onTick(callback) {
		this.listeners.add(callback);
	}

	/**
	 * Determine if a tick should be processed based on tempo factor filtering
	 * @param {number} tickCount - The tick count from the external clock
	 * @param {number} settings - The settings value to extract tempo settings from
	 * @returns {boolean} Whether this tick should be processed
	 */
	shouldProcessTick(tickCount, settings) {
		const { baseTempo, isMultiply, tempoFactorExponent } = this.extractTempoSettings(settings);

		if (baseTempo === 0) return false;

		const factor = Math.pow(2, tempoFactorExponent);
		const maxFactor = 8;

		const ratio = isMultiply ? factor / maxFactor : 1 / (maxFactor * factor);

		if (ratio >= 1) return true;

		const step = Math.round(1 / ratio);
		return tickCount % step === 0;
	}

	/**
	 * Calculate effective tick count based on tempo factor
	 * @param {number} tickCount - The max-rate tick count
	 * @param {number} settings - The settings value to extract tempo settings from
	 * @returns {number} The effective tick count for this tempo factor
	 */
	calculateEffectiveTickCount(tickCount, settings) {
		const { isMultiply, tempoFactorExponent } = this.extractTempoSettings(settings);
		const maxFactor = 8;
		const factor = Math.pow(2, tempoFactorExponent);

		if (isMultiply) {
			return Math.floor((tickCount * factor) / maxFactor);
		} else {
			return Math.floor(tickCount / (maxFactor * factor));
		}
	}
}
