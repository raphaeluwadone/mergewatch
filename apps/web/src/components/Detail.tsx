import { useEffect, useRef } from 'react';
import type { AgentAnalysis, PrDetail } from '@mergewatch/shared';
import { usePrDetail, useRefresh, showToast } from '../lib/data.ts';
import { post } from '../lib/api.ts';
import { navigate } from '../lib/router.ts';
import { CATEGORY, STATUS } from '../lib/meta.ts';
import { checksLine, repoName, sourceLabels, timeAgo } from '../lib/format.ts';
import { CategoryGlyph, CheckRunIcon, CloseIcon, StatusIcon } from './icons.tsx';

function AgentCard({ agent }: { agent: AgentAnalysis }) {
  if (agent.status === 'analyzing') {
    return (
      <div className="agent-card plain">
        <span className="spinner" />
        <span style={{ color: 'var(--text-soft)' }}>Agent is reading the {agent.checkName} job log.</span>
      </div>
    );
  }
  if (agent.status !== 'done' || !agent.category) {
    return (
      <div className="agent-card unavailable">
        <div style={{ fontWeight: 700 }}>{agent.status === 'failed' ? 'Agent could not analyze this log' : 'Agent unavailable'}</div>
        <div style={{ color: 'var(--text-soft)', marginTop: 4 }}>
          Showing raw check info instead.{' '}
          {agent.logUrl && (
            <a href={agent.logUrl} target="_blank" rel="noreferrer">
              View full log ↗
            </a>
          )}
        </div>
      </div>
    );
  }
  const cat = CATEGORY[agent.category];
  return (
    <div className="agent-card" style={{ ['--accent' as string]: cat.color }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="chip-category" style={{ background: cat.color }}>
          <CategoryGlyph category={agent.category} />
          {cat.label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>{agent.confidence} confidence</span>
      </div>
      <div>{agent.text}</div>
      {agent.logExcerpt.length > 0 && <div className="log mono">{agent.logExcerpt.join('\n')}</div>}
      {agent.logUrl && (
        <a href={agent.logUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 700 }}>
          View full log ↗
        </a>
      )}
    </div>
  );
}

function Timeline({ pr }: { pr: PrDetail }) {
  const firstRead = pr.timeline.findIndex((e) => !e.unread);
  const hasUnread = pr.timeline.some((e) => e.unread);
  return (
    <div>
      {pr.timeline.map((e, i) => (
        <div key={e.id}>
          {hasUnread && i === firstRead && <div className="divider">new since you last looked ↑</div>}
          <div className={`event ${e.severity}${e.unread ? ' unread' : ''}`}>
            <time className="mono" dateTime={e.createdAt}>
              {timeAgo(e.createdAt)}
            </time>
            <span className="text">
              {e.text}
              {e.detail && <span className="event-detail">{e.detail}</span>}
            </span>
          </div>
        </div>
      ))}
      {pr.timeline.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>No events yet.</div>}
    </div>
  );
}

export function Detail({ id, mode, onClose }: { id: string; mode: 'panel' | 'page'; onClose: () => void }) {
  const { data: pr, isLoading, isError } = usePrDetail(id);
  const refresh = useRefresh();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (path: string, body?: unknown, message?: string) => {
    await post(`/api/prs/${id}/${path}`, body);
    refresh();
    if (message) showToast(message);
  };

  const content = (() => {
    if (isLoading) return <div className="state"><span className="spinner" /></div>;
    if (isError || !pr) return <div className="state"><h2>PR not found</h2><p>It may have been untracked or dismissed.</p></div>;
    const meta = STATUS[pr.status];
    const isManual = pr.sources.includes('manual');
    return (
      <div className="detail">
        <div className="pr-ref mono">
          {repoName(pr.repo)} · #{pr.number}
        </div>
        <h1>{pr.title}</h1>
        <div className="status-chip si-anim" style={{ background: meta.soft, color: meta.color }}>
          <StatusIcon status={pr.status} color={meta.color} />
          {meta.label}
        </div>
        <div className="row-wrap">
          {sourceLabels(pr).map((l) => (
            <span key={l} className="pill pill-source">
              {l}
            </span>
          ))}
          <span className="pill pill-branch mono">{pr.branch}</span>
          {pr.muted && <span className="pill pill-branch">Muted until something needs you</span>}
        </div>
        <div className="row-wrap">
          <a className="btn btn-outline" href={pr.url} target="_blank" rel="noreferrer">
            Open in GitHub ↗
          </a>
          {pr.jira?.url && (
            <a className="btn btn-outline" href={pr.jira.url} target="_blank" rel="noreferrer">
              Open in Jira ↗
            </a>
          )}
        </div>

        {pr.jira && (
          <div className="callout">
            <div className="kicker">Jira</div>
            <div style={{ fontWeight: 700 }}>
              {pr.jira.key}
              {pr.jira.status ? ` · ${pr.jira.status}` : ''}
            </div>
            {pr.jira.title && <div className="muted">{pr.jira.title}</div>}
            {pr.jira.assignee && <div className="muted">Assigned to {pr.jira.assignee}</div>}
            {pr.role === 'ticket_owner' && <div className="muted" style={{ marginTop: 6 }}>Written by {pr.author}, attributed to you through this ticket.</div>}
            {pr.siblings.length > 0 && (
              <>
                <div className="muted" style={{ marginTop: 10 }}>Other PRs on this ticket:</div>
                {pr.siblings.map((s) => (
                  <div key={s.id} className="mono" style={{ fontSize: 12 }}>
                    <a href={`/pr/${s.id}`} onClick={(e) => { e.preventDefault(); navigate(`/pr/${s.id}`); }}>
                      {repoName(s.repo)} #{s.number}
                    </a>{' '}
                    · {s.title}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="block-title">Checks · {checksLine(pr.checks)}</div>
        {pr.checkList.length ? (
          <div className="list-box">
            {pr.checkList.map((c) => (
              <div key={c.name}>
                <span className="check-name mono">
                  <CheckRunIcon status={c.status} />
                  <span>{c.name}</span>
                </span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-mute)' }}>
                  <span className="mono">{c.durationSec != null ? `${c.durationSec}s` : ''}</span>
                  {c.url && c.status === 'failed' ? (
                    <a href={c.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                      failed ↗
                    </a>
                  ) : (
                    <span style={{ fontWeight: 700, color: 'var(--text-soft)' }}>{c.status}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>No checks reported.</div>
        )}

        {pr.agent && (
          <>
            <div className="block-title">Agent analysis · {pr.agent.checkName}</div>
            <AgentCard agent={pr.agent} />
          </>
        )}

        {pr.review && (
          <>
            <div className="block-title">Latest review</div>
            <div className="agent-card plain" style={{ display: 'block' }}>
              <strong>{pr.review.reviewer}</strong> requested changes: {pr.review.excerpt}
            </div>
          </>
        )}

        {pr.latestComment && (
          <>
            <div className="block-title">Latest comment{pr.latestComment.unread ? ' · new' : ''}</div>
            <div className="agent-card plain" style={{ display: 'block' }}>
              <div style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 4 }}>
                <strong style={{ color: 'var(--text)' }}>{pr.latestComment.author}</strong>
                {pr.latestComment.path && <span className="mono"> on {pr.latestComment.path}</span>} · {timeAgo(pr.latestComment.createdAt)}
              </div>
              <div>{pr.latestComment.excerpt}</div>
              {pr.latestComment.url && (
                <a href={pr.latestComment.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 700 }}>
                  Reply on GitHub ↗
                </a>
              )}
            </div>
          </>
        )}

        <div className="block-title">Timeline</div>
        <Timeline pr={pr} />

        <div className="detail-actions">
          <button className="btn btn-outline" onClick={() => act('seen', undefined, 'Marked seen')} disabled={pr.unreadCount === 0}>
            Mark seen
          </button>
          <button className="btn btn-outline" onClick={() => act('mute', { muted: !pr.muted }, pr.muted ? 'Unmuted' : 'Muted until the next thing that needs you')}>
            {pr.muted ? 'Unmute' : 'Mute'}
          </button>
          {isManual && (
            <button
              className="btn btn-danger"
              onClick={async () => {
                await act('untrack', undefined, `Stopped tracking ${repoName(pr.repo)} #${pr.number}`);
                onClose();
              }}
            >
              Untrack
            </button>
          )}
          {pr.status === 'merged' && (
            <button
              className="btn btn-outline"
              onClick={async () => {
                await act('dismiss');
                onClose();
              }}
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    );
  })();

  if (mode === 'page') {
    return (
      <div className="app page">
        <div className="page-bar">
          <button ref={closeRef} className="btn btn-outline" onClick={onClose}>
            ← Back to dashboard
          </button>
        </div>
        {content}
      </div>
    );
  }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={pr ? `${repoName(pr.repo)} #${pr.number}` : 'Pull request'}>
        <div style={{ padding: '18px 22px 0' }}>
          <button ref={closeRef} className="btn btn-outline btn-sm" onClick={onClose}>
            <CloseIcon /> Close
          </button>
        </div>
        {content}
      </aside>
    </>
  );
}
