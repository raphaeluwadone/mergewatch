import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectionState, Me } from '@mergewatch/shared';
import { post } from '../lib/api.ts';
import { navigate } from '../lib/router.ts';
import { dismissToast, useToast } from '../lib/data.ts';
import { setPrefs } from '../lib/prefs.ts';
import { timeAgo } from '../lib/format.ts';
import { AlertIcon, InfoIcon, Mark, Wordmark } from './icons.tsx';

export function Header({ me, children, onTour }: { me: Me; children?: ReactNode; onTour: () => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <header className="header">
      <div className="brand-row">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <Mark size={26} />
          <Wordmark />
        </a>
        <div ref={menuRef}>
          <button className="avatar-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className="avatar">{me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : me.login.slice(0, 1).toUpperCase()}</span>
            {me.login}
          </button>
          {open && (
            <div className="menu" role="menu">
              <div className="menu-label">Signed in as @{me.login}</div>
              <button role="menuitem" onClick={() => go('/')}>
                Dashboard
              </button>
              <button role="menuitem" onClick={() => go('/settings')}>
                Settings
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onTour();
                }}
              >
                Welcome tour
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={async () => {
                  await post('/auth/logout');
                  qc.clear();
                  navigate('/signin');
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
      {children}
    </header>
  );
}

/** One banner at a time, most serious first. Derived from live connection state, so not dismissible. */
export function ConnectionBanner({ connection }: { connection: ConnectionState }) {
  if (connection.github === 'expired') {
    return (
      <div className="banner banner-danger" role="alert">
        <span>
          <AlertIcon /> Your GitHub connection has expired. Reconnect to keep syncing PRs.
        </span>
        <a className="btn btn-danger btn-sm" href="/auth/github/login" style={{ textDecoration: 'none' }}>
          Reconnect
        </a>
      </div>
    );
  }
  if (connection.jira === 'expired' || connection.jira === 'disconnected') {
    return (
      <div className="banner banner-danger" role="alert">
        <span>
          <AlertIcon /> Jira is disconnected. Ticket-linked PRs won't update until you{' '}
          <a href="/auth/jira/connect?next=settings">reconnect it</a>.
        </span>
      </div>
    );
  }
  if (connection.github === 'rate_limited') {
    return (
      <div className="banner banner-warn" role="status">
        <span>
          <AlertIcon /> GitHub is rate-limited. Data may be stale · last updated {timeAgo(connection.lastSyncAt)}.
        </span>
      </div>
    );
  }
  if (connection.jira === 'not_connected') {
    return (
      <div className="banner banner-info" role="status">
        <span>
          <InfoIcon /> Jira isn't connected yet.{' '}
          <a
            href="/settings"
            onClick={(e) => {
              e.preventDefault();
              navigate('/settings');
            }}
          >
            Connect it
          </a>{' '}
          to link PRs to tickets.
        </span>
      </div>
    );
  }
  return null;
}

const TOUR = [
  { title: 'Welcome to Mergewatch', body: 'One dashboard for every pull request that needs your attention, across every repo you touch.' },
  { title: 'We track PRs three ways', body: 'Automatically when you author or review, manually when you add a link, or through a Jira ticket assigned to you.' },
  { title: 'Only what changed', body: 'Gold badges mark what is new since you last looked. When a check fails, an agent explains why before you open the PR.' },
];

export function WelcomeTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const finish = () => {
    setPrefs({ tourSeen: true });
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const s = TOUR[step]!;
  const last = step === TOUR.length - 1;
  return (
    <div className="modal-wrap center" onClick={finish}>
      <div className="modal tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: 18 }}>
          <Mark size={62} />
        </div>
        <h2 id="tour-title">{s.title}</h2>
        <p>{s.body}</p>
        <div className="dots" aria-label={`Step ${step + 1} of ${TOUR.length}`}>
          {TOUR.map((_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {step > 0 && (
            <button className="btn btn-outline" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="btn btn-primary" autoFocus onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? 'Get started' : 'Next'}
          </button>
        </div>
        {!last && (
          <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={finish}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

export function ToastHost() {
  const toast = useToast();
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            dismissToast();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
