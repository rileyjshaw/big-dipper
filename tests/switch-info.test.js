import test from 'node:test';
import assert from 'node:assert/strict';
import { getSwitchFields } from '../src/switch-info.js';
import { SamplePlayer } from '../src/sample-player.js';
import { SequencerClock } from '../src/sequencer-clock.js';
import { MidiOutput } from '../src/midi-output.js';

const globalBytes = [120, 192, 0, 0, 190];
const forBit = (fields, bit) => fields.findLast(field => field.start <= bit && field.end >= bit);
const player = Object.assign(Object.create(SamplePlayer.prototype), { euclideanCache: new Map() });

test('every switch has a description for every mode-byte value', () => {
	for (let modeByte = 0; modeByte < 256; ++modeByte) {
		for (const [row, bytes] of [
			[0, globalBytes],
			[1, [0, modeByte, 8, 3, 128, 255]],
		]) {
			const fields = getSwitchFields(row, bytes, globalBytes);
			assert.equal(fields.length, row ? 6 : 5);
			for (const byte of fields) {
				for (let bit = 1; bit <= 8; ++bit) {
					const info = forBit(byte, bit);
					assert.ok(info?.name && info.description);
					assert.doesNotMatch(`${info.value} ${info.description}`, /undefined|NaN/);
				}
			}
		}
	}
});

test('tempo labels group all eight bits and use the playback BPM calculation', () => {
	const clock = new SequencerClock();
	for (const modifier of [0, 32, 64, 96, 128, 160, 192, 224]) {
		const bytes = [120, modifier, 0, 0, 0];
		const fields = getSwitchFields(0, bytes, bytes);
		assert.deepEqual([fields[0][0].start, fields[0][0].end], [1, 8]);
		assert.equal(fields[0][0].value, `${clock.calculateBPM((120 << 8) | modifier)} BPM`);
	}
	const following = [0, 0, 0, 0, 1];
	const fields = getSwitchFields(0, following, following);
	assert.equal(fields[0][0].value, 'Follow another tab');
	assert.match(forBit(fields[4], 8).description, /current position/);
	assert.match(forBit(getSwitchFields(0, globalBytes, globalBytes)[4], 8).description, /beginning/);
});

test('step length, unused mode bits, and individual step labels match playback', () => {
	for (const reserved of [0, 2, 4, 6]) {
		const bytes = [0, (2 << 3) | reserved, 255, 255, 255, 255];
		const fields = getSwitchFields(1, bytes, globalBytes);
		assert.equal(fields[1][0].value, '2 steps');
		assert.equal(forBit(fields[1], 6).name, 'Unused');
		assert.equal(forBit(fields[1], 8).value, 'Step');
		assert.equal(forBit(fields[2], 3).name, 'Step 3');
		assert.match(forBit(fields[2], 3).description, /Outside/);
		assert.equal(player.extractRowSettings(bytes[1]).mode, 0);
		assert.equal(player.isStepActive(1, 1 << 29, 2, 2), false);
	}
	const fields = getSwitchFields(1, [0, 0, 0, 0, 0, 1], globalBytes);
	assert.equal(fields[1][0].value, '32 steps');
	assert.doesNotMatch(forBit(fields[5], 8).description, /Outside/);
	assert.equal(player.isStepActive(1, 1, 31, 0), true);
});

test('Euclidean filter labels describe the actual play-only versus skip predicate', () => {
	for (const [modeByte, label, expected] of [
		[201, 'Play only', [false, true, false, true]],
		[137, 'Skip', [true, false, true, false]],
	]) {
		const bytes = [0, modeByte, 4, 4, 0, 0];
		const fields = getSwitchFields(1, bytes, globalBytes);
		assert.equal(forBit(fields[1], 2).value, label);
		assert.equal(forBit(fields[1], 3).value, '2');
		const { modeSettings } = player.extractRowSettings(modeByte);
		const notes = (4 << 24) | (4 << 16);
		assert.deepEqual(
			[0, 1, 2, 3].map(tick => player.isStepActiveEuclidean(1, notes, tick, modeSettings)),
			expected,
		);
	}
	const fields = getSwitchFields(1, [0, 1, 8, 255, 0, 0], globalBytes);
	assert.equal(fields[3][0].value, '8 per cycle');
	assert.match(forBit(fields[1], 2).description, /filter is off/);
});

test('rotation labels retain the unusual existing encoding', () => {
	for (const [raw, expected] of [
		[0, 0],
		[127, 127],
		[128, 0],
		[129, -1],
		[255, -127],
	]) {
		const fields = getSwitchFields(1, [0, 1, 8, 3, raw, raw], globalBytes);
		const pattern = player.getEuclideanPattern(1, (8 << 24) | (3 << 16) | (raw << 8) | raw);
		assert.equal(fields[4][0].value, `${expected} steps`);
		assert.equal(fields[5][0].value, `${expected} steps`);
		assert.equal(pattern.initialRotation, expected);
		assert.equal(pattern.rotationIncrement, expected);
	}
});

test('PLAY switch 6 reports both MIDI and its overlapping volume field', () => {
	const midi = new MidiOutput();
	for (const play of [128, 132]) {
		const bytes = [120, 192, 0, 0, play];
		const fields = getSwitchFields(0, bytes, bytes);
		const info = forBit(fields[4], 6);
		assert.equal(info.name, 'MIDI output + master volume');
		assert.deepEqual([info.underlineStart, info.underlineEnd], [2, 7]);
		assert.equal(info.value, midi.isMidiEnabled(play) ? 'On · 3/64' : 'Off · 1/64');
	}
});

test('preset numbering and MIDI note labels follow their current global settings', () => {
	const bytes = [120, 192, (12 << 2) | 1, 255, 0];
	const fields = getSwitchFields(0, bytes, bytes);
	assert.equal(forBit(fields[3], 1).value, 'Save');
	assert.equal(forBit(fields[3], 8).value, '128');
	assert.equal(forBit(fields[2], 8).value, 'Major');
	const row = getSwitchFields(1, [63, 0, 0, 0, 0, 0], bytes);
	assert.equal(forBit(row[0], 3).value, '8');
	assert.match(forBit(row[0], 8).description, /MIDI note 45/);
	assert.match(forBit(row[0], 8).description, /MIDI output is off/);
});
