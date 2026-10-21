import { useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api.ts';
import { useConfig } from '../lib/data.ts';
import { navigate, useLocation } from '../lib/router.ts';
import { GithubMark, Mark, Wordmark } from '../components/icons.tsx';

const ERRORS: Record<string, { title: string; body: (org: string) => string; denied?: boolean }> = {
  not_member: {
    title: 'Access denied',
    body: (org) => `Mergewatch is limited to members of the ${org} GitHub organization. The account you signed in with isn't a member.`,
    denied: true,
  },
  org_restricted: {
    title: 'Waiting on organization approval',
    body: (org) => `${org} hasn't approved Mergewatch for third-party access yet. Ask an org owner to approve it in the organization's OAuth app settings, then try again.`,
    denied: true,
  },
  cancelled: { title: 'Sign-in cancelled', body: () => 'You cancelled on GitHub. Try again when you are ready.' },
  expired: { title: 'Sign-in expired', body: () => 'That sign-in link expired. Start again.' },
  failed: { title: "Couldn't sign you in", body: () => 'GitHub did not complete the sign-in. Try again.' },
  not_configured: { title: 'GitHub app not set up', body: () => 'Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .env, then restart the server.' },
};

export function SignIn() {
  const { params } = useLocation();
  const { data: config } = useConfig();
  const qc = useQueryClient();
  const error = ERRORS[params.get('error') ?? ''];
  const org = config?.org ?? 'the allowed';

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ marginBottom: 18 }}>
          <Mark size={44} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <Wordmark size={22} />
        </div>
        <p className="lead">Track every pull request that needs you, in one place.</p>

        {error && (
          <div className="notice" role="alert" style={{ background: error.denied ? 'var(--danger-soft)' : 'var(--warn-soft)' }}>
            <strong style={{ color: error.denied ? 'var(--danger)' : 'var(--warn)' }}>{error.title}</strong>
            <div style={{ marginTop: 4, color: 'var(--text)' }}>{error.body(org)}</div>
          </div>
        )}

        <div className="stack">
          <a className="btn btn-github" href="/auth/github/login">
            <GithubMark /> {error?.denied ? 'Try a different account' : 'Continue with GitHub'}
          </a>
          {config?.demo && (
            <button
              className="btn btn-outline btn-block"
              onClick={async () => {
                await post('/auth/demo');
                await qc.invalidateQueries();
                navigate('/');
              }}
            >
              Use the demo account
            </button>
          )}
        </div>
        <p className="small">
          {config?.org ? `For members of ${config.org}. ` : ''}Mergewatch only reads your repos and pull requests. It never writes to GitHub.
        </p>
      </div>
    </div>
  );
}
