class TactileButton extends HTMLElement {
	static observedAttributes = ['label', 'color', 'disabled', 'href'];

	constructor() {
		super();
	}

	connectedCallback() {
		if (this._container) return;

		const href = this.href;
		const isLink = !!href;
		const buttonTag = isLink ? 'a' : 'button';
		const buttonAttrs = isLink
			? `href="${href}" target="_blank" rel="nofollow noopener noreferrer"`
			: 'type="button"';

		this.innerHTML = `
			<div class="tact-container">
				<div class="tact-casing-outer">
					<div class="tact-casing-inner">
						<${buttonTag} class="tact-button" ${buttonAttrs}></${buttonTag}>
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
		} else if (name === 'href') {
			this._updateHref();
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

	get href() {
		return this.getAttribute('href') ?? '';
	}

	set href(v) {
		if (v) {
			this.setAttribute('href', v);
		} else {
			this.removeAttribute('href');
		}
		this._updateHref();
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
		if (this._button.tagName === 'A') return; // Ignore disabled for links
		this._button.disabled = this.disabled;
	}

	_updateHref() {
		if (!this._container) return;
		const href = this.href;
		const isLink = !!href;
		const currentIsLink = this._button?.tagName === 'A';

		// Only rebuild if we need to switch between button and link
		if (isLink !== currentIsLink) {
			// Rebuild the component
			const label = this.label;
			const color = this.color;
			const disabled = this.disabled;
			this.innerHTML = '';
			this._container = null;
			this._button = null;
			this._label = null;
			this.connectedCallback();
			// Restore state
			if (label) this.label = label;
			if (color) this.color = color;
			if (disabled) this.disabled = disabled;
		} else if (this._button && isLink) {
			// Just update the href and rel attributes
			this._button.href = href;
			this._button.setAttribute('target', '_blank');
			this._button.setAttribute('rel', 'nofollow noopener noreferrer');
		} else if (this._button && !isLink) {
			// Remove link attributes if switching back to button
			this._button.removeAttribute('href');
			this._button.removeAttribute('target');
			this._button.removeAttribute('rel');
		}
	}
}

customElements.define('tactile-button', TactileButton);
