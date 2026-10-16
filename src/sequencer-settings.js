// Shared by playback and switch labels so their interpretation stays in sync.
export const SOUND_BANKS = [
	'drum - koan remnants',
	'drum - mp pt 4',
	'drum - alix perez x eprom',
	'note - noire felt',
	'note - kontakt jazz guitar',
	'note - scarbee 1 on the road',
	'note - hypha spring time',
	'note - kontakt castles burning',
];

export const SCALE_NAMES = ['Chromatic', 'Major', 'Minor', 'Pentatonic'];

export function extractTempoSettings(settings) {
	return {
		baseTempo: (settings >> 8) & 0xff,
		isMultiply: !!(settings & 0x80),
		tempoFactorExponent: (settings >> 5) & 0b11,
	};
}

export function extractRowSettings(settings) {
	return {
		solo: !!(settings & 0x8000),
		mute: !!(settings & 0x4000),
		midiChannel: (settings >> 11) & 0b111,
		note: (settings >> 8) & 0b111,
		// Only the last bit selects a mode; the other two are reserved.
		mode: settings & 1,
		modeSettings: (settings >> 3) & 0b11111,
	};
}

export function extractScaleSettings(settingsRowNotes) {
	const scaleByte = (settingsRowNotes >> 16) & 0xff;
	return { noteOffset: scaleByte >> 2, scaleIndex: scaleByte & 0b11 };
}

export function decodeRotation(raw) {
	return raw > 127 ? 128 - raw : raw;
}
