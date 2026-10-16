# Switch reference

Numbers below are printed positions, left to right: **1 is the most significant bit, 8 the least significant**. Within each numeric field, switches encode a binary value. On is up.

Hover or focus a switch to read its label and current value. The underline spans its whole field. **?** or the **?** button toggles visual labels; **Escape** dismisses the current tooltip. Accessible names and descriptions remain available when visual labels are off.

## Global row

| Byte | Switches | Behavior |
| --- | --- | --- |
| BPM | 1–8 | Base tempo, 0–255. Effective BPM is base × or ÷ the tempo factor, then ÷ 4. Zero follows another playing Big Dipper tab. |
| BPM Mod | 1 | On multiplies; off divides. |
| BPM Mod | 2–3 | Exponent 0–3 selects a factor of 1, 2, 4, or 8. Applies to a follower’s tempo too. |
| BPM Mod | 4–8 | Unused. |
| MIDI Scale | 1–6 | MIDI note offset, 0–63 semitones above MIDI note 21. Does not transpose samples. |
| MIDI Scale | 7–8 | 0: Chromatic, 1: Major, 2: Minor, 3: Pentatonic. |
| Preset | 1 | On selects save; off selects load. Press the Preset button to execute. |
| Preset | 2–8 | Stored value 0–127 selects displayed bank 1–128. |
| Play | 1 | Enables sample audio. Does not mute MIDI or cut off samples already sounding. |
| Play | 2–7 | Sample volume: stored value 0–63 maps to 1–64, divided by 64 for gain. Does not change MIDI velocity. |
| Play | 6 | **Also enables MIDI output** on the first available device. This overlaps the volume field; changing it changes the volume level by 2/64. |
| Play | 8 | Play/stop. A local clock starts from the beginning each time. A follower rejoins the leader’s current position. Stopping cancels queued audio/MIDI and releases MIDI notes; samples already sounding can finish. |

The MIDI scale offsets are `[0,1,2,3,4,5,6,7]`, `[0,2,4,5,7,9,11,12]`, `[0,2,3,5,7,8,10,12]`, and `[0,2,4,7,9,12,14,16]`, respectively. The MIDI note is 21 + global offset + selected scale offset.

## Instrument rows

| Byte | Switches | Behavior |
| --- | --- | --- |
| Instrument | 1 | Solo. If any row is soloed, only soloed rows play. |
| Instrument | 2 | Mute samples and MIDI for this row. Overrides solo. |
| Instrument | 3–5 | Sound bank and MIDI channel, stored 0–7, displayed 1–8. |
| Instrument | 6–8 | Sample within the bank and note within the MIDI scale, stored 0–7, displayed 1–8. |
| Mode | 6–7 | Reserved; currently ignored in both modes. |
| Mode | 8 | Off: Step. On: Euclidean. Only this bit currently selects the mode. |

Sound banks in order: Koan Remnants drums; MP Pt 4 drums; Alix Perez × Eprom drums; Noire Felt; Kontakt Jazz Guitar; Scarbee 1 on the Road; Hypha Spring Time; Kontakt Castles Burning.

### Step mode

Mode switches **1–5** set sequence length 1–31; zero means 32. The four blue bytes are **32 individual steps**, read left to right. On plays a step, off leaves it silent. Steps beyond the current length are ignored.

### Euclidean mode

| Byte | Switches | Behavior |
| --- | --- | --- |
| Mode | 1 | Enable the nth-pulse filter. |
| Mode | 2 | On plays **only** every nth pulse; off **skips** every nth pulse. Ignored while the filter is off. |
| Mode | 3–5 | Stored value 0–7 selects every 1st–8th pulse. Pulses are counted across cycles. |
| First blue byte | 1–8 | Cycle length, 1–255 steps. Zero silences the rhythm. |
| Second blue byte | 1–8 | Pulses per cycle, capped at the cycle length. Zero produces silence. |
| Third blue byte | 1–8 | Initial rotation in steps. |
| Fourth blue byte | 1–8 | Additional rotation after each cycle. |

Both rotation fields use the existing encoding: 0–127 are forward shifts; 128 is zero; 129–255 are backward shifts of 1–127 steps. They are not signed two’s-complement values. Rotations wrap at the cycle length.

## Implementation sources

This mapping follows the executable code, including places where older comments are misleading:

- `src/sequencer-clock.js`: tempo calculation, sixteenth-note ticks, and resetting the local clock on start.
- `src/main.js` and `src/cross-tab-sync.js`: transport, sample gain, and follower behavior.
- `src/sample-player.js`: solo/mute, step length, Euclidean pulse filtering and rotation. The variable `isSkipMode` actually selects **play only nth** when true.
- `src/midi-output.js`: MIDI enable (PLAY switch **6**, despite its older comment), channel, scales, and note mapping.
- `src/preset-controller.js` and `src/preset-dialog.js`: save/load selection and displayed bank numbering.
- `src/sequencer-settings.js`: decoding and sound banks shared by playback and tooltips.

Tooltip interaction follows the [ARIA tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) and [WCAG guidance for content on hover or focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html): keyboard focus, Escape dismissal, hoverable content, and no timeout while reading.
