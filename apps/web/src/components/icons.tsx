import type { ReactNode } from 'react';
import type { AgentCategory, PrStatus } from '@mergewatch/shared';

export function Mark({ size = 44, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <svg className={`mark${animated ? ' animated' : ''}`} width={size} height={(size * 32) / 60} viewBox="0 0 60 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" />
      <circle cx="44" cy="16" r="14" />
    </svg>
  );
}

export function Wordmark({ size = 16 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="Mergewatch">
      Merg<span className="e">e</span>
      <span className="w">w</span>atch
    </span>
  );
}

/** Animated only under `.si-anim` (always) or inside an `.anim-host` that is hovered. */
export function StatusIcon({ status, size = 18, color }: { status: PrStatus; size?: number; color: string }) {
  return (
    <span className={`si si-${status}`} style={{ width: size, height: size, color }} aria-hidden="true">
      {STATUS_SVG[status]}
    </span>
  );
}

const STATUS_SVG: Record<PrStatus, ReactNode> = {
  failed: (
    <svg viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  changes: (
    <svg viewBox="0 0 20 20">
      <path d="M4 16l1-4L13 4l3 3-8 8-4 1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 6l3 3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  conflict: (
    <svg viewBox="0 0 20 20">
      <path d="M4 6h8l-2.5-2.5M16 6l-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 14H8l2.5 2.5M4 14l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  stale: (
    <svg viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <g className="hand">
        <path d="M10 10V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <path d="M10 10l3 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  review: (
    <svg viewBox="0 0 20 20">
      <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.4" fill="currentColor" />
    </svg>
  ),
  running: (
    <svg viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="14 11" />
    </svg>
  ),
  waiting: (
    <svg viewBox="0 0 20 20">
      <path d="M5 3h10M5 17h10M5 3c0 4 3 5 5 7-2 2-5 3-5 7M15 3c0 4-3 5-5 7 2 2 5 3 5 7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  manual: (
    <svg viewBox="0 0 20 20">
      <circle className="ring" cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="3" fill="currentColor" />
    </svg>
  ),
  approved: (
    <svg viewBox="0 0 20 20">
      <path className="draw" d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  merged: (
    <svg viewBox="0 0 20 20">
      <circle cx="7" cy="10" r="6.2" fill="currentColor" />
      <circle cx="13" cy="10" r="6.2" fill="currentColor" opacity="0.85" />
    </svg>
  ),
};

const CATEGORY_PATHS: Record<AgentCategory, ReactNode> = {
  caused_by_diff: <path d="M10 2l8 8-8 8-8-8z" fill="currentColor" />,
  flaky: <path d="M16 6a7 7 0 1 0 1.5 5M16 2v4h-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  infra: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" fill="currentColor" />,
  conflict: <path d="M3 7h12l-3-3M17 13H5l3 3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  reviewer_action: <path d="M4 16l1-4 8-8 3 3-8 8z" fill="currentColor" />,
};

export function CategoryGlyph({ category }: { category: AgentCategory }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {CATEGORY_PATHS[category]}
    </svg>
  );
}

export function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5L18.5 17h-17z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 8v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.6" r="1" fill="currentColor" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="1" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CheckRunIcon({ status }: { status: string }) {
  const color =
    status === 'failed' ? 'var(--danger)' : status === 'passed' ? 'var(--success)' : status === 'skipped' ? 'var(--text-mute)' : 'var(--info)';
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" style={{ color, flex: 'none' }}>
      {status === 'failed' ? (
        <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      ) : status === 'passed' ? (
        <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      ) : status === 'skipped' ? (
        <path d="M5 10h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="10 8" />
      )}
    </svg>
  );
}
