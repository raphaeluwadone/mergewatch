import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { DashboardResponse, Me, PrView, Section } from '@mergewatch/shared';
import { post } from '../lib/api.ts';
import { showToast, useDashboard, useRefresh } from '../lib/data.ts';
import { navigate, useNarrow } from '../lib/router.ts';
import { setPrefs, usePrefs } from '../lib/prefs.ts';
import { plural, repoName, shortAgo } from '../lib/format.ts';
import { ConnectionBanner, Header } from '../components/Shell.tsx';
import { PrItem } from '../components/PrItem.tsx';
import { Detail } from '../components/Detail.tsx';
import { AddPrModal } from '../components/AddPrModal.tsx';
import { AllQuietState, EmptyFiltersState, FirstRunState, LoadingState } from '../components/States.tsx';

type SourceFilter = 'all' | 'auto' | 'manual' | 'jira' | 'repo';
type RoleFilter = 'all' | 'mine' | 'reviewing';

const byPriority = (a: PrView, b: PrView) =>
  Number(b.unreadCount > 0) - Number(a.unreadCount > 0) || Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A housing panel for one dashboard section, tinted by its status color. */
function SectionPanel(props: {
  title: string;
  hint: string;
  count: number;
  color: string;
  children: ReactNode;
  collapsible?: { open: boolean; onToggle: () => void };
}) {
  const { title, hint, count, color, children, collapsible } = props;
  const open = collapsible ? collapsible.open : true;
  const heading = (
    <>
      <span className="section-dot" aria-hidden="true" />
      <span className="section-title">{title}</span>
      <span className="section-count">{count}</span>
      <span className="section-hint">{hint}</span>
      {collapsible && (
        <span className="chev" aria-hidden="true">
          ▸
        </span>
      )}
    </>
  );
  return (
    <section className={`section-panel${open ? '' : ' collapsed'}`} style={{ ['--accent' as string]: color }}>
      {collapsible ? (
        <button className="section-head" aria-expanded={open} onClick={collapsible.onToggle}>
          {heading}
        </button>
      ) : (
        <h2 className="section-head">{heading}</h2>
      )}
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function Collapsible({ title, hint, count, color, open, onToggle, children }: { title: string; hint: string; count: number; color: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <SectionPanel title={title} hint={hint} count={count} color={color} collapsible={{ open, onToggle }}>
      {children}
    </SectionPanel>
  );
}

export function Dashboard({ me, detailId, onTour, modalOpen }: { me: Me; detailId: string | null; onTour: () => void; modalOpen: boolean }) {
  const { data } = useDashboard();
  const prefs = usePrefs();
  const narrow = useNarrow();
  const refresh = useRefresh();
  useTick(15_000);

  const [repo, setRepo] = useState('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [role, setRole] = useState<RoleFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [open, setOpen] = useState({ green: false, tickets: false, muted: false });
  const [addOpen, setAddOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);

  const all = data?.prs ?? [];
  const repos = useMemo(() => [...new Set(all.map((p) => p.repo))].sort(), [all]);
  const filtersActive = repo !== 'all' || source !== 'all' || role !== 'all';
  const matches = (p: PrView) =>
    (repo === 'all' || p.repo === repo) &&
    (source === 'all' || p.sources.includes(source)) &&
    (role === 'all' || (role === 'reviewing' ? p.role === 'reviewer' : p.role !== 'reviewer' && p.role !== 'observer'));

  const visible = all.filter((p) => !p.muted && matches(p));
  const muted = all.filter((p) => p.muted && matches(p));
  const sectionOf = (s: Section) => visible.filter((p) => p.section === s).sort(byPriority);
  const needs = sectionOf('needs');
  const waiting = sectionOf('waiting');
  const green = sectionOf('green');
  const flat = [...needs, ...waiting, ...(open.green ? green : [])];

  const openPr = (id: string) => navigate(`/pr/${id}`);
  const markSeen = async (id: string) => {
    await post(`/api/prs/${id}/seen`);
    refresh();
  };

  useEffect(() => {
    if (focus >= flat.length) setFocus(Math.max(0, flat.length - 1));
  }, [flat.length, focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (addOpen || modalOpen || detailId || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      const pr = flat[focus];
      if (e.key === 'j') setFocus((f) => Math.min(flat.length - 1, f + 1));
      else if (e.key === 'k') setFocus((f) => Math.max(0, f - 1));
      else if (e.key === 'Enter' && pr && target === document.body) openPr(pr.id);
      else if (e.key === 'e' && pr) void markSeen(pr.id);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const id = flat[focus]?.id;
    if (id) document.querySelector(`[data-pr="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const markAllSeen = async () => {
    const { previous } = await post<{ previous: { id: number; lastSeenEventId: number }[] }>('/api/prs/seen-all');
    refresh();
    showToast('Marked everything as seen', {
      label: 'Undo',
      run: async () => {
        await post('/api/prs/seen-restore', { previous });
        refresh();
      },
    });
  };

  const unmute = async (id: string) => {
    await post(`/api/prs/${id}/mute`, { muted: false });
    refresh();
  };
  const untrack = async (id: string) => {
    const pr = all.find((p) => p.id === id);
    await post(`/api/prs/${id}/untrack`);
    refresh();
    if (pr) showToast(`Stopped tracking ${repoName(pr.repo)} #${pr.number}`);
  };
  const dismiss = async (id: string) => {
    await post(`/api/prs/${id}/dismiss`);
    refresh();
  };

  if (detailId && narrow) return <Detail id={detailId} mode="page" onClose={() => navigate('/')} />;

  const firstRun = !!data && all.length === 0 && data.trackedRepoCount === 0 && !data.syncing;
  const loading = !data || (data.syncing && all.length === 0);
  // The headline is about the user, not the current filter view.
  const needsCount = all.filter((p) => !p.muted && p.section === 'needs').length;

  return (
    <div className="app">
      <Header me={me} onTour={onTour}>
        {data && <ConnectionBanner connection={data.connection} />}
        <div className="headline-row">
          <h1 className="headline">
            <span className="dot" style={{ background: loading || firstRun ? 'var(--info)' : needsCount ? 'var(--danger)' : 'var(--success)' }} />
            {loading ? 'Syncing your PRs…' : firstRun ? 'Welcome to Mergewatch' : needsCount ? `${plural(needsCount, 'PR')} need${needsCount === 1 ? 's' : ''} you` : 'Nothing needs you'}
          </h1>
          {data && <ConnectionLabel data={data} />}
        </div>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            + Add PR
          </button>
          <button className="btn btn-outline filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
            Filters{filtersActive ? ' (on)' : ''}
          </button>
          <div className={`filters${filtersOpen ? ' open' : ''}`}>
            <select className="select" aria-label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)}>
              <option value="all">All repos</option>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {repoName(r)}
                </option>
              ))}
            </select>
            <Segmented label="Source" value={source} onChange={setSource} options={[['all', 'All'], ['auto', 'Auto'], ['manual', 'Manual'], ['jira', 'Jira'], ['repo', 'Watched']]} />
            <Segmented label="Role" value={role} onChange={setRole} options={[['all', 'All'], ['mine', 'Mine'], ['reviewing', 'Reviewing']]} />
            <Segmented label="Layout" value={prefs.layout} onChange={(layout) => setPrefs({ layout })} options={[['card', 'Cards'], ['list', 'List']]} />
          </div>
          <button className="btn btn-outline spacer" onClick={markAllSeen} disabled={!all.some((p) => p.unreadCount > 0)}>
            Mark all seen
          </button>
        </div>
        <div className="color-key" aria-label="Color key">
          <span className="label">Color key</span>
          <span><i className="swatch" style={{ background: 'var(--danger)' }} />Needs attention</span>
          <span><i className="swatch" style={{ background: 'var(--warn)' }} />Stale</span>
          <span><i className="swatch" style={{ background: 'var(--info)' }} />In progress or waiting</span>
          <span><i className="swatch" style={{ background: 'var(--success)' }} />Resolved or quiet</span>
        </div>
      </Header>

      <main className="dashboard-main">
        {loading ? (
          <LoadingState />
        ) : firstRun ? (
          <FirstRunState
            jiraConnected={data.connection.jira === 'connected'}
            onRepos={() => navigate('/settings#repos')}
            onJira={() => (window.location.href = '/auth/jira/connect?next=settings')}
            onAdd={() => setAddOpen(true)}
          />
        ) : filtersActive && visible.length === 0 && muted.length === 0 ? (
          <EmptyFiltersState
            onClear={() => {
              setRepo('all');
              setSource('all');
              setRole('all');
            }}
          />
        ) : (
          <>
            {needs.length === 0 && waiting.length === 0 ? (
              <AllQuietState />
            ) : (
              <>
                <PrSection title="Needs you" hint="Your move" color="var(--danger)" prs={needs} layout={prefs.layout} focusId={flat[focus]?.id} highlight={highlight} onOpen={openPr} actionFor={() => undefined} />
                <PrSection title="Waiting on others" hint="Someone else's move" color="var(--info)" prs={waiting} layout={prefs.layout} focusId={flat[focus]?.id} highlight={highlight} onOpen={openPr} actionFor={(p) => (p.sources.length === 1 && p.sources[0] === 'manual' ? { label: 'untrack', run: untrack, danger: true } : undefined)} />
              </>
            )}
            <Collapsible title="Green and quiet" hint="Approved or merged" count={green.length} color="var(--success)" open={open.green} onToggle={() => setOpen((o) => ({ ...o, green: !o.green }))}>
              <List layout={prefs.layout}>
                {green.map((p, i) => (
                  <PrItem key={p.id} pr={p} index={i} focused={flat[focus]?.id === p.id} highlighted={highlight === p.id} onOpen={openPr} action={p.status === 'merged' ? { label: 'dismiss', run: dismiss } : undefined} />
                ))}
              </List>
            </Collapsible>
            <Collapsible title="Tickets without a PR" hint="Assigned to you, nothing opened yet" count={data.tickets.length} color="var(--text-mute)" open={open.tickets} onToggle={() => setOpen((o) => ({ ...o, tickets: !o.tickets }))}>
              {data.tickets.map((t) => (
                <div key={t.key} className="ticket-row">
                  <div style={{ flex: 1 }}>
                    <div className="t-title">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                          {t.key}
                        </a>
                      ) : (
                        t.key
                      )}{' '}
                      · {t.title}
                    </div>
                    <div className="t-meta">{t.status} · Assigned to you, no PR yet</div>
                  </div>
                </div>
              ))}
            </Collapsible>
            <Collapsible title="Muted" hint="Back on their own when something needs you" count={muted.length} color="var(--text-mute)" open={open.muted} onToggle={() => setOpen((o) => ({ ...o, muted: !o.muted }))}>
              <List layout={prefs.layout}>
                {muted.map((p, i) => (
                  <PrItem key={p.id} pr={p} index={i} focused={false} highlighted={false} onOpen={openPr} action={{ label: 'unmute', run: unmute }} />
                ))}
              </List>
            </Collapsible>
          </>
        )}
        <div style={{ padding: '18px 24px 40px', fontSize: 11, color: 'var(--text-mute)' }}>Keyboard: j and k move, Enter opens, e marks seen.</div>
      </main>

      {detailId && <Detail id={detailId} mode="panel" onClose={() => navigate('/')} />}
      {addOpen && (
        <AddPrModal
          onClose={() => setAddOpen(false)}
          onAdded={(id) => {
            setHighlight(id);
            setTimeout(() => setHighlight(null), 2_000);
          }}
        />
      )}
    </div>
  );
}

