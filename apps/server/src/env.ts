import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file: rely on the real environment.
}

function str(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var ${name}. See .env.example.`);
}

function optional(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function int(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

const demoMode = process.env.DEMO_MODE === '1';

export const env = {
  root: ROOT,
  port: int('PORT', 8787),
  appUrl: str('APP_URL', 'http://localhost:5173'),
  databasePath: path.resolve(ROOT, str('DATABASE_PATH', 'data/mergewatch.db')),
  /** 32 bytes, base64. Encrypts GitHub and Jira tokens at rest. */
  encryptionKey: str('ENCRYPTION_KEY'),
  github: {
    clientId: demoMode ? optional('GITHUB_CLIENT_ID') : str('GITHUB_CLIENT_ID'),
    clientSecret: demoMode ? optional('GITHUB_CLIENT_SECRET') : str('GITHUB_CLIENT_SECRET'),
    /** Optional. When set, only members of this GitHub org can sign in. */
    allowedOrg: optional('GITHUB_ALLOWED_ORG'),
  },
  jira: {
    clientId: optional('JIRA_CLIENT_ID'),
    clientSecret: optional('JIRA_CLIENT_SECRET'),
  },
  pollIntervalMs: int('POLL_INTERVAL_SECONDS', 60) * 1000,
  agent: {
    provider: optional('AGENT_PROVIDER'),
    anthropicApiKey: optional('ANTHROPIC_API_KEY'),
    model: str('AGENT_MODEL', 'claude-opus-5'),
  },
  /** Seeded sample data and a password-less local login. Never enable outside your own machine. */
  demoMode,
  isProduction: process.env.NODE_ENV === 'production',
};

if (env.demoMode && env.isProduction) {
  throw new Error('DEMO_MODE cannot be enabled in production');
}
