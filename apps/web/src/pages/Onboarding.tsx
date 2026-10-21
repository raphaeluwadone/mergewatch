import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post, put } from '../lib/api.ts';
import { useConfig } from '../lib/data.ts';
import { navigate, useLocation } from '../lib/router.ts';
import { Mark } from '../components/icons.tsx';
import { RepoPicker, type RepoOption } from '../components/RepoPicker.tsx';

function Dots({ step }: { step: number }) {
  return (
    <div className="dots" style={{ marginTop: 28, marginBottom: 0 }} aria-label={`Step ${step + 1} of 3`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i <= step ? 'on' : ''} />
      ))}
    </div>
  );
}

export function OnboardingJira() {
  const { params } = useLocation();
  const { data: config } = useConfig();
  const result = params.get('jira');
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ marginBottom: 18 }}>
          <Mark size={44} />
        </div>
        <h1>
          Connect Jira <span style={{ fontWeight: 600, color: 'var(--text-mute)', fontSize: 13 }}>(optional)</span>
        </h1>
        <p className="lead">See ticket status next to checks, and pull in PRs linked to tickets assigned to you. Read-only. You can connect later from Settings.</p>
        {result && result !== 'connected' && (
          <div className="notice" style={{ background: 'var(--warn-soft)' }} role="alert">
            {result === 'not_configured' ? 'Jira isn’t set up on this server yet (JIRA_CLIENT_ID is missing). Skip for now.' : 'Jira didn’t connect. You can try again or skip for now.'}
          </div>
        )}
        <div className="stack">
          {config?.jiraConfigured && (
            <a className="btn btn-primary btn-block" href="/auth/jira/connect?next=onboarding">
              Connect Jira
            </a>
          )}
          <button className="btn btn-outline btn-block" onClick={() => navigate('/onboarding/repos')}>
            Skip for now
          </button>
        </div>
        <Dots step={1} />
      </div>
    </div>
  );
}

export function OnboardingRepos() {
  const qc = useQueryClient();
  const { data: repos, isLoading, isError } = useQuery({ queryKey: ['repos'], queryFn: () => api<RepoOption[]>('/api/repos') });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (repos) setPicked(new Set(repos.filter((r) => r.tracked).map((r) => r.fullName)));
  }, [repos]);

  const finish = async () => {
    setSaving(true);
    try {
      await put('/api/repos', { repos: [...picked] });
      await post('/api/onboarding/complete');
      await qc.invalidateQueries();
      navigate('/?welcome=1', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 440 }}>
        <h1>Pick repos to track</h1>
        <p className="lead" style={{ marginBottom: 18 }}>
          Mergewatch follows PRs you author or review in these repos. You can change this anytime in Settings.
        </p>
        {isLoading && (
          <div className="state" style={{ padding: 24 }}>
            <span className="spinner" />
          </div>
        )}
        {isError && <div className="notice" style={{ background: 'var(--danger-soft)' }}>Couldn't load your repos from GitHub. Refresh to try again.</div>}
        {repos && <RepoPicker repos={repos} picked={picked} onChange={setPicked} />}
        <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={saving || !repos} onClick={finish}>
          {picked.size === 0 ? 'Continue without repos' : `Track ${picked.size} ${picked.size === 1 ? 'repo' : 'repos'} and continue`}
        </button>
        <Dots step={2} />
      </div>
    </div>
  );
}