function List({ layout, children }: { layout: 'card' | 'list'; children: ReactNode }) {
  return <div className={`section-list ${layout === 'card' ? 'cards' : 'list'}`}>{children}</div>;
}

interface ItemAction {
  label: string;
  run: (id: string) => void;
  danger?: boolean;
}

function PrSection(props: {
  title: string;
  hint: string;
  color: string;
  prs: PrView[];
  layout: 'card' | 'list';
  focusId: string | undefined;
  highlight: string | null;
  onOpen: (id: string) => void;
  actionFor: (pr: PrView) => ItemAction | undefined;
}) {
  if (props.prs.length === 0) return null;
  return (
    <SectionPanel title={props.title} hint={props.hint} count={props.prs.length} color={props.color}>
      <List layout={props.layout}>
        {props.prs.map((p, i) => (
          <PrItem key={p.id} pr={p} index={i} focused={props.focusId === p.id} highlighted={props.highlight === p.id} onOpen={props.onOpen} action={props.actionFor(p)} />
        ))}
      </List>
    </SectionPanel>
  );
}

function ConnectionLabel({ data }: { data: DashboardResponse }) {
  const degraded = data.connection.github !== 'ok' || data.connection.jira === 'expired' || data.connection.jira === 'disconnected';
  const color = degraded ? 'var(--warn)' : data.syncing ? 'var(--info)' : 'var(--success)';
  const label = degraded ? 'Degraded' : data.syncing ? 'Syncing' : 'Live';
  return (
    <div className="conn" aria-live="polite">
      <span className="dot" style={{ background: color, color }} />
      {label}
      {data.connection.lastSyncAt ? ` · updated ${shortAgo(data.connection.lastSyncAt)}` : ''}
    </div>
  );
}
