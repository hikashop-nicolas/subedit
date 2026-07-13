// Decode a media file to the 16 kHz mono PCM Whisper expects. Uses the browser's own
// decoder via Web Audio, then resamples with an OfflineAudioContext (which also downmixes
// to mono). Works for anything the browser can decode; exotic codecs (Dolby/DTS in MKV)
// would need mediaplay's decode path instead (future).
const TARGET_RATE = 16000;

export async function decodeToMono16k(data: ArrayBuffer): Promise<Float32Array> {
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const tmp = new Ctor();
  const decoded = await tmp.decodeAudioData(data.slice(0));
  void tmp.close();
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const off = new OfflineAudioContext(1, frames, TARGET_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}
