/**
 * High-precision sequencer clock with drift correction
 * BPM is determined by bits in the SET row:
 * - Bits 15-7: BPM base (1-256)
 * - Bits 1-0: fractional part (0, 0.25, 0.5, 0.75)
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
	}

	/**
	 * Initialize the audio context (must be called after user interaction)
	 */
	async init() {
		if (!this.audioContext) {
			this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
		}
		// Always resume context to ensure it's running
		// This is safe to call even if already running
		if (this.audioContext.state === 'suspended') {
			await this.audioContext.resume();
		}
	}

	/**
	 * Calculate BPM from the settings value (first 16 bits)
	 * @param {number} settings - The settings value from the SET row (16 bits: first 2 switches × 8 bits)
	 * @returns {number} The calculated BPM
	 */
	calculateBPM(settings) {
		// Extract bits 15-7 for base BPM (8 bits)
		const baseBPM = (settings >> (16 - 8)) & 0b111111111;

		// Extract bits 1-0 for fractional part (last 2 bits)
		const fractionalBits = (settings >> (16 - 10)) & 0b11;
		const fractional = fractionalBits * 0.25;

		return baseBPM + fractional;
	}

	/**
	 * Calculate tick interval in milliseconds from BPM
	 * Each tick represents a sixteenth note
	 * @param {number} bpm - Beats per minute
	 * @returns {number} Tick interval in milliseconds, or 0 if BPM is invalid
	 */
	calculateTickInterval(bpm) {
		if (bpm <= 0) return 0;
		// Each tick represents a sixteenth note (1/4 of a quarter note)
		return ((60 / bpm) * 1000) / 4;
	}

	/**
	 * Start the clock
	 */
	async start() {
		if (this.isRunning) return;

		// Don't start if BPM is 0
		if (this.currentBPM <= 0) return;

		await this.init();

		// Ensure audio context is running
		if (this.audioContext && this.audioContext.state === 'suspended') {
			await this.audioContext.resume();
		}

		this.isRunning = true;
		this.tickCount = 0;

		// Calculate tick interval in milliseconds
		this.tickInterval = this.calculateTickInterval(this.currentBPM);

		// Use performance.now() for high precision
		this.startTime = performance.now();
		this.expectedTickTime = this.startTime;

		// Schedule first tick
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

		// If already running, just update the interval
		// The next scheduled tick will use the new interval naturally
		// This preserves timing and prevents stuttering
	}

	/**
	 * Schedule the next tick with drift correction
	 */
	scheduleNextTick() {
		if (!this.isRunning) return;

		const now = performance.now();
		const drift = now - this.expectedTickTime;

		// Calculate next tick time, correcting for drift
		// We subtract drift to keep the clock in sync
		this.expectedTickTime += this.tickInterval;
		const delay = Math.max(0, this.tickInterval - drift);

		this.timeoutId = setTimeout(() => {
			if (!this.isRunning) return;

			// Emit the tick
			this.emitTick();

			// Schedule next tick
			this.scheduleNextTick();
		}, delay);
	}

	/**
	 * Emit a tick event to all listeners
	 */
	emitTick() {
		const now = this.audioContext ? this.audioContext.currentTime : performance.now() / 1000;
		// Emit current tickCount (starts at 0 for first tick), then increment for next tick
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
	 * Remove a tick listener
	 * @param {Function} callback - Function to remove
	 */
	offTick(callback) {
		this.listeners.delete(callback);
	}

	/**
	 * Get current BPM
	 * @returns {number}
	 */
	getBPM() {
		return this.currentBPM;
	}
}
