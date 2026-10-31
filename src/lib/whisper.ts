export const DEFAULT_WHISPER_MODEL = "large-v3-turbo";

export function whisperModel() {
  const fromEnv = process.env.PERSONAL_CLIPPER_WHISPER_MODEL?.trim();
  return fromEnv || DEFAULT_WHISPER_MODEL;
}
