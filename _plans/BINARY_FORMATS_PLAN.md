# subedit: binary / image subtitle formats (plan, on the shelf)

Support for the binary subtitle formats Subtitle Edit handles (Blu-ray SUP, VobSub, SCC,
EBU-STL, ...) that subedit currently skips. Researched 2026-07-14; parked for later.

## The split

Binary formats fall into two very different buckets:

**A. Image / bitmap formats (need OCR).** Subtitles are pictures: parse the container ->
decode the RLE bitmaps -> OCR to text. Timing is exact from the container; only the text is
OCR'd (lossy, needs a cleanup pass). Enabler: **Tesseract.js** (Apache-2.0), a browser WASM
OCR engine, lazy-loaded, run in a Worker.
- **Blu-ray SUP (PGS `.sup`)** -- the easy win. [`pgs-parser`](https://github.com/killergerbah/pgs-parser)
  is **MIT**, browser-native, does the segment parse + RLE decode and emits PNGs. Pipe those
  into Tesseract.js -> timed cues. ~1-2 days for a working importer.
- **VobSub (`.sub`/`.idx`)** -- harder. `vobsub-js` is **GPL-2.0** (avoid, would contaminate
  MIT), so hand-write the `.idx` (timing + palette) and `.sub` (RLE bitmap) decode from the
  public spec (multimedia.cx VOBsub), then OCR.
- **DVB / DVD-VOB bitmap subs** -- same bitmap+OCR pattern plus a container demux (mediabunny
  / mediaplay already demux MKV/MP4/TS, reuse for the extraction step).

**B. Binary *text* formats (no OCR).** Text inside a binary wrapper: byte-parse + a charset
table -> **exact text**, no OCR, no big deps.
- **SCC / CEA-608** -- [`mux.js`](https://github.com/videojs/mux.js) (Apache-2.0) has a
  CEA-608 decoder to reference; parse the hex byte-pairs through the 608 tables.
- **EBU-STL (binary `.stl`)** -- GSI block + TTI blocks, text in an EBU charset. No popular JS
  lib; ~moderate custom DataView parsing from ETSI/EBU Tech 3264.
- **PAC, Cavena 890, Cheetah/CapMaker (`.cap`)** -- niche binary text; custom parsing each.

## Libraries (all permissive except the one to avoid)

| Lib | License | Role |
|---|---|---|
| Tesseract.js | Apache-2.0 | browser OCR (WASM) for every image format |
| pgs-parser | MIT | Blu-ray SUP parse + RLE bitmap decode -> PNG |
| mux.js | Apache-2.0 | CEA-608/708 decode reference for SCC |
| vobsub-js | GPL-2.0 | **avoid** -- reimplement VobSub from spec instead |

## Architecture

- A **separate opt-in module** (`src/binary/`), lazy-loaded only when a binary file is opened,
  exactly like the transcribe path already lazy-loads transformers.js. Tesseract.js WASM +
  one language file (~a few MB) download once and cache; OCR runs in a Worker with a progress
  bar (reuse the transcribe dialog's progress UI).
- **Import-mostly.** OCR/bitmap formats are one-way: import -> OCR -> edit the text -> export
  to SRT/VTT/etc (already supported). Do NOT try to write bitmaps back.
- Output is a normal `SubtitleDoc` (timing from the binary, text from OCR/decode), so the rest
  of the editor -- list, preview, retiming, save -- works unchanged. Binary detection happens
  on the raw bytes (magic numbers) before the text-format sniff.
- Text-binary formats (SCC/EBU-STL) can be plain `src/formats/*.ts` like the others (they
  return exact text); only the image ones need the OCR module + Worker.

## Phases

1. **Blu-ray SUP importer** (pgs-parser MIT + Tesseract.js Apache): bytes -> display sets ->
   PNG per cue -> OCR in a Worker -> cues, with a progress dialog and an OCR-language picker.
   Highest value, cleanest licensing, most-encountered binary format.
2. **SCC / CEA-608** (text, no OCR) -- reference mux.js; exact text.
3. **EBU-STL (binary)** -- custom DataView parse; exact text.
4. **VobSub** -- custom `.idx`/`.sub` RLE decode + OCR (no permissive lib).
5. Everything else (PAC, Cavena, Cheetah, DVB, DVD-VOB) as demand warrants.

## Caveats

- OCR is lossy: budget a "fix common OCR errors" cleanup pass (italics/`l` vs `I`, etc.).
- WASM + model download is a one-time cost; gate behind the opt-in module so the base bundle
  stays light.
- Writing back to any bitmap format is out of scope -- export to a text format instead.
