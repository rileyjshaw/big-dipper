class DipSwitch extends HTMLElement {
	static observedAttributes = ['value', 'name', 'label', 'disabled'];

	constructor() {
		super();
		this._boxes = [];
	}

	connectedCallback() {
		if (this._fieldset) return;

		this.innerHTML = `
      <fieldset class="fieldset">
        <legend class="legend"></legend>
        <div class="row"></div>
      </fieldset>
    `;
		this._fieldset = this.querySelector('fieldset');
		this._legend = this.querySelector('legend');
		this._row = this.querySelector('.row');

		for (let bit = 0; bit < 8; ++bit) {
			const label = document.createElement('label');
			label.className = 'switch';
			label.innerHTML = `
        <input class="input" type="checkbox" data-bit="${8 - bit - 1}">
        <span class="bit" aria-hidden="true">${bit + 1}</span>
      `;
			this._row.append(label);
		}

		this._boxes = [...this.querySelectorAll('input[type="checkbox"]')];

		let mouseDown = false;
		this.addEventListener('mousedown', () => {
			mouseDown = true;
		});
		this.addEventListener('mouseup', () => {
			mouseDown = false;
		});

		this._boxes.forEach(box => {
			box.addEventListener('focus', () => {
				if (!mouseDown && box.matches(':focus-visible')) {
					this.classList.add('keyboard-focus');
				}
			});
			box.addEventListener('blur', () => {
				this.classList.remove('keyboard-focus');
			});
		});

		this.addEventListener('change', e => {
			if (!(e.target instanceof HTMLInputElement)) return;
			this._syncValueFromUI();
			this._syncHiddenInput();
			this.dispatchEvent(new Event('change', { bubbles: true }));
		});

		if (!this.hasAttribute('value')) this.value = 0;
		this._syncUIFromValue(this.value);
		this._syncLegend();
		this._applyDisabled();
		this._syncHiddenInput();

		this.addEventListener('mouseenter', () => {
			this.classList.add('expert-focus');
			if (window.setSelectedByteFromElement) {
				window.setSelectedByteFromElement(this);
			}
		});

		this.addEventListener('mouseleave', () => {
			if (window.isByteSelected && !window.isByteSelected(this)) {
				this.classList.remove('expert-focus');
			}
		});
	}

	/**
	 * Toggle a specific bit by its position (1-8, where 1=leftmost/MSB, 8=rightmost/LSB)
	 * @param {number} bitPosition - Bit position 1-8
	 */
	toggleBit(bitPosition) {
		if (bitPosition < 1 || bitPosition > 8) return;
		const dataBit = 8 - bitPosition;
		const box = this._boxes.find(b => Number(b.dataset.bit) === dataBit);
		if (box) {
			box.checked = !box.checked;
			this._syncValueFromUI();
			this._syncHiddenInput();
			this.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}

	attributeChangedCallback(name, oldValue, newValue) {
		if (!this._fieldset) return;

		if (name === 'value') {
			const oldNum = oldValue !== null ? Number(oldValue) : null;
			const newNum = newValue !== null ? Number(newValue) : null;
			const valueChanged = oldNum !== newNum;

			this._syncUIFromValue(this.value);

			if (valueChanged) {
				this.dispatchEvent(new Event('change', { bubbles: true }));
			}
		}
		if (name === 'label') this._syncLegend();
		if (name === 'disabled') this._applyDisabled();
		if (name === 'name') this._syncHiddenInput();
	}

	get value() {
		const n = Number(this.getAttribute('value'));
		return Number.isFinite(n) ? clampByte(n | 0) : 0;
	}

	set value(n) {
		this.setAttribute('value', String(clampByte(Number(n) | 0)));
		this._syncHiddenInput();
	}

	get name() {
		return this.getAttribute('name') ?? '';
	}

	set name(v) {
		this.setAttribute('name', v);
	}

	get label() {
		return this.getAttribute('label') ?? '';
	}

	set label(v) {
		this.setAttribute('label', v);
	}

	get disabled() {
		return this.hasAttribute('disabled');
	}

	set disabled(v) {
		v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
	}

	_syncValueFromUI() {
		if (!this._boxes || this._boxes.length === 0) return;
		let n = 0;
		for (const box of this._boxes) {
			if (box.checked) n |= 1 << Number(box.dataset.bit);
		}
		this.setAttribute('value', String(n));
	}

	_syncUIFromValue(v) {
		if (!this._boxes || this._boxes.length === 0) return;
		for (const box of this._boxes) {
			const bit = Number(box.dataset.bit);
			box.checked = (v & (1 << bit)) !== 0;
		}
	}

	_applyDisabled() {
		if (!this._boxes || this._boxes.length === 0) return;
		const d = this.disabled;
		for (const box of this._boxes) box.disabled = d;
	}

	_syncLegend() {
		if (!this._legend || !this._fieldset) return;
		const label = (this.label ?? '').trim();
		if (label) {
			this._legend.textContent = label;
			this._legend.removeAttribute('aria-hidden');
			this._fieldset.removeAttribute('aria-label');
		} else {
			this._legend.textContent = 'On';
			this._legend.setAttribute('aria-hidden', 'true');
			this._fieldset.setAttribute('aria-label', 'DIP switch');
		}
	}

	_syncHiddenInput() {
		const form = this.closest('form');
		const name = this.name;
		if (!form || !name) {
			this._hidden?.remove();
			this._hidden = null;
			return;
		}

		if (!this._hidden) {
			this._hidden = document.createElement('input');
			this._hidden.type = 'hidden';
			this.after(this._hidden);
		}

		this._hidden.name = name;
		this._hidden.value = String(this.value);
		this._hidden.disabled = this.disabled;
	}
}

function clampByte(n) {
	return Math.max(0, Math.min(255, n));
}

customElements.define('dip-switch', DipSwitch);
