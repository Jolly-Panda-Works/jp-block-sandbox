import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createProfile, sanitizeProfile, type ProfileData } from '@jp/block-sandbox-shared';

/**
 * Minimal JSON-file profile store keyed by an anonymous profile id that the browser keeps in localStorage.
 * Stores permanent block ownership, hotbar and appearance. Writes are debounced and atomic (tmp + rename).
 * Not an account system: anyone who knows a profile id can use it.
 */
export class ProfileStore {
  private readonly profiles = new Map<string, ProfileData>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        for (const [id, data] of Object.entries(raw)) this.profiles.set(id, sanitizeProfile(data));
      } catch (err) {
        console.warn(`[profiles] could not read ${file}, starting empty`, err);
      }
    }
  }

  get(id: string): ProfileData {
    let p = this.profiles.get(id);
    if (!p) {
      p = createProfile();
      this.profiles.set(id, p);
    }
    return p;
  }

  save(id: string, profile: ProfileData): void {
    this.profiles.set(id, profile);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.profiles), null, 1));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('[profiles] save failed', err);
    }
  }
}
