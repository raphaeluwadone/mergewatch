import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { oauthStates } from '../db/schema.ts';
import { randomToken } from '../crypto.ts';

type Provider = 'github' | 'jira';

export function createState(provider: Provider, userId: number | null = null): string {
  const state = randomToken(24);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date().toISOString())).run();
  db.insert(oauthStates).values({ state, provider, userId, expiresAt }).run();
  return state;
}

/** Single use: the row is deleted whether or not it matched. */
export function consumeState(provider: Provider, state: string | undefined): { userId: number | null } | null {
  if (!state) return null;
  const row = db
    .select()
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), eq(oauthStates.provider, provider), gt(oauthStates.expiresAt, new Date().toISOString())))
    .get();
  db.delete(oauthStates).where(eq(oauthStates.state, state)).run();
  return row ? { userId: row.userId } : null;
}
