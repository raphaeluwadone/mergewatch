import type { PrView } from '@mergewatch/shared';
import { CATEGORY, STATUS } from '../lib/meta.ts';
import { checksLine, repoName, sourceLabels, timeAgo } from '../lib/format.ts';
import { CategoryGlyph, StatusIcon } from './icons.tsx';

interface Props {
  pr: PrView;
  index: number;
  focused: boolean;
  highlighted: boolean;
  onOpen: (id: string) => void;
  action?: { label: string; run: (id: string) => void; danger?: boolean };
}

export function AgentLine({ pr }: { pr: PrView }) {
  const a = pr.agent;
  if (!a) return null;
  if (a.status === 'analyzing') {
    return (
      <div className="agent-line">
        <span className="spinner" style={{ marginTop: 2 }} />
        <em>Agent is reading the {a.checkName} log.</em>
      </div>
    );
  }
  if (a.status !== 'done' || !a.category) return null;
  const cat = CATEGORY[a.category];
  return (
    <div className="agent-line">
      <span className="agent-glyph" style={{ background: cat.color }}>
        <CategoryGlyph category={a.category} />
      </span>
      <span>
        <strong style={{ color: 'var(--text)' }}>
          {cat.label} ({a.confidence} confidence):
        </strong>{' '}
        {a.text}
      </span>
    </div>
  );
}

export function CommentLine({ pr }: { pr: PrView }) {
  const c = pr.latestComment;
  if (!c) return null;
  // The change-request line already quotes this reviewer's note.
  if (pr.review && pr.review.reviewer === c.author && pr.review.excerpt.startsWith(c.excerpt.slice(0, 40))) return null;
  const file = c.path ? c.path.split('/').pop() : null;
  return (
    <div className={`comment-line${c.unread ? ' unread' : ''}`}>
      {c.unread && <span className="unread-dot" aria-label="New" />}
      <span>
        <strong>{c.author}</strong>
        {file && <span className="comment-file mono"> on {file}</span>}: {c.excerpt}
      </span>
    </div>
  );
}

export function PrItem({ pr, index, focused, highlighted, onOpen, action }: Props) {
  const meta = STATUS[pr.status];
  const quiet = pr.section === 'green';
  const labels = sourceLabels(pr);
  return (
    <div
      role="button"
      tabIndex={0}
      data-pr={pr.id}
      className={`pr anim-host${quiet ? ' quiet' : ''}${focused ? ' focused' : ''}${highlighted ? ' highlight' : ''}`}
      style={{ ['--tag' as string]: meta.color, animationDelay: `${Math.min(index, 9) * 45}ms` }}
      onClick={() => onOpen(pr.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(pr.id);
      }}
      aria-label={`${repoName(pr.repo)} #${pr.number} ${pr.title}, ${meta.label}${pr.unreadCount ? `, ${pr.unreadCount} new` : ''}`}
    >
      <div className="pr-icon">
        <StatusIcon status={pr.status} color={meta.color} size={quiet ? 16 : 18} />
      </div>
      <div className="pr-body">
        <div className="pr-title-row">
          <span className="pr-ref mono">
            {repoName(pr.repo)} #{pr.number}
          </span>
          <span className="pr-title">{pr.title}</span>
          {labels.map((l) => (
            <span key={l} className="pill pill-source">
              {l}
            </span>
          ))}
        </div>
        {!quiet && (
          <div className="pr-status" style={{ color: meta.color }}>
            {meta.label}
          </div>
        )}
        {!quiet && <AgentLine pr={pr} />}
        {pr.review && (
          <div className="pr-line">
            <strong>{pr.review.reviewer}:</strong> {pr.review.excerpt}
            {pr.review.comments ? ` · ${pr.review.comments} comments` : ''}
          </div>
        )}
        {!quiet && <CommentLine pr={pr} />}
        {pr.detail && <div className="pr-line" style={quiet ? { fontSize: 12, color: 'var(--text-mute)' } : undefined}>{pr.detail}</div>}
        {!quiet && <div className="pr-checks mono">{checksLine(pr.checks)}</div>}
      </div>
      <div className="pr-side">
        {pr.unreadCount > 0 && <span className="pill pill-unread">{pr.unreadCount} new</span>}
        <span>{timeAgo(pr.lastActivityAt)}</span>
        {action && (
          <button
            type="button"
            className="btn btn-ghost"
            style={action.danger ? { color: 'var(--danger)' } : undefined}
            onClick={(e) => {
              e.stopPropagation();
              action.run(pr.id);
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
