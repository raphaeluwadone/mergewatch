import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.ts';
import type { User } from '../auth/session.ts';

const SYSTEM_DIR = '/System/Library/Sounds';
export const SOUND_DIR = path.join(path.dirname(env.databasePath), 'sounds');
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

/** Sounds are played by the local server through macOS's afplay, so they only work on a Mac. */
export const soundSupported = () => process.platform === 'darwin' && fs.existsSync('/usr/bin/afplay');

export function systemSounds(): string[] {
  if (!soundSupported()) return [];
  try {
    return fs
      .readdirSync(SYSTEM_DIR)
      .filter((f) => f.endsWith('.aiff'))
      .map((f) => f.slice(0, -'.aiff'.length))
      .sort();
  } catch {
    return [];
  }
}

const EXTENSIONS = ['mp3', 'm4a', 'wav', 'aiff', 'aif', 'caf'] as const;
type Ext = (typeof EXTENSIONS)[number];

const ascii = (buf: Uint8Array, start: number, len: number) => String.fromCharCode(...buf.subarray(start, start + len));

/** Identifies the audio container from its first bytes; the file name alone is not trusted. */
export function detectAudio(buf: Uint8Array): Ext | null {
  if (buf.length < 12) return null;
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return 'mp3';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') return 'wav';
  if (ascii(buf, 0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(buf, 8, 4))) return 'aiff';
  if (ascii(buf, 4, 4) === 'ftyp') return 'm4a';
  if (ascii(buf, 0, 4) === 'caff') return 'caf';
  return null;
}

/** Saves an uploaded sound as data/sounds/user-<id>.<ext>, replacing any earlier one. */
export function saveCustomSound(userId: number, data: Uint8Array): string {
  const ext = detectAudio(data);
  if (!ext) throw new Error('not_audio');
  fs.mkdirSync(SOUND_DIR, { recursive: true });
  for (const f of fs.readdirSync(SOUND_DIR)) if (f.startsWith(`user-${userId}.`)) fs.rmSync(path.join(SOUND_DIR, f));
  const file = `user-${userId}.${ext}`;
  fs.writeFileSync(path.join(SOUND_DIR, file), data, { mode: 0o600 });
  return file;
}

export function soundPath(setting: string, customFile: string | null): string | null {
  if (setting.startsWith('system:')) {
    const name = setting.slice('system:'.length);
    return systemSounds().includes(name) ? path.join(SYSTEM_DIR, `${name}.aiff`) : null;
  }
  if (setting === 'custom' && customFile && /^user-\d+\.(mp3|m4a|wav|aiff|aif|caf)$/.test(customFile)) {
    const p = path.join(SOUND_DIR, customFile);
    return fs.existsSync(p) ? p : null;
  }
  return null;
}

let lastPlayed = 0;

/** Plays the user's chosen sound once. Never through a shell; the path is built by the server. */
export function playSound(file: string | null) {
  if (!file || !soundSupported()) return;
  // A burst of syncs shouldn't stack sounds on top of each other.
  if (Date.now() - lastPlayed < 3_000) return;
  lastPlayed = Date.now();
  execFile('/usr/bin/afplay', [file], { timeout: 15_000 }, () => {});
}

export const userSoundPath = (user: User) => soundPath(user.notificationSound, user.customSoundFile);
