class DipSwitchGroup extends HTMLElement {
	static observedAttributes = ['data-settings', 'disabled'];

	constructor() {
		super();
		this._switches = [];
	}

	connectedCallback() {
		// Only initialize if not already initialized
		if (this.querySelector('dip-switch')) return;

		// Create 6 dip-switch elements
		const isSetRow = this.hasAttribute('data-settings');

		for (let i = 0; i < 6; i++) {
			const switchEl = document.createElement('dip-switch');
			// Add class to first 2 switches for red background, or all switches if SET row
			if (isSetRow || i < 2) {
				switchEl.classList.add('red-switch');
			}
			switchEl.setAttribute('value', '0');
			this._switches.push(switchEl);
			this.appendChild(switchEl);
		}

		// Listen for changes from any switch
		this._switches.forEach(switchEl => {
			switchEl.addEventListener('change', () => {
				this.dispatchEvent(new Event('change', { bubbles: true }));
			});
		});
	}

	attributeChangedCallback(name) {
		if (name === 'disabled') {
			const disabled = this.hasAttribute('disabled');
			this._switches.forEach(switchEl => {
				switchEl.disabled = disabled;
			});
		}
	}

	get value() {
		// Return an object with settings (first 2 bytes) and notes (last 4 bytes)
		// This avoids 48-bit number issues with JavaScript bitwise operations
		const numSwitches = this._switches.length;

		// First 2 bytes: settings (16 bits)
		let settings = 0;
		for (let i = 0; i < 2 && i < numSwitches; i++) {
			const byte = this._switches[i]?.value || 0;
			settings = (settings << 8) | byte;
		}

		// Last 4 bytes: notes (32 bits)
		let notes = 0;
		for (let i = 2; i < numSwitches; i++) {
			const byte = this._switches[i]?.value || 0;
			notes = (notes << 8) | byte;
		}

		return { settings, notes };
	}

	set value(v) {
		// Accept either a number (for backward compatibility) or {settings, notes} object
		const numSwitches = this._switches.length;
		if (numSwitches === 0) return;

		if (typeof v === 'object' && v !== null && ('settings' in v || 'notes' in v)) {
			// New format: {settings, notes}
			const settings = v.settings || 0;
			const notes = v.notes || 0;

			// Set first 2 bytes from settings
			for (let i = 0; i < 2 && i < numSwitches; i++) {
				const shift = (1 - i) * 8;
				this._switches[i].value = (settings >> shift) & 0xff;
			}

			// Set last 4 bytes from notes
			for (let i = 2; i < numSwitches; i++) {
				const shift = (5 - i) * 8;
				this._switches[i].value = (notes >> shift) & 0xff;
			}
		} else {
			// Legacy format: single number (for backward compatibility with defaultValues)
			const val = Number(v);
			for (let i = 0; i < numSwitches; i++) {
				const divisor = Math.pow(256, numSwitches - 1 - i);
				this._switches[i].value = Math.floor((val / divisor) % 256) & 0xff;
			}
		}
	}

	get disabled() {
		return this.hasAttribute('disabled');
	}

	set disabled(v) {
		v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
	}

	/**
	 * Get a specific byte (dip-switch) element by index
	 * @param {number} byteIndex - Index of the byte (0-5)
	 * @returns {DipSwitch|null}
	 */
	getByte(byteIndex) {
		return this._switches[byteIndex] || null;
	}

	/**
	 * Get all byte values as an array
	 * @returns {number[]} Array of 6 byte values
	 */
	getAllBytes() {
		return this._switches.map(switchEl => switchEl.value);
	}

	/**
	 * Set all byte values from an array
	 * @param {number[]} bytes - Array of byte values
	 */
	setAllBytes(bytes) {
		bytes.forEach((byte, i) => {
			if (this._switches[i]) {
				this._switches[i].value = byte;
			}
		});
	}
}

customElements.define('dip-switch-group', DipSwitchGroup);
