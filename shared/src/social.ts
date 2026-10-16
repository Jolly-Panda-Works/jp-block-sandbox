/** Emoji shown above a character's head. */
/**
 * Emoji bubbles: the six originals (ids kept for compatibility) plus every yellow emotion face and the
 * hand gestures (offensive ones left out). Other ids are derived from the code points, e.g. "u1f600".
 */
const LEGACY = [
  { id: 'smile', char: '😊', group: 'faces' }, { id: 'heart', char: '❤️', group: 'other' }, { id: 'thumbs', char: '👍', group: 'hands' },
  { id: 'laugh', char: '😂', group: 'faces' }, { id: 'wow', char: '😮', group: 'faces' }, { id: 'wave', char: '👋', group: 'hands' },
] as const;
const FACE_CHARS = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "🙂", "🙃", "🫠", "😉", "😇", "🥰", "😍", "🤩", "😘", "😗", "☺️", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🫢", "🫣", "🤫", "🤔", "🫡", "🤐", "🤨", "😐", "😑", "😶", "🫥", "😶\u200d🌫️", "😏", "😒", "🙄", "😬", "😮\u200d💨", "🤥", "🫨", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "😵\u200d💫", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "🫤", "😟", "🙁", "☹️", "😯", "😲", "😳", "🥺", "🥹", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬"];
const HAND_CHARS = ["🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "🫵", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "💪"];
const emojiIdOf = (ch: string) => `u${[...ch].map((c) => c.codePointAt(0)!.toString(16)).filter((h) => h !== 'fe0f').join('_')}`;
export type EmojiGroup = 'faces' | 'hands' | 'other';
export interface EmojiDef { id: string; char: string; group: EmojiGroup }
export const EMOJIS: readonly EmojiDef[] = [
  ...LEGACY,
  ...FACE_CHARS.map((char) => ({ id: emojiIdOf(char), char, group: 'faces' as const })),
  ...HAND_CHARS.map((char) => ({ id: emojiIdOf(char), char, group: 'hands' as const })),
];
export type EmojiId = string;

/** Animated emotes. */
export const EMOTES = [
  { id: 'happy', label: 'Happy', icon: '😄' }, { id: 'cry', label: 'Cry', icon: '😢' }, { id: 'wave', label: 'Wave', icon: '👋' },
  { id: 'dance', label: 'Dance', icon: '💃' }, { id: 'cheer', label: 'Cheer', icon: '🙌' },
  // Played automatically (not in the Social panel): petting an animal, waking up, a bot thinking.
  { id: 'pet', label: 'Pet', icon: '🤲', auto: true }, { id: 'yawn', label: 'Yawn', icon: '🥱', auto: true },
  { id: 'think', label: 'Think', icon: '🤔', auto: true },
] as const;
export type EmoteId = typeof EMOTES[number]['id'];
/** Emotes a player can choose in the Social panel. */
export const PLAYER_EMOTES = EMOTES.filter((e) => !('auto' in e));
/** How long each emote plays (seconds). */
export const EMOTE_SECONDS: Record<EmoteId, number> = { happy: 2.8, cry: 2.8, wave: 2.8, dance: 4, cheer: 2.5, pet: 1.4, yawn: 2.2, think: 1.6 };

/** Resting poses that last until the character moves: sitting on the ground and lying down to sleep. */
export type RestPose = '' | 'sit' | 'sleep';
export const isRestPose = (v: unknown): v is RestPose => v === '' || v === 'sit' || v === 'sleep';

export const PRESET_MESSAGES = ['Hi!', 'Goodbye!', "What's up?", "I'm happy", "I'm sad", 'Nice build!', 'Follow me!'] as const;
export const MAX_MESSAGE_LENGTH = 60;
export const MAX_NAME_LENGTH = 16;

export const isEmojiId = (v: unknown): v is EmojiId => EMOJIS.some((e) => e.id === v);
export const isEmoteId = (v: unknown): v is EmoteId => EMOTES.some((e) => e.id === v);
export const isPlayerEmoteId = (v: unknown): v is EmoteId => PLAYER_EMOTES.some((e) => e.id === v);

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
