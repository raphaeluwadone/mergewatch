import type { MergeMethod, PrSnapshot } from '@mergewatch/shared';
import { GithubForbiddenError, GithubHttpError, GithubMutationError, graphqlStrict, restSend } from './client.ts';

export type MergeOutcome =
  | { ok: true; queued: boolean; branchDeleted: boolean }
  | { ok: false; error: 'changed' | 'not_mergeable' | 'forbidden' | 'failed'; message: string };

const GQL_METHOD: Record<MergeMethod, string> = { merge: 'MERGE', squash: 'SQUASH', rebase: 'REBASE' };

/**
 * Merges (or queues) a PR pinned to the head commit the user saw. GitHub rejects the call if the
 * branch moved, so nothing merges that the user hasn't looked at.
 */
export async function mergePr(token: string, snap: PrSnapshot, method: MergeMethod, deleteBranch: boolean): Promise<MergeOutcome> {
  try {
    if (snap.merge?.queue) {
      await graphqlStrict(token, `mutation($id: ID!, $sha: GitObjectID!) { enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $sha }) { clientMutationId } }`, {
        id: snap.nodeId,
        sha: snap.headSha,
      });
      return { ok: true, queued: true, branchDeleted: false };
    }
    await restSend(token, 'PUT', `/repos/${snap.repo}/pulls/${snap.number}/merge`, { merge_method: method, sha: snap.headSha });
  } catch (err) {
    if (err instanceof GithubHttpError && err.status === 409) {
      return { ok: false, error: 'changed', message: 'New commits were pushed since you opened this. Review them first.' };
    }
    if (err instanceof GithubHttpError && (err.status === 405 || err.status === 422)) {
      return { ok: false, error: 'not_mergeable', message: 'GitHub says this PR can’t be merged right now.' };
    }
    if (err instanceof GithubForbiddenError) return { ok: false, error: 'forbidden', message: "You don't have permission to merge in this repo." };
    if (err instanceof GithubMutationError) return { ok: false, error: 'not_mergeable', message: `GitHub refused: ${err.messages[0] ?? 'unknown reason'}` };
    return { ok: false, error: 'failed', message: 'GitHub didn’t complete the merge. Try again.' };
  }

  let branchDeleted = false;
  // Never delete a fork's branch, and skip it when GitHub already deletes merged branches.
  if (deleteBranch && snap.merge?.sameRepo && !snap.merge.deleteBranchOnMerge) {
    try {
      await restSend(token, 'DELETE', `/repos/${snap.repo}/git/refs/heads/${snap.headRef.split('/').map(encodeURIComponent).join('/')}`);
      branchDeleted = true;
    } catch {
      // The merge succeeded; a leftover branch isn't worth failing the request over.
    }
  }
  return { ok: true, queued: false, branchDeleted };
}

/** Turns GitHub's own auto-merge on or off. GitHub still enforces every branch protection rule. */
export async function setAutoMerge(token: string, snap: PrSnapshot, enabled: boolean, method: MergeMethod): Promise<void> {
  if (enabled) {
    await graphqlStrict(
      token,
      `mutation($id: ID!, $method: PullRequestMergeMethod!, $sha: GitObjectID!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $sha }) { clientMutationId }
      }`,
      { id: snap.nodeId, method: GQL_METHOD[method], sha: snap.headSha },
    );
  } else {
    await graphqlStrict(token, `mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }`, { id: snap.nodeId });
  }
}
