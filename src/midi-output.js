const SCALE_OFFSETS = [
	[0, 1, 2, 3, 4, 5, 6, 7], // Chromatic
	[0, 2, 4, 5, 7, 9, 11, 12], // Major
	[0, 2, 3, 5, 7, 8, 10, 12], // Minor
	[0, 2, 4, 7, 9, 12, 14, 16], // Pentatonic
];

/**
 * MIDI output handler for the sequencer
 * Sends MIDI note on/off messages when steps are active
 */
export class MidiOutput {
	constructor() {
		this.midiAccess = null;
		this.outputPort = null;
		this.activeNotes = new Map(); // Track active notes per row to send note off
		this.isInitialized = false;
		this.initializationPromise = null;
	}

	/**
	 * Check if Web MIDI API is available in this browser
	 * @returns {boolean}
	 */
	static isSupported() {
		return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
	}

	/**
	 * Request MIDI access and select an output port
	 */
	async initialize() {
		// If already initialized or initializing, return the existing promise
		if (this.isInitialized) return true;
		if (this.initializationPromise) return this.initializationPromise;

		// Check if MIDI API is supported
		if (!MidiOutput.isSupported()) {
			console.warn('Web MIDI API not supported in this browser');
			return false;
		}

		this.initializationPromise = (async () => {
			try {
				this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
				const outputs = Array.from(this.midiAccess.outputs.values());

				if (outputs.length === 0) {
					console.warn('No MIDI output devices found');
					this.initializationPromise = null;
					return false;
				}

				// Use the first available output
				this.outputPort = outputs[0];
				this.isInitialized = true;
				this.initializationPromise = null;
				return true;
			} catch (error) {
				console.error('Failed to initialize MIDI:', error);
				this.initializationPromise = null;
				return false;
			}
		})();

		return this.initializationPromise;
	}

	/**
	 * Check if MIDI output is enabled
	 * Enabled by the 3rd bit from the right on the rightmost byte in the settings row
	 * @param {number} settingsRowNotes - The notes value from the settings row
	 * @returns {boolean}
	 */
	isMidiEnabled(settingsRowNotes) {
		// Rightmost byte is byte 5 (index 5), which is bits 39-32
		// 3rd bit from the right = bit 2 (0-indexed from right) = bit 5 (1-indexed from left)
		const rightmostByte = (settingsRowNotes >> 0) & 0xff;
		return ((rightmostByte >> 2) & 0b1) === 1;
	}

	/**
	 * Extract scale settings from the 3rd settings row byte (byte index 2)
	 * @param {number} settingsRowNotes - The notes value from the settings row
	 * @returns {{noteOffset: number, scaleIndex: number}}
	 */
	extractScaleSettings(settingsRowNotes) {
		const scaleByte = (settingsRowNotes >> 16) & 0xff;

		const noteOffset = (scaleByte >> 2) & 0b111111;
		const scaleIndex = (scaleByte >> 0) & 0b11; // 0-3

		return { noteOffset, scaleIndex };
	}

	/**
	 * Calculate MIDI note number
	 * @param {number} noteSelect - The note select value from the row (0-7)
	 * @param {number} noteOffset - The note offset from scale settings
	 * @param {number} scaleIndex - The scale index (0=chromatic, 1=major, 2=minor, 3=pentatonic)
	 * @returns {number} MIDI note number (0-127)
	 */
	calculateMidiNote(noteSelect, noteOffset, scaleIndex) {
		if (scaleIndex < 0 || scaleIndex >= SCALE_OFFSETS.length) {
			scaleIndex = 0; // Default to chromatic
		}

		const scale = SCALE_OFFSETS[scaleIndex];
		const noteIndex = Math.max(0, Math.min(7, noteSelect));
		const scaleOffset = scale[noteIndex] || 0;

		// A0 is MIDI note 21, so offset 0 maps to A0
		const midiNote = 21 + noteOffset + scaleOffset;
		return Math.max(0, Math.min(127, midiNote));
	}

