import { Mark } from './icons.tsx';

export function LoadingState() {
  const rows = [
    ['55%', '35%'],
    ['70%', '40%'],
    ['45%', '30%'],
  ];
  return (
    <div className="state" aria-busy="true">
      <div style={{ marginBottom: 18 }}>
        <Mark size={66} />
      </div>
      <h2 style={{ fontSize: 14 }}>Syncing your PRs…</h2>
      <p>Checking GitHub and Jira for anything new.</p>
      <div className="skeletons">
        {rows.map(([a, b], i) => (
          <div key={i} className="skeleton" style={{ animationDelay: `${i * 0.15}s` }}>
            <div className="box" />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="bar" style={{ width: a }} />
              <div className="bar" style={{ width: b, height: 8 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AllQuietState() {
  return (
    <div className="state">
      <div className="quiet-mark" aria-hidden="true">
        <span className="ring" />
        <span className="ring late" />
        <svg width="40" height="40" viewBox="0 0 40 40" style={{ position: 'relative' }}>
          <circle cx="20" cy="20" r="18" fill="var(--success)" />
          <path d="M12 20l5 5 11-11" stroke="var(--bg-raised)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2>All quiet</h2>
      <p>Nothing needs you right now. New activity on your PRs will land here first.</p>
    </div>
  );
}

export function EmptyFiltersState({ onClear }: { onClear: () => void }) {
  return (
    <div className="state">
      <svg className="attempt" width="52" height="28" viewBox="0 0 60 32" style={{ marginBottom: 14 }} aria-hidden="true">
        <g>
          <circle cx="16" cy="16" r="14" fill="none" stroke="var(--border)" strokeWidth="2.5" />
        </g>
        <g>
          <circle cx="44" cy="16" r="14" fill="none" stroke="var(--border)" strokeWidth="2.5" />
        </g>
      </svg>
      <h2>No PRs match these filters</h2>
      <p>Nothing in this view with the current repo, source, or role filter.</p>
      <button className="btn btn-outline" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}

export function FirstRunState({ onRepos, onJira, onAdd, jiraConnected }: { onRepos: () => void; onJira: () => void; onAdd: () => void; jiraConnected: boolean }) {
  return (
    <div className="state">
      <div style={{ marginBottom: 16 }}>
        <Mark size={48} />
      </div>
      <h2>Connect your first repo</h2>
      <p>Mergewatch tracks PRs you author or review, plus anything linked to your Jira tickets.</p>
      <div className="actions">
        <button className="btn btn-primary" onClick={onRepos}>
          Connect a repo
        </button>
        {!jiraConnected && (
          <button className="btn btn-outline" onClick={onJira}>
            Connect Jira
          </button>
        )}
        <button className="btn btn-outline" onClick={onAdd}>
          + Add a PR manually
        </button>
      </div>
    </div>
  );
}
