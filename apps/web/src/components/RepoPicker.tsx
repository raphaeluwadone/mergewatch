import { useMemo, useState } from 'react';
import { repoName } from '../lib/format.ts';

export interface RepoOption {
  fullName: string;
  private: boolean;
  tracked: boolean;
}

export function RepoPicker({ repos, picked, onChange }: { repos: RepoOption[]; picked: Set<string>; onChange: (next: Set<string>) => void }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, query]);

  const toggle = (name: string) => {
    const next = new Set(picked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  return (
    <div>
      <input
        className="input"
        style={{ width: '100%', marginBottom: 10 }}
        placeholder={`Search ${repos.length} repos`}
        aria-label="Search repos"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="picker">
        {shown.map((r) => (
          <label key={r.fullName}>
            <input type="checkbox" checked={picked.has(r.fullName)} onChange={() => toggle(r.fullName)} />
            <span className="mono">
              <span className="owner">{r.fullName.slice(0, r.fullName.length - repoName(r.fullName).length)}</span>
              {repoName(r.fullName)}
            </span>
          </label>
        ))}
        {shown.length === 0 && <div style={{ padding: 14, fontSize: 13, color: 'var(--text-mute)' }}>No repos match "{query}".</div>}
      </div>
    </div>
  );
}
