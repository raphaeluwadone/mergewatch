import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { inQuietHours } from '@mergewatch/shared';
import { db } from '../db/client.ts';
import { appSecrets, pushSubscriptions } from '../db/schema.ts';
import { decrypt, encrypt } from '../crypto.ts';
import type { User } from '../auth/session.ts';
import { buildPushMessages, type NotifyItem, type PushMessage } from './messages.ts';
import { playSound, userSoundPath } from './sound.ts';

const VAPID_KEY = 'vapid';

/** Generated on first use and kept encrypted in the database, so there is nothing to configure. */
function vapidKeys(): { publicKey: string; privateKey: string } {
  const row = db.select().from(appSecrets).where(eq(appSecrets.key, VAPID_KEY)).get();
  if (row) return JSON.parse(decrypt(row.valueEnc)) as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  db.insert(appSecrets).values({ key: VAPID_KEY, valueEnc: encrypt(JSON.stringify(keys)) }).onConflictDoNothing().run();
  return vapidKeys();
}

let configured = false;
function configure() {
  if (configured) return;
  const { publicKey, privateKey } = vapidKeys();
  // Push services require a contact; it is never shown to the user.
  webpush.setVapidDetails('mailto:mergewatch@localhost.invalid', publicKey, privateKey);
  configured = true;
}

export const vapidPublicKey = () => vapidKeys().publicKey;

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function saveSubscription(userId: number, sub: SubscriptionInput) {
  const keysEnc = encrypt(JSON.stringify(sub.keys));
  db.insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, keysEnc })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, keysEnc } })
    .run();
}

export function removeSubscription(userId: number, endpoint: string) {
  const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).get();
  if (row?.userId === userId) db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id)).run();
}

async function deliver(user: User, messages: PushMessage[]) {
  const subs = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id)).all();
  if (!subs.length || !messages.length) return;
  configure();
  // One sound per delivery, however many PRs it covers.
  const sound = userSoundPath(user);
  if (sound) {
    messages = messages.map((m) => ({ ...m, silent: true }));
    playSound(sound);
  }
  for (const sub of subs) {
    const target = { endpoint: sub.endpoint, keys: JSON.parse(decrypt(sub.keysEnc)) as SubscriptionInput['keys'] };
    for (const msg of messages) {
      try {
        await webpush.sendNotification(target, JSON.stringify(msg), { TTL: 3600, urgency: 'normal' });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // The browser dropped the subscription (cleared data, revoked permission).
        if (status === 404 || status === 410) {
          db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
          break;
        }
        console.error(`Push to subscription ${sub.id} failed with ${status ?? 'no status'}`);
      }
    }
  }
}

export async function notifyUser(user: User, items: NotifyItem[]) {
  if (!items.length || !user.desktopNotifications) return;
  if (inQuietHours(user.quietHoursStart, user.quietHoursEnd)) return;
  await deliver(user, buildPushMessages(items));
}

export async function sendTestPush(user: User) {
  await deliver(user, [{ title: 'Mergewatch', body: 'Push notifications are on for this browser.', url: '/', tag: 'mw-test' }]);
}

export const hasSubscriptions = (userId: number) =>
  db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all().length;
