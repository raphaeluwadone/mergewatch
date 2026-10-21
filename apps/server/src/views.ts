import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import {
  extractJiraKeys,
  type AgentAnalysis,
  type AgentCategory,
  type Confidence,
  type JiraLink,
  type PrDetail,
  type PrSnapshot,
  type PrStatus,
  type PrView,
  type Role,
  type Source,
  type TicketPlaceholder,
} from '@mergewatch/shared';
import { db } from './db/client.ts';
import { analyses, events, prSources, prs, tickets } from './db/schema.ts';
import type { User } from './auth/session.ts';
import { isStale, latestChangeRequest } from './sync/differ.ts';
import { deriveRole, deriveStatus, sectionFor, summarizeChecks } from './sync/status.ts';

type PrRow = typeof prs.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;

const excerpt = (text: string, max = 140) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function detailLine(snap: PrSnapshot, status: PrStatus, role: Role, staleDays: number, jira: JiraLink | null): string | null {
  const checks = summarizeChecks(snap);
  switch (status) {
    case 'conflict':
      return `Conflicts with ${snap.baseRef}.`;
    case 'running':
      return `${checks.running} of ${checks.total} checks still running.`;
    case 'review':
      return `${snap.author} asked for your review.`;
    case 'stale':
      return `No activity for ${staleDays}+ days.`;
    case 'approved':
      return checks.running ? 'Approved, checks still running.' : 'Approved and ready to merge.';
    case 'merged':
      return `Merged into ${snap.baseRef}.`;
    case 'manual':
      return 'Added by you from a link.';
    case 'waiting':
      if (role === 'ticket_owner') return `Written by ${snap.author}, on your ticket${jira ? ` ${jira.key}` : ''}.`;
      if (role === 'reviewer') return 'You reviewed this. Waiting on the author.';
      return snap.mergeState === 'behind' ? `Waiting for review. Behind ${snap.baseRef}.` : 'Waiting for review.';
    default:
      return null;
  }
}

function jiraLink(snap: PrSnapshot, jiraKeys: string[], ticketByKey: Map<string, TicketRow>): JiraLink | null {
  const keys = [...jiraKeys, ...extractJiraKeys(snap.headRef, snap.title)];
  const key = keys.find((k) => ticketByKey.has(k)) ?? jiraKeys[0];
  if (!key) return null;
  const t = ticketByKey.get(key);
  return {
    key,
    title: t?.title ?? null,
    status: t?.status ?? null,
    assignee: t?.assignedToMe ? 'you' : (t?.assignee ?? null),
    assignedToMe: t?.assignedToMe ?? false,
    url: t?.url ?? null,
  };
}

function toAnalysis(row: typeof analyses.$inferSelect): AgentAnalysis {
  return {
    status: row.status,
    checkName: row.checkName,
    category: (row.category as AgentCategory | null) ?? null,
    confidence: (row.confidence as Confidence | null) ?? null,
    text: row.text,
    logExcerpt: row.logExcerpt,
    logUrl: row.logUrl,
  };
}

const ANALYSIS_RANK = { done: 0, analyzing: 1, failed: 2, unavailable: 3 } as const;

interface Context {
  sources: Map<number, { sources: Source[]; jiraKeys: string[] }>;
  unread: Map<number, number>;
  analysisByPr: Map<number, (typeof analyses.$inferSelect)[]>;
  ticketByKey: Map<string, TicketRow>;
}

function loadContext(user: User, rows: PrRow[]): Context {
  const ids = rows.map((r) => r.id);
  const sources = new Map<number, { sources: Source[]; jiraKeys: string[] }>();
  const unread = new Map<number, number>();
  const analysisByPr = new Map<number, (typeof analyses.$inferSelect)[]>();
  if (ids.length) {
    for (const s of db.select().from(prSources).where(inArray(prSources.prId, ids)).all()) {
      const entry = sources.get(s.prId) ?? { sources: [], jiraKeys: [] };
      if (!entry.sources.includes(s.source)) entry.sources.push(s.source);
      if (s.jiraKey) entry.jiraKeys.push(s.jiraKey);
      sources.set(s.prId, entry);
    }
    const counts = db
      .select({ prId: events.prId, n: sql<number>`count(*)` })
      .from(events)
      .innerJoin(prs, eq(prs.id, events.prId))
      .where(and(inArray(events.prId, ids), gt(events.id, prs.lastSeenEventId), ne(events.severity, 'noise')))
      .groupBy(events.prId)
      .all();
    for (const c of counts) unread.set(c.prId, Number(c.n));
    for (const a of db.select().from(analyses).where(inArray(analyses.prId, ids)).all()) {
      analysisByPr.set(a.prId, [...(analysisByPr.get(a.prId) ?? []), a]);
    }
  }
  const ticketByKey = new Map(db.select().from(tickets).where(eq(tickets.userId, user.id)).all().map((t) => [t.key, t]));
  return { sources, unread, analysisByPr, ticketByKey };
}

