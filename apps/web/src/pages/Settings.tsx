import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@mergewatch/shared';
import { api, post, put } from '../lib/api.ts';
import { showToast, useConfig, useDashboard, useSettings, type SettingsResponse } from '../lib/data.ts';
import { navigate, useLocation } from '../lib/router.ts';
import { setPrefs, usePrefs } from '../lib/prefs.ts';
import { Header } from '../components/Shell.tsx';
import { RepoPicker, type RepoOption } from '../components/RepoPicker.tsx';

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="toggle" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

function Status({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const color = ok === null ? 'var(--text-mute)' : ok ? 'var(--success)' : 'var(--danger)';
  return (
    <div className="sub" style={{ color, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="dot" style={{ background: color, width: 7, height: 7 }} />
      {children}
    </div>
  );
}

function useNotificationPermission() {
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const request = async () => {
    if (typeof Notification === 'undefined') return;
    setPerm(await Notification.requestPermission());
  };
  return [perm, request] as const;
}

export function Settings({ me, onTour }: { me: Me; onTour: () => void }) {
  const qc = useQueryClient();
  const { params } = useLocation();
  const prefs = usePrefs();
  const { data: config } = useConfig();
  const { data: settings } = useSettings();
  const { data: dash } = useDashboard();
  const { data: repos } = useQuery({ queryKey: ['repos'], queryFn: () => api<RepoOption[]>('/api/repos') });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [projects, setProjects] = useState('');
  const [perm, requestPerm] = useNotificationPermission();

  useEffect(() => {
    if (repos && !picked) setPicked(new Set(repos.filter((r) => r.tracked).map((r) => r.fullName)));
  }, [repos, picked]);
  useEffect(() => {
    if (settings) setProjects(settings.jiraProjects.join(', '));
  }, [settings]);
  useEffect(() => {
    const jira = params.get('jira');
    if (jira === 'connected') showToast('Jira connected');
    else if (jira === 'not_configured') showToast('Jira isn’t set up on this server yet');
    else if (jira) showToast('Jira didn’t connect. Try again.');
    if (jira) navigate('/settings', { replace: true });
    if (window.location.hash === '#repos') document.getElementById('repos')?.scrollIntoView();
  }, []);

  const save = async (patch: Partial<SettingsResponse>, message = 'Saved') => {
    try {
      const next = await put<SettingsResponse>('/api/settings', patch);
      qc.setQueryData(['settings'], next);
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      showToast(message);
    } catch {
      showToast('That value isn’t valid');
    }
  };

  const jira = dash?.connection.jira ?? 'not_connected';
  const jiraConnected = jira === 'connected';
  const trackedNow = new Set(repos?.filter((r) => r.tracked).map((r) => r.fullName));
  const reposDirty = !!picked && (picked.size !== trackedNow.size || [...picked].some((r) => !trackedNow.has(r)));

  return (
    <div className="app">
      <Header me={me} onTour={onTour} />
      <div className="settings">
        <h1>Settings</h1>

        <h2>Connections</h2>
        <div className="panel">
          <div className="panel-row">
            <div>
              <div className="name">GitHub</div>
              {dash?.connection.github === 'expired' ? <Status ok={false}>Expired. Reconnect to keep syncing.</Status> : <Status ok>Connected as @{me.login}</Status>}
            </div>
            {dash?.connection.github === 'expired' ? (
              <a className="btn btn-primary" href="/auth/github/login">
                Reconnect
              </a>
            ) : (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if (!window.confirm('Disconnect GitHub? This signs you out until you connect again.')) return;
                  await post('/api/github/disconnect');
                  qc.clear();
                  navigate('/signin');
                }}
              >
                Disconnect
              </button>
            )}
          </div>
          <div className="panel-row">
            <div>
              <div className="name">Jira</div>
              {jiraConnected ? (
                <Status ok>Connected{settings?.jiraSite ? ` · ${settings.jiraSite}` : ''}</Status>
              ) : jira === 'expired' || jira === 'disconnected' ? (
                <Status ok={false}>Connection expired</Status>
              ) : (
                <Status ok={null}>{config?.jiraConfigured ? 'Not connected' : 'Not set up on this server (JIRA_CLIENT_ID missing)'}</Status>
              )}
            </div>
            {jiraConnected ? (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await post('/api/jira/disconnect');
                  await qc.invalidateQueries();
                  showToast('Jira disconnected');
                }}
              >
                Disconnect
              </button>
            ) : (
              <a className={`btn btn-primary${config?.jiraConfigured ? '' : ' disabled'}`} href={config?.jiraConfigured ? '/auth/jira/connect?next=settings' : undefined} aria-disabled={!config?.jiraConfigured}>
                {jira === 'not_connected' ? 'Connect' : 'Reconnect'}
              </a>
            )}
          </div>
          <div className="panel-row">
            <div>
              <div className="name">Slack</div>
              <Status ok={null}>Not set up yet. Slack delivery arrives with the notifications phase.</Status>
            </div>
            <button className="btn btn-outline" disabled>
              Connect
            </button>
          </div>
        </div>

        <h2 id="repos">Tracked repos</h2>
        <div className="panel" style={{ padding: 16 }}>
          {!repos || !picked ? (
            <span className="spinner" />
          ) : (
            <>
              <RepoPicker repos={repos} picked={picked} onChange={setPicked} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="btn btn-outline" disabled={!reposDirty} onClick={() => setPicked(trackedNow)}>
                  Reset
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!reposDirty}
                  onClick={async () => {
                    const { tracked } = await put<{ tracked: number }>('/api/repos', { repos: [...picked] });
                    await qc.invalidateQueries({ queryKey: ['repos'] });
                    void qc.invalidateQueries({ queryKey: ['dashboard'] });
                    setPicked(null);
                    showToast(`Tracking ${tracked} ${tracked === 1 ? 'repo' : 'repos'}`);
                  }}
                >
                  Save repos
                </button>
              </div>
            </>
          )}
        </div>

        <h2>Jira</h2>
        <div className="panel">
          <div className="panel-row">
            <div>
              <div className="name">Watched projects</div>
              <div className="sub">Project keys, comma separated. Leave empty to watch every project.</div>
            </div>
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                const list = projects.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
                void save({ jiraProjects: list });
              }}
            >
              <input className="input mono" style={{ width: 180 }} value={projects} onChange={(e) => setProjects(e.target.value)} placeholder="ENF" aria-label="Watched Jira projects" />
              <button className="btn btn-outline" type="submit">
                Save
              </button>
            </form>
          </div>
          <div className="panel-row">
            <div>
              <div className="name">Auto-attribute Jira PRs</div>
              <div className="sub">Pull in PRs linked to tickets assigned to you, even when someone else wrote them.</div>
            </div>
            <Toggle label="Auto-attribute Jira PRs" checked={settings?.autoAttributeJira ?? true} onChange={(v) => save({ autoAttributeJira: v })} />
          </div>
          <div className="panel-row">
            <div className="sub">Jira is read-only. Mergewatch never changes ticket status, comments, or assignment.</div>
          </div>
        </div>

        <h2>Notifications</h2>
        <div className="panel">
          <div className="panel-row">
            <div>
              <div className="name">Desktop notifications</div>
              <div className="sub">
                For things that need you, batched per PR.{' '}
                {perm === 'denied' && 'Blocked in this browser. Allow notifications for this site in your browser settings.'}
                {perm === 'unsupported' && 'Not supported in this browser.'}
              </div>
            </div>
            <div className="field">
              {perm === 'default' && (
                <button className="btn btn-outline" onClick={requestPerm}>
                  Allow in browser
                </button>
              )}
              <Toggle label="Desktop notifications" checked={settings?.desktopNotifications ?? true} onChange={(v) => save({ desktopNotifications: v })} />
            </div>
          </div>
          <div className="panel-row">
            <div>
              <div className="name">Slack notifications</div>
              <div className="sub">Available once Slack is connected.</div>
            </div>
            <Toggle label="Slack notifications" checked={false} disabled onChange={() => {}} />
          </div>
          <div className="panel-row">
            <div>
              <div className="name">Quiet hours</div>
              <div className="sub">No notifications between these times.</div>
            </div>
            <QuietHours settings={settings} onSave={save} />
          </div>
          <div className="panel-row">
            <div>
              <div className="name">Stale after</div>
              <div className="sub">Flag your open PRs with no activity for this many days.</div>
            </div>
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                const value = Number(new FormData(e.currentTarget).get('stale'));
                void save({ staleDays: value });
              }}
            >
              <input name="stale" className="input" type="number" min={1} max={60} defaultValue={settings?.staleDays ?? 3} key={settings?.staleDays} style={{ width: 80 }} aria-label="Stale threshold in days" />
              <span>days</span>
              <button className="btn btn-outline" type="submit">
                Save
              </button>
            </form>
          </div>
        </div>

        <h2>Appearance</h2>
        <div className="panel">
          <div className="panel-row">
            <div className="name">Theme</div>
            <div className="segmented" role="group" aria-label="Theme">
              {(['dark', 'light'] as const).map((t) => (
                <button key={t} aria-pressed={prefs.theme === t} onClick={() => setPrefs({ theme: t })}>
                  {t === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-row">
            <div className="name">Dashboard layout</div>
            <div className="segmented" role="group" aria-label="Dashboard layout">
              {(['card', 'list'] as const).map((l) => (
                <button key={l} aria-pressed={prefs.layout === l} onClick={() => setPrefs({ layout: l })}>
                  {l === 'card' ? 'Cards' : 'List'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-foot">
          <button
            className="btn btn-danger"
            onClick={async () => {
              await post('/auth/logout');
              qc.clear();
              navigate('/signin');
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function QuietHours({ settings, onSave }: { settings: SettingsResponse | undefined; onSave: (p: Partial<SettingsResponse>, m?: string) => void }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  useEffect(() => {
    setStart(settings?.quietHoursStart ?? '');
    setEnd(settings?.quietHoursEnd ?? '');
  }, [settings]);
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ quietHoursStart: start || null, quietHoursEnd: end || null }, start && end ? 'Quiet hours saved' : 'Quiet hours off');
      }}
    >
      <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Quiet hours start" />
      <span>to</span>
      <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Quiet hours end" />
      <button className="btn btn-outline" type="submit">
        Save
      </button>
    </form>
  );
}
