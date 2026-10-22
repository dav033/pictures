import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function transcribeScenarioVoice(input: {
  origin: string;
  cookie: string;
  audio: Buffer;
  contentType: string;
}): Promise<string> {
  const audioBody = new ArrayBuffer(input.audio.byteLength);
  new Uint8Array(audioBody).set(input.audio);
  const response = await fetch(`${input.origin}/api/voz/transcribir`, {
    method: "POST", headers: { cookie: input.cookie, origin: input.origin, "content-type": input.contentType }, body: audioBody,
  });
  assert.equal(response.status, 200, `voice transcription returned ${response.status}`);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error("Voice transcription response was invalid.");
  const transcript: unknown = (result as Record<string, unknown>).texto;
  if (typeof transcript !== "string" || transcript.trim().length === 0) throw new Error("Voice service returned an empty transcript.");
  return transcript.trim();
}

export async function loadLiveScenarioAudio(relativePath: string): Promise<Buffer> {
  const root = process.cwd();
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw new Error("ASESOR_E2E_AUDIO_FILE must stay inside the repository worktree.");
  const audio = await readFile(filePath);
  if (audio.length === 0) throw new Error("ASESOR_E2E_AUDIO_FILE is empty.");
  return audio;
}
