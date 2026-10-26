import { useEffect, useState } from 'react';
import type { MergeMethod, PrDetail } from '@mergewatch/shared';
import { ApiError, post } from '../lib/api.ts';
import { showToast, useRefresh } from '../lib/data.ts';
import { checksLine, repoName } from '../lib/format.ts';
import { CloseIcon } from './icons.tsx';

const ACTION: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' };
const SHORT: Record<MergeMethod, string> = { squash: 'Squash', merge: 'Merge commit', rebase: 'Rebase' };

const methodKey = (repo: string) => `mergewatch:merge-method:${repo}`;

function rememberedMethod(repo: string, allowed: MergeMethod[], fallback: MergeMethod): MergeMethod {
  try {
    const saved = localStorage.getItem(methodKey(repo)) as MergeMethod | null;
    if (saved && allowed.includes(saved)) return saved;
  } catch {
    // Storage unavailable: use the repo default.
  }
  return fallback;
}

function remember(repo: string, method: MergeMethod) {
  try {
    localStorage.setItem(methodKey(repo), method);
  } catch {
    // Not critical.
  }
}

const errorMessage = (err: unknown) =>
  err instanceof ApiError && typeof (err.body as { message?: unknown })?.message === 'string'
    ? (err.body as { message: string }).message
    : 'Something went wrong. Try again.';

function MethodSelect({ value, methods, onChange, label }: { value: MergeMethod; methods: MergeMethod[]; onChange: (m: MergeMethod) => void; label: string }) {
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as MergeMethod)}>
      {methods.map((m) => (
        <option key={m} value={m}>
          {SHORT[m]}
        </option>
      ))}
    </select>
  );
}

function ConfirmMerge({ pr, onClose }: { pr: PrDetail; onClose: () => void }) {
  const m = pr.merge!;
  const refresh = useRefresh();
  const [method, setMethod] = useState<MergeMethod>(() => rememberedMethod(pr.repo, m.methods, m.defaultMethod));
  const canDelete = m.sameRepo && !m.deleteBranchOnMerge && !m.queue;
  const [deleteBranch, setDeleteBranch] = useState(canDelete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ queued: boolean; branchDeleted: boolean }>(`/api/prs/${pr.id}/merge`, { method, deleteBranch, sha: m.headSha });
      remember(pr.repo, method);
      refresh();
      showToast(res.queued ? `Added ${repoName(pr.repo)} #${pr.number} to the merge queue` : `Merged ${repoName(pr.repo)} #${pr.number}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-wrap center" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="merge-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="merge-title">
            {m.queue ? 'Add to merge queue?' : 'Merge'} {repoName(pr.repo)} #{pr.number}
            {m.queue ? '' : '?'}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <CloseIcon />
          </button>
        </div>
        <div style={{ fontWeight: 700 }}>{pr.title}</div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 4 }}>
          {m.headRef} → {m.baseRef}
        </div>
        <ul className="merge-facts">
          <li>{checksLine(pr.checks)}</li>
          <li>Review requirements met</li>
          <li>No merge conflicts</li>
        </ul>
        {!m.queue && (
          <div className="field" style={{ marginTop: 12 }}>
            <span>Merge method</span>
            <MethodSelect value={method} methods={m.methods} onChange={setMethod} label="Merge method" />
          </div>
        )}
        {canDelete && (
          <label className="check-row">
            <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
            Delete the <span className="mono">{m.headRef}</span> branch after merging
          </label>
        )}
        {m.deleteBranchOnMerge && <div className="sub" style={{ marginTop: 10 }}>GitHub deletes the branch automatically after merging in this repo.</div>}
        {error && (
          <div className="result result-danger" role="alert">
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={busy} autoFocus>
            {busy ? 'Merging…' : m.queue ? 'Add to merge queue' : ACTION[method]}
          </button>
        </div>
      </div>
    </div>
  );
}

function AutoMerge({ pr }: { pr: PrDetail }) {
  const m = pr.merge!;
  const refresh = useRefresh();
  const [method, setMethod] = useState<MergeMethod>(() => rememberedMethod(pr.repo, m.methods, m.defaultMethod));
  const [busy, setBusy] = useState(false);

  const set = async (enabled: boolean) => {
    setBusy(true);
    try {
      await post(`/api/prs/${pr.id}/auto-merge`, { enabled, method });
      if (enabled) remember(pr.repo, method);
      refresh();
      showToast(enabled ? 'Auto-merge on. GitHub merges it once it’s ready.' : 'Auto-merge off');
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (m.autoMerge) {
    return (
      <div className="merge-auto">
        <span>
          <strong>Auto-merge is on.</strong> GitHub will {SHORT[m.autoMerge.method].toLowerCase()} this once every check and review passes.
        </span>
        {m.canDisableAutoMerge && (
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => set(false)}>
            Turn off
          </button>
        )}
      </div>
    );
  }
  if (!m.autoMergeAllowed) {
    return <div className="sub">Auto-merge is turned off in this repo’s GitHub settings (Settings → General → Allow auto-merge).</div>;
  }
  if (!m.canEnableAutoMerge) return null;
  return (
    <div className="merge-auto">
      <span>Merge automatically once it’s ready:</span>
      <span className="field">
        <MethodSelect value={method} methods={m.methods} onChange={setMethod} label="Auto-merge method" />
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => set(true)}>
          Turn on auto-merge
        </button>
      </span>
    </div>
  );
}

/** Merge controls for an open PR. Only offered when GitHub and Mergewatch agree it's fully ready. */
export function MergeBox({ pr }: { pr: PrDetail }) {
  const [confirming, setConfirming] = useState(false);
  const m = pr.merge;
  if (!m || pr.status === 'merged' || m.reason === 'This PR is closed.') return null;

  return (
    <div className={`merge-box ${m.ready ? 'ready' : 'blocked'}`}>
      <div className="merge-head">
        <div>
          <div className="merge-title">{m.ready ? 'Ready to merge' : 'Not ready to merge'}</div>
          <div className="sub">{m.ready ? `${checksLine(pr.checks)}. ${m.queue ? 'This branch uses a merge queue.' : ''}` : m.reason}</div>
        </div>
        <button className="btn btn-primary" disabled={!m.ready} onClick={() => setConfirming(true)}>
          {m.queue ? 'Add to queue…' : 'Merge…'}
        </button>
      </div>
      {!m.ready && <AutoMerge pr={pr} />}
      {confirming && <ConfirmMerge pr={pr} onClose={() => setConfirming(false)} />}
    </div>
  );
}
