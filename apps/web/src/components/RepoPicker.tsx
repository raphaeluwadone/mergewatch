import { useMemo, useState } from 'react';
import { repoName } from '../lib/format.ts';

export interface RepoOption {
  fullName: string;
  private: boolean;
  tracked: boolean;
  watchAll?: boolean;
}

interface Props {
  repos: RepoOption[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  /** When given, each picked repo gets a "Watch all PRs" switch. */
  watchAll?: Set<string>;
  onWatchAllChange?: (next: Set<string>) => void;
}

export function RepoPicker({ repos, picked, onChange, watchAll, onWatchAllChange }: Props) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, query]);

  const toggle = (name: string) => {
    const next = new Set(picked);
    if (next.has(name)) {
      next.delete(name);
      if (watchAll?.has(name)) {
        const w = new Set(watchAll);
        w.delete(name);
        onWatchAllChange?.(w);
      }
    } else next.add(name);
    onChange(next);
  };

  const toggleWatch = (name: string) => {
    if (!watchAll || !onWatchAllChange) return;
    const next = new Set(watchAll);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onWatchAllChange(next);
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
          <div key={r.fullName} className="picker-row">
            <label>
              <input type="checkbox" checked={picked.has(r.fullName)} onChange={() => toggle(r.fullName)} />
              <span className="mono">
                <span className="owner">{r.fullName.slice(0, r.fullName.length - repoName(r.fullName).length)}</span>
                {repoName(r.fullName)}
              </span>
            </label>
            {watchAll && picked.has(r.fullName) && (
              <span className="watch-all">
                <span>Watch all PRs</span>
                <button
                  type="button"
                  role="switch"
                  className="toggle"
                  aria-checked={watchAll.has(r.fullName)}
                  aria-label={`Watch all PRs in ${r.fullName}`}
                  onClick={() => toggleWatch(r.fullName)}
                />
              </span>
            )}
          </div>
        ))}
        {shown.length === 0 && <div style={{ padding: 14, fontSize: 13, color: 'var(--text-mute)' }}>No repos match "{query}".</div>}
      </div>
    </div>
  );
}
