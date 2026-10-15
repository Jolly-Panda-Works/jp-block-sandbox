/** Emoji shown above a character's head. */
export const EMOJIS = [
  { id: 'smile', char: '😊' }, { id: 'heart', char: '❤️' }, { id: 'thumbs', char: '👍' },
  { id: 'laugh', char: '😂' }, { id: 'wow', char: '😮' }, { id: 'wave', char: '👋' },
] as const;
export type EmojiId = typeof EMOJIS[number]['id'];

/** Animated emotes. */
export const EMOTES = [
  { id: 'happy', label: 'Happy', icon: '😄' }, { id: 'cry', label: 'Cry', icon: '😢' }, { id: 'wave', label: 'Wave', icon: '👋' },
] as const;
export type EmoteId = typeof EMOTES[number]['id'];

export const PRESET_MESSAGES = ['Hi!', 'Goodbye!', "What's up?", "I'm happy", "I'm sad", 'Nice build!', 'Follow me!'] as const;
export const MAX_MESSAGE_LENGTH = 60;
export const MAX_NAME_LENGTH = 16;

export const isEmojiId = (v: unknown): v is EmojiId => EMOJIS.some((e) => e.id === v);
export const isEmoteId = (v: unknown): v is EmoteId => EMOTES.some((e) => e.id === v);

/** Removes control characters, collapses whitespace and truncates. Empty string = nothing to send. */
export function sanitizeMessage(raw: unknown, max = MAX_MESSAGE_LENGTH): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e]/g, '').replace(/ {2,}/g, ' ').trim();
  return Array.from(cleaned).slice(0, max).join('').trim();
}

/** Room/lobby ids from the backend: 1–64 chars of [A-Za-z0-9_-], otherwise the default lobby. */
export function sanitizeMultiplayerId(raw: unknown, fallback = 'public'): string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : fallback;
}

/** Player display names: sanitised, never empty. */
export function sanitizeName(raw: unknown): string {
  const n = sanitizeMessage(raw, MAX_NAME_LENGTH);
  return n.length > 0 ? n : 'Player';
}
