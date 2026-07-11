/**
 * High-precision sequencer clock with lookahead scheduling
 *
 * Instead of firing sounds when a timer callback happens to run (which is at
 * the mercy of main-thread jitter, GC pauses, and timer clamping), a scheduler
 * wakes up every SCHEDULER_INTERVAL_MS and schedules every tick that falls
 * within the next LOOKAHEAD_SECONDS at an exact AudioContext timestamp.
 * Listeners receive that timestamp and pass it to the sample-accurate Web
 * Audio scheduler (source.start(time)), so timer jitter only has to stay
 * under the lookahead window to be inaudible.
 *
 * The scheduler timer runs in a Web Worker because worker timers are exempt
 * from the aggressive setTimeout throttling applied to backgrounded tabs —
 * important since other tabs can follow this one's clock.
 *
 * BPM is determined by bits in the SET row:
 * - First byte (bits 15-8): Tempo value (0-255)
 * - Second byte (bits 7-0):
 *   - Bit 7 (MSB): Multiply/divide flag (0 = divide, 1 = multiply, defaults to divide when down)
 *   - Bits 6-5: Tempo factor exponent (2 bits, 0-3, factor = 2^n)
 *   - Bits 4-0: Unused
 * BPM = (base tempo) times/divided by (2^n) / 4
 */

const LOOKAHEAD_SECONDS = 0.1;
const SCHEDULER_INTERVAL_MS = 25;

const SCHEDULER_WORKER_SOURCE = `
	let intervalId = null;
	onmessage = e => {
		if (e.data.type === 'start') {
			clearInterval(intervalId);
			intervalId = setInterval(() => postMessage('tick'), e.data.interval);
			postMessage('tick');
		} else if (e.data.type === 'stop') {
			clearInterval(intervalId);
			intervalId = null;
		}
	};
`;

export class SequencerClock {
	constructor() {
		this.audioContext = null;
		this.isRunning = false;
		this.currentBPM = 120;
		this.tickIntervalSeconds = 0;
		this.listeners = new Set();
		this.nextTickTime = 0;
		this.tickCount = 0;
		this.isFollowingExternal = false;
		this.schedulerWorker = null;
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
	 * Calculate tick interval in seconds from BPM
	 * Each tick represents a sixteenth note
	 * @param {number} bpm - Beats per minute
	 * @returns {number} Tick interval in seconds, or 0 if BPM is invalid
	 */
	calculateTickInterval(bpm) {
		if (bpm <= 0) return 0;
		return 60 / bpm / 4;
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

		this.tickIntervalSeconds = this.calculateTickInterval(this.currentBPM);

		this.nextTickTime = this.audioContext.currentTime + SCHEDULER_INTERVAL_MS / 1000;

		if (!this.schedulerWorker) {
			const blob = new Blob([SCHEDULER_WORKER_SOURCE], { type: 'application/javascript' });
			const workerUrl = URL.createObjectURL(blob);
			try {
				this.schedulerWorker = new Worker(workerUrl);
			} finally {
				URL.revokeObjectURL(workerUrl);
			}
			this.schedulerWorker.onmessage = () => this.scheduleTicks();
		}
		this.schedulerWorker.postMessage({ type: 'start', interval: SCHEDULER_INTERVAL_MS });
	}

	/**
	 * Stop the clock
	 */
	stop() {
		this.isRunning = false;
		if (this.schedulerWorker) {
			this.schedulerWorker.postMessage({ type: 'stop' });
		}
	}

	/**
	 * Update the BPM and recalculate timing
	 * @param {number} bpm - New BPM value
	 */
	setBPM(bpm) {
		this.currentBPM = bpm;
		this.tickIntervalSeconds = this.calculateTickInterval(bpm);
	}

	/**
	 * Schedule all ticks that fall within the lookahead window
	 */
	scheduleTicks() {
		if (!this.isRunning || this.tickIntervalSeconds <= 0) return;

		const now = this.audioContext.currentTime;

		// If the scheduler was starved for longer than the lookahead window
		// (e.g. the tab was suspended), skip the missed ticks instead of
		// bursting them all at once. Advancing tickCount keeps the pattern
		// position moving as if the ticks had played.
		if (this.nextTickTime < now) {
			const missed = Math.ceil((now - this.nextTickTime) / this.tickIntervalSeconds);
			this.nextTickTime += missed * this.tickIntervalSeconds;
			this.tickCount += missed;
		}

		while (this.nextTickTime < now + LOOKAHEAD_SECONDS) {
			this.emitTick(this.nextTickTime);
			this.nextTickTime += this.tickIntervalSeconds;
		}
	}

	/**
	 * Emit a tick event to all listeners
	 * @param {number} time - AudioContext time at which the tick should sound
	 */
	emitTick(time) {
		this.listeners.forEach(listener => {
			try {
				const result = listener(time, this.tickCount);
				result?.catch?.(error => console.error('Error in clock listener:', error));
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
