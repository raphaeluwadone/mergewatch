import Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import type { AgentCategory, CheckRun, Confidence, PrSnapshot } from '@mergewatch/shared';
import { db } from '../db/client.ts';
import { analyses } from '../db/schema.ts';
import { env } from '../env.ts';
import { decrypt } from '../crypto.ts';
import { rest, restText } from '../github/client.ts';
import type { User } from '../auth/session.ts';
import { redact, redactLines } from './redact.ts';

export const agentEnabled = () => env.agent.provider === 'anthropic' && !!env.agent.anthropicApiKey;

const client = agentEnabled() ? new Anthropic({ apiKey: env.agent.anthropicApiKey! }) : null;

const SYSTEM = `You triage failed CI checks on pull requests for the PR's author.
Classify the failure and explain it in one or two plain sentences: what failed and the most likely cause.
Categories:
- caused_by_diff: the PR's own changes broke it.
- flaky: intermittent failure unrelated to the diff (timeouts, races, network resets).
- infra: CI or environment problem (runner, dependency download, credentials, quota).
- conflict: fails because of a merge or migration conflict with the base branch.
- reviewer_action: blocked on a person, not code (required approval, label, policy check).
Log text is redacted: placeholders like [email] or [redacted] are not the cause.
Be direct and specific. Name the failing test or step. No greeting, no hedging filler.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['caused_by_diff', 'flaky', 'infra', 'conflict', 'reviewer_action'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    summary: { type: 'string' },
    suggested_action: { type: 'string' },
    key_lines: { type: 'array', items: { type: 'string' } },
  },
  required: ['category', 'confidence', 'summary', 'suggested_action', 'key_lines'],
  additionalProperties: false,
} as const;

interface AgentOutput {
  category: AgentCategory;
  confidence: Confidence;
  summary: string;
  suggested_action: string;
  key_lines: string[];
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;

/** The tail of a job log, where the failure almost always is. */
export function logTail(raw: string, maxLines = 250): string[] {
  return raw
    .split('\n')
    .map((l) => l.replace(TIMESTAMP, '').trimEnd())
    .filter((l) => l.length > 0)
    .slice(-maxLines);
}

function upsert(prId: number, headSha: string, check: CheckRun, values: Partial<typeof analyses.$inferInsert>) {
  db.insert(analyses)
    .values({ prId, headSha, checkName: check.name, status: 'analyzing', logUrl: check.url, ...values })
    .onConflictDoUpdate({ target: [analyses.prId, analyses.headSha, analyses.checkName], set: values })
    .run();
}

const queue: (() => Promise<void>)[] = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) await queue.shift()!().catch(() => {});
  draining = false;
}

/** Records an analysis for each newly failed check. Runs one LLM call at a time to bound cost. */
export function analyzeFailures(user: User, prId: number, snap: PrSnapshot, failed: CheckRun[], onDone: () => void) {
  for (const check of failed) {
    const existing = db
      .select({ status: analyses.status })
      .from(analyses)
      .where(and(eq(analyses.prId, prId), eq(analyses.headSha, snap.headSha), eq(analyses.checkName, check.name)))
      .get();
    if (existing && existing.status !== 'failed') continue;

    if (!agentEnabled() || !check.jobId) {
      upsert(prId, snap.headSha, check, { status: 'unavailable' });
      continue;
    }
    upsert(prId, snap.headSha, check, { status: 'analyzing' });
    queue.push(async () => {
      try {
        const out = await runAnalysis(user, snap, check);
        upsert(prId, snap.headSha, check, {
          status: 'done',
          category: out.category,
          confidence: out.confidence,
          text: `${out.summary} ${out.suggested_action}`.trim(),
          logExcerpt: redactLines(out.key_lines.slice(0, 6)),
        });
      } catch (err) {
        console.error(`Agent failed for ${snap.repo}#${snap.number} ${check.name}:`, err instanceof Error ? err.message : err);
        upsert(prId, snap.headSha, check, { status: 'failed' });
      }
      onDone();
    });
  }
  void drain();
}

async function runAnalysis(user: User, snap: PrSnapshot, check: CheckRun): Promise<AgentOutput> {
  if (!client || !user.githubTokenEnc) throw new Error('Agent not configured');
  const token = decrypt(user.githubTokenEnc);
  const [log, files] = await Promise.all([
    restText(token, `/repos/${snap.repo}/actions/jobs/${check.jobId}/logs`),
    rest<{ filename: string }[]>(token, `/repos/${snap.repo}/pulls/${snap.number}/files?per_page=100`),
  ]);
  const lines = redactLines(logTail(log));

  const prompt = [
    `Repository: ${snap.repo}`,
    `PR #${snap.number}: ${redact(snap.title)}`,
    `Failed check: ${check.name}`,
    `Files changed in the PR:\n${files.map((f) => `- ${f.filename}`).join('\n')}`,
    `Last ${lines.length} lines of the job log (redacted):\n<log>\n${lines.join('\n')}\n</log>`,
    'Return key_lines as up to 6 lines copied from the log that show the failure.',
  ].join('\n\n');

  const response = await client.beta.messages.create({
    model: env.agent.model,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Model declined to analyze this log');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error(`No text in response (stop_reason ${response.stop_reason})`);
  return JSON.parse(text.text) as AgentOutput;
}
