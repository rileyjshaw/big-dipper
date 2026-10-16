import {
	SOUND_BANKS,
	SCALE_NAMES,
	decodeRotation,
	extractRowSettings,
	extractScaleSettings,
	extractTempoSettings,
} from './sequencer-settings.js';
import { SequencerClock } from './sequencer-clock.js';
import { MidiOutput } from './midi-output.js';

const clock = new SequencerClock();
const midi = new MidiOutput();
const field = (start, end, name, value, description) => ({ start, end, name, value, description });
const unused = (start, end) => field(start, end, 'Unused', '', 'These switches currently have no effect.');
const onOff = value => (value ? 'On' : 'Off');

// Positions are the printed switch numbers, from 1 (MSB) to 8 (LSB).
export function getSwitchFields(rowIndex, bytes, globalBytes) {
	const [tempo, modifier, scale, preset, play] = globalBytes;
	const midiEnabled = midi.isMidiEnabled(play);
	const midiStatus = midiEnabled ? '' : ' MIDI output is off.';
	const { noteOffset, scaleIndex } = extractScaleSettings(scale << 16);

	if (rowIndex === 0) {
		const settings = (tempo << 8) | modifier;
		const { isMultiply, tempoFactorExponent } = extractTempoSettings(settings);
		const factor = 2 ** tempoFactorExponent;
		const volume = ((play >> 1) & 63) + 1;
		const volumeDescription =
			'Switches 2–7 set sample volume from 1 to 64. Switch 6 also enables MIDI output.';
		return [
			[
				field(
					1,
					8,
					'Tempo',
					tempo ? `${clock.calculateBPM(settings)} BPM` : 'Follow another tab',
					`Base value ${tempo}. Tempo is the base value ${isMultiply ? '×' : '÷'} ${factor}, then ÷ 4. Set all eight switches off to follow another playing Big Dipper tab.`,
				),
			],
			[
				field(
					1,
					1,
					'Multiply/divide tempo',
					isMultiply ? 'Multiply' : 'Divide',
					'On multiplies the base tempo by the factor; off divides it. The result is then divided by 4.',
				),
				field(
					2,
					3,
					'Tempo factor',
					`${factor}`,
					'Select a factor of 1, 2, 4, or 8. Also applies when following another tab.',
				),
				unused(4, 8),
			],
			[
				field(
					1,
					6,
					'MIDI note offset',
					`${noteOffset} semitones`,
					`Sets the scale’s starting MIDI note to ${21 + noteOffset} (21 + offset). Does not transpose samples.${midiStatus}`,
				),
				field(
					7,
					8,
					'MIDI scale',
					SCALE_NAMES[scaleIndex],
					`Select Chromatic, Major, Minor, or Pentatonic. Applies to MIDI notes only.${midiStatus}`,
				),
			],
			[
				field(
					1,
					1,
					'Save/load preset',
					preset & 128 ? 'Save' : 'Load',
					'On selects save; off selects load. Press the Preset button to apply.',
				),
				field(
					2,
					8,
					'Preset bank',
					`${(preset & 127) + 1}`,
					`Select bank 1–128, then press Preset to ${preset & 128 ? 'save the current settings' : 'load its settings'}.`,
				),
			],
			[
				field(
					1,
					1,
					'Sample audio',
					onOff(play & 128),
					'On enables sample audio; off silences new samples. MIDI output is unaffected.',
				),
				field(2, 7, 'Master volume', `${volume}/64`, volumeDescription),
				// This bit belongs to the volume field AND controls MIDI. Keep the
				// full volume underline while giving switch 6 its own description.
				{
					...field(
						6,
						6,
						'MIDI output + master volume',
						`${onOff(midiEnabled)} · ${volume}/64`,
						`On enables MIDI output on the first available device. ${volumeDescription}`,
					),
					underlineStart: 2,
					underlineEnd: 7,
				},
				field(
					8,
					8,
					'Play/stop',
					onOff(play & 1),
					tempo
						? 'On starts the sequence from the beginning; off stops it. Samples already sounding can finish.'
						: 'On follows the other tab’s current position, waiting if none is playing. Off stops this tab’s playback. Samples already sounding can finish.',
				),
			],
		];
	}

	const { solo, mute, midiChannel, note, mode, modeSettings } = extractRowSettings(
		(bytes[0] << 8) | bytes[1],
	);
	const length = modeSettings || 32;
	const filterEnabled = !!(modeSettings & 16);
	// The playback predicate is isSkipMode === isNthStep: on plays ONLY
	// each nth pulse, despite the internal variable being named isSkipMode.
	const onlyNth = !!(modeSettings & 8);
	const nth = (modeSettings & 7) + 1;
	const filterStatus = filterEnabled ? '' : ' The pulse filter is off.';
	const result = [
		[
			field(
				1,
				1,
				'Solo row',
				onOff(solo),
				'When any row is soloed, only soloed rows play. Mute still takes precedence.',
			),
			field(
				2,
				2,
				'Mute row',
				onOff(mute),
				'Silence this row’s samples and MIDI notes, including when soloed.',
			),
			field(
				3,
				5,
				'Sound bank / MIDI channel',
				`${midiChannel + 1}`,
				`Sample bank: ${SOUND_BANKS[midiChannel]}. MIDI channel: ${midiChannel + 1}.${midiStatus}`,
			),
			field(
				6,
				8,
				'Sample / MIDI note',
				`${note + 1}`,
				`Select sample ${note + 1} in the sound bank and note ${note + 1} of the MIDI scale (MIDI note ${midi.calculateMidiNote(note, noteOffset, scaleIndex)}).${midiStatus}`,
			),
		],
		[
			...(mode
				? [
						field(
							1,
							1,
							'Euclidean pulse filter',
							onOff(filterEnabled),
							`On filters every nth pulse; off plays the full rhythm. Currently set to ${onlyNth ? 'play only' : 'skip'} every ${nth === 1 ? 'pulse' : `${nth} pulses`}.`,
						),
						field(
							2,
							2,
							'Play only / skip nth pulse',
							onlyNth ? 'Play only' : 'Skip',
							`On plays only every nth pulse; off skips every nth pulse.${filterStatus}`,
						),
						field(
							3,
							5,
							'Pulse interval',
							`${nth}`,
							`Filter every ${nth === 1 ? 'pulse' : `${nth} pulses`}, counting across cycles. Range: 1–8.${filterStatus}`,
						),
					]
				: [
						field(
							1,
							5,
							'Sequence length',
							`${length} steps`,
							'Set 1–31 steps; all five switches off selects 32. Steps beyond the length are ignored.',
						),
					]),
			unused(6, 7),
			field(
				8,
				8,
				'Sequencer mode',
				mode ? 'Euclidean' : 'Step',
				'Off uses the blue switches as individual steps. On uses the four blue bytes for cycle length, pulses, initial rotation, and rotation per cycle.',
			),
		],
	];

	if (mode) {
		const steps = bytes[2];
		result.push(
			[
				field(
					1,
					8,
					'Euclidean cycle length',
					`${steps} steps`,
					'Set 1–255 steps per cycle. Zero silences the rhythm.',
				),
			],
			[
				field(
					1,
					8,
					'Euclidean pulses',
					`${Math.min(bytes[3], steps)} per cycle`,
					`Distribute pulses evenly through the cycle. Stored value: ${bytes[3]}; pulses are capped at the cycle length.`,
				),
			],
			[
				field(
					1,
					8,
					'Initial rotation',
					`${decodeRotation(bytes[4])} steps`,
					'Shift the rhythm’s starting position. Values 0–127 shift forward; 128 is zero; 129–255 shift backward by 1–127 steps.',
				),
			],
			[
				field(
					1,
					8,
					'Rotation per cycle',
					`${decodeRotation(bytes[5])} steps`,
					'Add this shift after each cycle. Values 0–127 shift forward; 128 is zero; 129–255 shift backward by 1–127 steps.',
				),
			],
		);
	} else {
		for (let byte = 2; byte < 6; ++byte) {
			result.push(
				Array.from({ length: 8 }, (_, index) => {
					const step = (byte - 2) * 8 + index + 1;
					return field(
						index + 1,
						index + 1,
						`Step ${step}`,
						onOff(bytes[byte] & (128 >> index)),
						step > length
							? `Outside the current ${length}-step sequence. Increase the sequence length to use this step.`
							: 'On plays this step; off leaves it silent.',
					);
				}),
			);
		}
	}
	return result;
}
