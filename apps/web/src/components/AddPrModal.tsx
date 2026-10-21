import { useEffect, useRef, useState } from 'react';
import { parsePrUrl, type AddPrPreview } from '@mergewatch/shared';
import { post } from '../lib/api.ts';
import { showToast, useRefresh } from '../lib/data.ts';
import { navigate } from '../lib/router.ts';
import { repoName } from '../lib/format.ts';
import { CloseIcon } from './icons.tsx';

export function AddPrModal({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<AddPrPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const refresh = useRefresh();

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const value = url.trim();
    if (!value) {
      setPreview(null);
      return;
    }
    if (!parsePrUrl(value)) {
      setPreview({ result: 'invalid' });
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const p = await post<AddPrPreview>('/api/prs/preview', { url: value });
        if (!cancelled) setPreview(p);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [url]);

  const confirm = async () => {
    if (preview?.result !== 'valid') return;
    setSaving(true);
    try {
      const { id } = await post<{ id: string }>('/api/prs', { url: url.trim() });
      refresh();
      showToast(`Tracking ${repoName(preview.repo)} #${preview.number}`);
      onAdded(id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-pr-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="add-pr-title">Add a PR</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <label htmlFor="add-pr-url" className="visually-hidden">
            GitHub pull request link
          </label>
          <input
            id="add-pr-url"
            ref={inputRef}
            className="input"
            style={{ width: '100%' }}
            placeholder="Paste a GitHub PR link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </form>

        <div aria-live="polite">
          {loading && (
            <div className="result" style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-soft)' }}>
              <span className="spinner" /> Looking up this PR…
            </div>
          )}
          {!loading && preview?.result === 'valid' && (
            <div className="result result-success">
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>Found this PR</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-mute)' }}>
                {repoName(preview.repo)} #{preview.number}
              </div>
              <div style={{ fontWeight: 700 }}>{preview.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>{preview.openedByMe ? 'Opened by you' : `Opened by ${preview.author}`}</div>
              <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={confirm} disabled={saving}>
                {saving ? 'Adding…' : 'Confirm and track'}
              </button>
            </div>
          )}
          {!loading && preview?.result === 'invalid' && (
            <div className="result result-danger">That doesn't look like a GitHub pull request link. Paste a URL like github.com/org/repo/pull/123.</div>
          )}
          {!loading && preview?.result === 'no_access' && (
            <div className="result result-danger">
              Mergewatch can't read this repo with your GitHub access.{' '}
              <a
                href="/settings"
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  navigate('/settings');
                }}
              >
                Check your connections in Settings
              </a>
              .
            </div>
          )}
          {!loading && preview?.result === 'tracked' && (
            <div className="result result-info">
              <span>Already tracked. This PR is in your list {preview.via.includes('jira') ? 'through Jira' : preview.via.includes('manual') ? 'because you added it' : 'automatically'}.</span>
              <button
                className="btn btn-outline"
                onClick={() => {
                  onClose();
                  navigate(`/pr/${preview.id}`);
                }}
              >
                Jump to it
              </button>
            </div>
          )}
          {!loading && preview?.result === 'closed' && (
            <div className="result result-warn">
              {repoName(preview.repo)} #{preview.number} is already closed. Closed PRs can't be tracked.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
