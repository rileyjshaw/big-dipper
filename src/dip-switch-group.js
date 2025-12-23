class DipSwitchGroup extends HTMLElement {
	static observedAttributes = ['data-settings'];

	constructor() {
		super();
		this._switches = [];
	}

	connectedCallback() {
		if (this.querySelector('dip-switch')) return;

		const isSetRow = this.hasAttribute('data-settings');

		for (let i = 0; i < 6; i++) {
			const switchEl = document.createElement('dip-switch');
			if (isSetRow || i < 2) {
				switchEl.classList.add('red-switch');
			}
			switchEl.setAttribute('value', '0');
			this._switches.push(switchEl);
			this.appendChild(switchEl);
		}

		this._switches.forEach(switchEl => {
			switchEl.addEventListener('change', () => {
				this.dispatchEvent(new Event('change', { bubbles: true }));
			});
		});
	}

	get value() {
		const numSwitches = this._switches.length;

		let settings = 0;
		for (let i = 0; i < 2 && i < numSwitches; i++) {
			const byte = this._switches[i]?.value || 0;
			settings = (settings << 8) | byte;
		}

		let notes = 0;
		for (let i = 2; i < numSwitches; i++) {
			const byte = this._switches[i]?.value || 0;
			notes = (notes << 8) | byte;
		}

		return { settings, notes };
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
