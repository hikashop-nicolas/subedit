// Decode a media file to the 16 kHz mono PCM Whisper expects, via mediaplay (mediabunny + the
// bundled libav AC-3 decoder). Unlike the browser's decodeAudioData this handles Matroska
// containers and Dolby AC-3 / E-AC-3, and it streams from the Blob so large files aren't held
// in memory.
import { decodeAudioToMono16k } from "mediaplay";

export async function decodeToMono16k(blob: Blob, onProgress?: (ratio: number) => void, durationHint?: number): Promise<Float32Array> {
  return decodeAudioToMono16k(blob, { onProgress, durationHint });
}