	/**
	 * Send a MIDI note on message
	 * @param {number} channel - MIDI channel (0-15)
	 * @param {number} note - MIDI note number (0-127)
	 * @param {number} velocity - Velocity (0-127, default 127)
	 */
	sendNoteOn(channel, note, velocity = 127) {
		if (!this.outputPort) return;

		const channelByte = 0x90 | (channel & 0x0f); // Note on for channel
		const noteByte = note & 0x7f;
		const velocityByte = velocity & 0x7f;

		try {
			this.outputPort.send([channelByte, noteByte, velocityByte]);
		} catch (error) {
			console.error('Error sending MIDI note on:', error);
		}
	}

	/**
	 * Send a MIDI note off message
	 * @param {number} channel - MIDI channel (0-15)
	 * @param {number} note - MIDI note number (0-127)
	 */
	sendNoteOff(channel, note) {
		if (!this.outputPort) return;

		const channelByte = 0x80 | (channel & 0x0f); // Note off for channel
		const noteByte = note & 0x7f;

		try {
			this.outputPort.send([channelByte, noteByte, 0]);
		} catch (error) {
			console.error('Error sending MIDI note off:', error);
		}
	}

	/**
	 * Process a tick and send MIDI messages for active steps
	 * @param {number} tickCount - Current tick count
	 * @param {Map<number, {settings: number, notes: number}>} rowValues - Map of row indices to values
	 * @param {number} settingsRowNotes - The notes value from the settings row
	 * @param {Function} extractRowSettings - Function to extract row settings
	 * @param {Function[]} stepCheckers - Array of step checker functions
	 */
	async processTick(tickCount, rowValues, settingsRowNotes, extractRowSettings, stepCheckers) {
		if (!this.isMidiEnabled(settingsRowNotes)) {
			// Send note off for all active notes when MIDI is disabled
			this.allNotesOff();
			return;
		}

		// Initialize MIDI if not already initialized and MIDI is enabled
		if (!this.isInitialized && MidiOutput.isSupported()) {
			const initialized = await this.initialize();
			if (!initialized) {
				return; // MIDI initialization failed
			}
		}

		if (!this.outputPort) return;

		const { noteOffset, scaleIndex } = this.extractScaleSettings(settingsRowNotes);
		const instrumentRows = Array.from(rowValues.entries()).slice(1);

		// Calculate solo/mute state (same logic as sample player)
		let hasAnySolo = false;
		const rowSettings = new Map();
		for (const [index, value] of instrumentRows) {
			const settings = extractRowSettings(value.settings || 0);
			rowSettings.set(index, settings);
			if (settings.solo) hasAnySolo = true;
		}

		// Track currently active notes
		const currentlyActive = new Set();

		for (const [index, value] of instrumentRows) {
			const settings = rowSettings.get(index);
			if (!settings || settings.mute || (hasAnySolo && !settings.solo)) continue;

			const stepChecker = stepCheckers[settings.mode];
			if (!stepChecker) continue;

			const isActive = stepChecker(index, value.notes || 0, tickCount, settings.modeSettings);
			if (isActive) {
				const midiNote = this.calculateMidiNote(settings.note, noteOffset, scaleIndex);
				const noteKey = `${index}-${settings.midiChannel}-${midiNote}`;
				currentlyActive.add(noteKey);

				// If this note wasn't active before, send note on
				if (!this.activeNotes.has(noteKey)) {
					this.sendNoteOn(settings.midiChannel, midiNote, 127);
					this.activeNotes.set(noteKey, { channel: settings.midiChannel, note: midiNote });
				}
			}
		}

		// Send note off for notes that are no longer active
		for (const [noteKey, noteData] of this.activeNotes.entries()) {
			if (!currentlyActive.has(noteKey)) {
				this.sendNoteOff(noteData.channel, noteData.note);
				this.activeNotes.delete(noteKey);
			}
		}
	}

	/**
	 * Send note off for all active notes
	 */
	allNotesOff() {
		for (const [noteKey, noteData] of this.activeNotes.entries()) {
			this.sendNoteOff(noteData.channel, noteData.note);
		}
		this.activeNotes.clear();
	}
}
