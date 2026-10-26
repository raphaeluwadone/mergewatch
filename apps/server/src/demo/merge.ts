import { eq } from 'drizzle-orm';
import type { MergeMethod, PrSnapshot } from '@mergewatch/shared';
import { db } from '../db/client.ts';
import { prs } from '../db/schema.ts';
import type { MergeOutcome } from '../github/merge.ts';

/** Demo mode has no GitHub token: pretend the merge happened so the flow can be tried end to end. */
export function demoMerge(prId: number, snap: PrSnapshot, _method: MergeMethod): MergeOutcome {
  const now = new Date().toISOString();
  db.update(prs).set({ snapshot: { ...snap, state: 'merged', mergedAt: now, updatedAt: now } }).where(eq(prs.id, prId)).run();
  return { ok: true, queued: false, branchDeleted: false };
}
