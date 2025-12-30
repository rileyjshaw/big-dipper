class TactileButton extends HTMLElement {
	static observedAttributes = ['label', 'color', 'disabled'];

	constructor() {
		super();
	}

	connectedCallback() {
		if (this._container) return;

		this.innerHTML = `
			<div class="tact-container">
				<div class="tact-casing-outer">
					<div class="tact-casing-inner">
						<button class="tact-button" type="button"></button>
					</div>
				</div>
				${this.label ? `<span class="tact-label">${this.label}</span>` : ''}
			</div>
		`;

		this._container = this.querySelector('.tact-container');
		this._button = this.querySelector('.tact-button');
		this._label = this.querySelector('.tact-label');

		this._updateColor();
		this._updateDisabled();
	}

	attributeChangedCallback(name, _oldValue, _newValue) {
		if (!this._container) return;

		if (name === 'color') {
			this._updateColor();
		} else if (name === 'label') {
			this._updateLabel();
		} else if (name === 'disabled') {
			this._updateDisabled();
		}
	}

	get label() {
		return this.getAttribute('label') ?? '';
	}

	set label(v) {
		if (v) {
			this.setAttribute('label', v);
		} else {
			this.removeAttribute('label');
		}
		this._updateLabel();
	}

	get color() {
		return this.getAttribute('color') ?? 'black';
	}

	set color(v) {
		this.setAttribute('color', v);
	}

	get disabled() {
		return this.hasAttribute('disabled');
	}

	set disabled(v) {
		v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
	}

	_updateColor() {
		if (!this._button) return;
		const color = this.color;
		this._button.style.backgroundColor = color;
		this.style.setProperty('--button-color', color);
	}

	_updateLabel() {
		if (!this._container) return;
		const label = this.label;
		if (label) {
			if (!this._label) {
				this._label = document.createElement('span');
				this._label.className = 'tact-label';
				this._container.appendChild(this._label);
			}
			this._label.textContent = label;
		} else if (this._label) {
			this._label.remove();
			this._label = null;
		}
	}

	_updateDisabled() {
		if (!this._button) return;
		this._button.disabled = this.disabled;
	}
}

customElements.define('tactile-button', TactileButton);