function buildView(user: User, row: PrRow, ctx: Context): PrView {
  const snap = row.snapshot as PrSnapshot;
  const src = ctx.sources.get(row.id) ?? { sources: [], jiraKeys: [] };
  const role = deriveRole(snap, user.login, src.sources, snap.reviews.some((r) => r.reviewer.toLowerCase() === user.login.toLowerCase()));
  const stale = isStale(snap, { now: new Date(), staleDays: user.staleDays, role });
  const status = deriveStatus(snap, role, stale);
  const jira = jiraLink(snap, src.jiraKeys, ctx.ticketByKey);

  let agent: AgentAnalysis | null = null;
  if (status === 'failed') {
    const failedNames = new Set(snap.checks.filter((c) => c.status === 'failed').map((c) => c.name));
    const candidates = (ctx.analysisByPr.get(row.id) ?? []).filter((a) => a.headSha === snap.headSha && failedNames.has(a.checkName));
    candidates.sort((a, b) => ANALYSIS_RANK[a.status] - ANALYSIS_RANK[b.status]);
    if (candidates[0]) agent = toAnalysis(candidates[0]);
  }

  const cr = status === 'changes' ? latestChangeRequest(snap) : null;
  return {
    id: String(row.id),
    repo: snap.repo,
    number: snap.number,
    title: snap.title,
    url: snap.url,
    author: snap.author,
    branch: snap.headRef,
    sources: src.sources,
    role,
    status,
    section: sectionFor(status),
    mergeState: snap.mergeState,
    checks: summarizeChecks(snap),
    jira,
    unreadCount: ctx.unread.get(row.id) ?? 0,
    lastActivityAt: snap.mergedAt ?? snap.updatedAt,
    agent,
    review: cr ? { reviewer: cr.reviewer, excerpt: excerpt(cr.body || 'Requested changes.'), comments: snap.commentCount } : null,
    detail: detailLine(snap, status, role, user.staleDays, jira),
    muted: row.muted,
  };
}

export function listViews(user: User): { prs: PrView[]; tickets: TicketPlaceholder[] } {
  const rows = db.select().from(prs).where(and(eq(prs.userId, user.id), eq(prs.dismissed, false))).all();
  const ctx = loadContext(user, rows);
  const views = rows.map((r) => buildView(user, r, ctx));

  const linkedKeys = new Set<string>();
  for (const v of views) if (v.jira) linkedKeys.add(v.jira.key);
  for (const r of rows) {
    const snap = r.snapshot as PrSnapshot;
    for (const k of extractJiraKeys(snap.headRef, snap.title)) linkedKeys.add(k);
  }
  const placeholders = [...ctx.ticketByKey.values()]
    .filter((t) => t.assignedToMe && t.statusCategory !== 'done' && !linkedKeys.has(t.key))
    .map((t) => ({ key: t.key, title: t.title, status: t.status, url: t.url }));

  return { prs: views, tickets: placeholders };
}

export function detailView(user: User, prId: number): PrDetail | null {
  const row = db.select().from(prs).where(and(eq(prs.id, prId), eq(prs.userId, user.id))).get();
  if (!row) return null;
  const ctx = loadContext(user, [row]);
  const view = buildView(user, row, ctx);
  const snap = row.snapshot as PrSnapshot;

  const timeline = db
    .select()
    .from(events)
    .where(eq(events.prId, row.id))
    .orderBy(desc(events.id))
    .limit(60)
    .all()
    .map((e) => ({
      id: e.id,
      type: e.type as PrDetail['timeline'][number]['type'],
      severity: e.severity,
      text: e.text,
      createdAt: e.createdAt,
      unread: e.id > row.lastSeenEventId && e.severity !== 'noise',
    }));

  const siblings: PrDetail['siblings'] = [];
  if (view.jira) {
    const others = db
      .select()
      .from(prs)
      .where(and(eq(prs.userId, user.id), eq(prs.dismissed, false), ne(prs.id, row.id)))
      .all();
    for (const o of others) {
      const s = o.snapshot as PrSnapshot;
      if (extractJiraKeys(s.headRef, s.title).includes(view.jira.key)) siblings.push({ id: String(o.id), repo: s.repo, number: s.number, title: s.title });
    }
  }

  return { ...view, checkList: snap.checks, timeline, siblings };
}
