/**
 * Preset confirmation dialog component
 * Shows load/save confirmation dialogs with "don't show again" option
 */

const DIALOG_PREF_KEY = 'big-dipper-preset-dialog-skip';

/**
 * Get dialog skip preferences from localStorage
 * @returns {{load: boolean, save: boolean}} Skip preferences
 */
function getDialogSkipPrefs() {
	try {
		const stored = localStorage.getItem(DIALOG_PREF_KEY);
		if (stored) {
			const prefs = JSON.parse(stored);
			return {
				load: !!prefs.load,
				save: !!prefs.save,
			};
		}
	} catch (error) {
		console.error('Error reading dialog preferences:', error);
	}
	return { load: false, save: false };
}

/**
 * Save dialog skip preference
 * @param {'load'|'save'} type - Dialog type
 * @param {boolean} skip - Whether to skip this dialog type
 */
function saveDialogSkipPref(type, skip) {
	try {
		const prefs = getDialogSkipPrefs();
		prefs[type] = skip;
		localStorage.setItem(DIALOG_PREF_KEY, JSON.stringify(prefs));
	} catch (error) {
		console.error('Error saving dialog preferences:', error);
	}
}

/**
 * Show preset confirmation dialog
 * @param {'load'|'save'} type - Dialog type
 * @param {number} presetNumber - Preset number to display
 * @returns {Promise<boolean>} True if confirmed, false if cancelled
 */
export async function showPresetDialog(type, presetNumber) {
	const skipPrefs = getDialogSkipPrefs();

	// Check if we should skip this dialog type
	if (type === 'load' && skipPrefs.load) {
		console.log(`Skipping load dialog for preset ${presetNumber} (skip preference set)`);
		return true;
	}
	if (type === 'save' && skipPrefs.save) {
		console.log(`Skipping save dialog for preset ${presetNumber} (skip preference set)`);
		return true;
	}

	return new Promise(resolve => {
		// Create dialog overlay
		const overlay = document.createElement('div');
		overlay.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background-color: rgba(0, 0, 0, 0.7);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 10001;
		`;

		// Create dialog box
		const dialog = document.createElement('div');
		dialog.style.cssText = `
			background-color: #242424;
			border: 2px solid rgba(255, 255, 255, 0.2);
			border-radius: 8px;
			padding: 2rem;
			max-width: 400px;
			width: 90%;
			color: rgba(255, 255, 255, 0.87);
			font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
		`;

		// Create message
		const message = document.createElement('p');
		message.style.cssText = `
			margin: 0 0 1.5rem 0;
			font-size: 1rem;
			line-height: 1.5;
		`;

		if (type === 'load') {
			message.textContent = `Are you sure you want to load preset ${
				presetNumber + 1
			}? Unsaved changes will be overwritten.`;
		} else {
			message.textContent = `Are you sure you want to save current settings to preset bank ${
				presetNumber + 1
			}? Current preset will be overwritten.`;
		}

		// Create checkbox container
		const checkboxContainer = document.createElement('label');
		checkboxContainer.style.cssText = `
			display: flex;
			align-items: center;
			gap: 0.5rem;
			margin-bottom: 1.5rem;
			cursor: pointer;
			font-size: 0.9rem;
			color: rgba(255, 255, 255, 0.7);
		`;

		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.style.cssText = `
			width: 1.2em;
			height: 1.2em;
			cursor: pointer;
		`;

		const checkboxLabel = document.createElement('span');
		checkboxLabel.textContent = "Don't show me this again";

		checkboxContainer.appendChild(checkbox);
		checkboxContainer.appendChild(checkboxLabel);

		// Create button container
		const buttonContainer = document.createElement('div');
		buttonContainer.style.cssText = `
			display: flex;
			gap: 1rem;
			justify-content: flex-end;
		`;

		// Create Cancel button
		const cancelButton = document.createElement('button');
		cancelButton.textContent = 'Cancel';
		cancelButton.style.cssText = `
			padding: 0.5rem 1.5rem;
			background-color: rgba(255, 255, 255, 0.1);
			border: 1px solid rgba(255, 255, 255, 0.2);
			border-radius: 4px;
			color: rgba(255, 255, 255, 0.87);
			cursor: pointer;
			font-size: 1rem;
			font-family: inherit;
		`;
		cancelButton.addEventListener('mouseenter', () => {
			cancelButton.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
		});
		cancelButton.addEventListener('mouseleave', () => {
			cancelButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
		});

		// Create Confirm button
		const confirmButton = document.createElement('button');
		confirmButton.textContent = 'Confirm';
		confirmButton.style.cssText = `
			padding: 0.5rem 1.5rem;
			background-color: #ff4444;
			border: 1px solid #ff4444;
			border-radius: 4px;
			color: white;
			cursor: pointer;
			font-size: 1rem;
			font-family: inherit;
			font-weight: 500;
		`;
		confirmButton.addEventListener('mouseenter', () => {
			confirmButton.style.backgroundColor = '#ff6666';
		});
		confirmButton.addEventListener('mouseleave', () => {
			confirmButton.style.backgroundColor = '#ff4444';
		});

		// Handle button clicks
		const cleanup = confirmed => {
			if (checkbox.checked) {
				saveDialogSkipPref(type, true);
			}
			overlay.remove();
			resolve(confirmed);
		};

		cancelButton.addEventListener('click', () => cleanup(false));
		confirmButton.addEventListener('click', () => cleanup(true));

		// Handle Escape key
		const handleEscape = e => {
			if (e.key === 'Escape') {
				cleanup(false);
				document.removeEventListener('keydown', handleEscape);
			}
		};
		document.addEventListener('keydown', handleEscape);

		// Handle overlay click (close on outside click)
		overlay.addEventListener('click', e => {
			if (e.target === overlay) {
				cleanup(false);
			}
		});

		// Assemble dialog
		buttonContainer.appendChild(cancelButton);
		buttonContainer.appendChild(confirmButton);
		dialog.appendChild(message);
		dialog.appendChild(checkboxContainer);
		dialog.appendChild(buttonContainer);
		overlay.appendChild(dialog);
		document.body.appendChild(overlay);

		// Focus confirm button
		confirmButton.focus();
	});
}
