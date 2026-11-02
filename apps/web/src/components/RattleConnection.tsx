import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RattleConnection as Connection } from '@mergewatch/shared';
import { api, ApiError, put } from '../lib/api.ts';
import { showToast } from '../lib/data.ts';
import { timeAgo } from '../lib/format.ts';

const ERRORS: Record<string, string> = {
  invalid_url: 'That doesn’t look like a web address.',
  invalid_token: 'Rattle didn’t accept that token. Make a new one in Rattle → Settings.',
  unreachable: 'Couldn’t reach Rattle at that address. Is it running?',
};

/** Settings row for pushing PRs into Rattle's todo list. */
export function RattleConnection({ statusLine }: { statusLine: (ok: boolean | null, text: string) => ReactNode }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['rattle'], queryFn: () => api<Connection>('/api/rattle') });
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('http://localhost:5173');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connected = data && data.status !== 'not_connected';
  const showForm = data && (!connected || editing || data.status === 'unauthorized');

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(['rattle'], await put<Connection>('/api/rattle', { url: url.trim(), token: token.trim() }));
      setEditing(false);
      setToken('');
      showToast('Rattle connected. PRs that need you are on their way.');
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : null;
      setError(ERRORS[code ?? ''] ?? 'Couldn’t connect to Rattle. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    qc.setQueryData(['rattle'], await api<Connection>('/api/rattle', { method: 'DELETE' }));
    showToast('Rattle disconnected');
  };

  const status = !data
    ? null
    : data.status === 'connected'
      ? statusLine(true, `Sending to ${data.email ?? 'Rattle'}${data.lastPushAt ? ` · updated ${timeAgo(data.lastPushAt)}` : ''}`)
      : data.status === 'error'
        ? statusLine(false, `Couldn’t reach ${data.url}. Retrying each sync.`)
        : data.status === 'unauthorized'
          ? statusLine(false, 'Rattle rejected the token. Paste a new one.')
          : statusLine(null, 'Put PRs that need you at the top of your Rattle list');

  return (
    <div className="panel-row">
      <div>
        <div className="name">Rattle</div>
        {status}
      </div>
      {connected && !showForm && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setEditing(true)}>
            Change
          </button>
          <button className="btn btn-danger" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </div>
      )}
      {showForm && (
        <form
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%', marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <input className="input" style={{ flex: '1 1 180px' }} aria-label="Rattle address" placeholder="http://localhost:5173" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input
            className="input"
            style={{ flex: '2 1 240px' }}
            aria-label="Rattle token"
            placeholder="Token from Rattle → Settings"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !token.trim()}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          {editing && (
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
          {error && (
            <div className="sub" role="alert" style={{ width: '100%', color: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
