import { getSwitchFields } from './switch-info.js';
import './switch-labels.css';

const LABELS_STORAGE_KEY = 'big-dipper-labels-enabled';

export function initializeSwitchLabels(groups) {
	const board = document.querySelector('.circuit-board');
	const button = document.querySelector('#labels-button button');
	const fieldsByInput = new WeakMap();
	const rowRecords = groups.map(group => ({ group, signature: '', tooltips: [] }));
	let enabled = true;
	try {
		enabled = localStorage.getItem(LABELS_STORAGE_KEY) !== 'false';
	} catch {
		// Use the default when browser storage is unavailable.
	}
	let hoveredInput = null;
	let focusedInput = null;
	let activeInput = null;
	let activeField = null;
	let dismissed = false;
	let hideTimeout;
	let refreshQueued = false;

	const switchInput = target => target?.closest?.('dip-switch .switch')?.querySelector('input');

	function hide() {
		if (!activeField) return;
		activeField.tooltip.hidden = true;
		activeField.switches.forEach(label => {
			label.classList.remove('labeled-switch', 'label-start', 'label-end');
		});
		activeField = null;
	}

	function position() {
		if (!activeField || !activeInput) return;
		const anchor = activeInput.closest('.switch').getBoundingClientRect();
		const tooltip = activeField.tooltip;
		const rect = tooltip.getBoundingClientRect();
		const margin = 8;
		const above = anchor.top >= rect.height + margin * 2;
		const left = Math.max(
			margin,
			Math.min(
				anchor.left + anchor.width / 2 - rect.width / 2,
				document.documentElement.clientWidth - rect.width - margin,
			),
		);
		const top = above ? anchor.top - rect.height - margin : anchor.bottom + margin;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))}px`;
		tooltip.dataset.side = above ? 'above' : 'below';
	}

	function show(input) {
		clearTimeout(hideTimeout);
		activeInput = input;
		const next = enabled && !dismissed ? fieldsByInput.get(input) : null;
		if (next !== activeField) hide();
		if (!next) return;
		activeField = next;
		next.tooltip.hidden = false;
		next.switches.forEach((label, index, labels) => {
			label.classList.add('labeled-switch');
			label.classList.toggle('label-start', index === 0);
			label.classList.toggle('label-end', index === labels.length - 1);
		});
		position();
	}

	function leave() {
		// Allow crossing the small gap between a switch and its hoverable tooltip.
		hideTimeout = setTimeout(() => show(hoveredInput || focusedInput), 120);
	}

	function refresh() {
		refreshQueued = false;
		const globalBytes = groups[0].getAllBytes();
		const previousInput = activeInput;
		hide();
		rowRecords.forEach((record, rowIndex) => {
			const bytes = record.group.getAllBytes();
			const signature = [...bytes, ...globalBytes].join(',');
			if (signature === record.signature) return;
			record.signature = signature;
			record.tooltips.forEach(tooltip => tooltip.remove());
			record.tooltips = [];
			getSwitchFields(rowIndex, bytes, globalBytes).forEach((fields, byteIndex) => {
				const byte = record.group.getByte(byteIndex);
				const labels = [...byte.querySelectorAll('.switch')];
				fields.forEach((field, fieldIndex) => {
					const tooltip = document.createElement('div');
					tooltip.id = `switch-info-${rowIndex}-${byteIndex}-${fieldIndex}`;
					tooltip.className = 'switch-tooltip';
					tooltip.setAttribute('role', 'tooltip');
					tooltip.hidden = true;
					const heading = document.createElement('strong');
					heading.textContent = field.value ? `${field.name}: ${field.value}` : field.name;
					const description = document.createElement('span');
					description.textContent = field.description;
					tooltip.append(heading, description);
					tooltip.addEventListener('pointerenter', () => clearTimeout(hideTimeout));
					tooltip.addEventListener('pointerleave', leave);
					document.body.append(tooltip);
					record.tooltips.push(tooltip);
					const info = {
						tooltip,
						switches: labels.slice(
							(field.underlineStart ?? field.start) - 1,
							field.underlineEnd ?? field.end,
						),
					};
					for (let bit = field.start; bit <= field.end; ++bit) {
						const input = labels[bit - 1].querySelector('input');
						const context = rowIndex ? `Row ${rowIndex}` : 'Global settings';
						input.setAttribute('aria-label', `${context}, ${field.name}, switch ${bit}`);
						input.setAttribute('aria-describedby', tooltip.id);
						fieldsByInput.set(input, info);
					}
				});
			});
		});
		show(previousInput);
	}

	board.addEventListener('change', () => {
		if (refreshQueued) return;
		refreshQueued = true;
		queueMicrotask(refresh);
	});
	board.addEventListener('pointerover', event => {
		if (event.pointerType === 'touch') return;
		const input = switchInput(event.target);
		if (!input || input === switchInput(event.relatedTarget)) return;
		hoveredInput = input;
		show(input);
	});
	board.addEventListener('pointermove', event => {
		// Hiding a tooltip can expose another switch underneath the stationary
		// pointer. Escape must stay dismissed until the user actually moves it.
		if (!dismissed || !(event.movementX || event.movementY)) return;
		dismissed = false;
		show(hoveredInput);
	});
	board.addEventListener('pointerout', event => {
		const input = switchInput(event.target);
		if (!input || input === switchInput(event.relatedTarget)) return;
		hoveredInput = null;
		leave();
	});
	board.addEventListener('focusin', event => {
		const input = switchInput(event.target);
		if (!input) return;
		focusedInput = input;
		dismissed = false;
		window.setSelectedByteFromElement?.(input.closest('dip-switch'));
		show(input);
	});
	board.addEventListener('focusout', event => {
		if (!switchInput(event.target)) return;
		focusedInput = null;
		show(hoveredInput);
	});

	function toggle() {
		enabled = !enabled;
		try {
			localStorage.setItem(LABELS_STORAGE_KEY, String(enabled));
		} catch {
			// The toggle still works when the preference cannot be saved.
		}
		dismissed = false;
		updateButton();
		show(hoveredInput || focusedInput);
	}

	function updateButton() {
		button.setAttribute('aria-pressed', String(enabled));
		button.title = `${enabled ? 'Hide' : 'Show'} switch labels (?)`;
	}

	button.setAttribute('aria-label', 'Switch labels');
	button.setAttribute('aria-keyshortcuts', '?');
	button.addEventListener('click', toggle);
	updateButton();
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && activeField) {
			dismissed = true;
			hide();
			return;
		}
		if (
			event.key !== '?' ||
			event.repeat ||
			event.isComposing ||
			event.defaultPrevented ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey
		)
			return;
		const target = event.target;
		if (
			target.isContentEditable ||
			target.closest('textarea, select, [role="textbox"], [role="dialog"], dialog') ||
			(target instanceof HTMLInputElement && target.type !== 'checkbox')
		)
			return;
		event.preventDefault();
		toggle();
	});
	window.addEventListener('resize', position);
	document.addEventListener('scroll', position, true);
	refresh();
}
