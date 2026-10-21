/**
 * Scrubs CI log text before it can leave the machine. Applied to every line sent to an LLM.
 * Order matters: specific secret formats first, broad patterns last.
 */
const RULES: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[private-key]'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/g, '[github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[github-token]'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[aws-key]'],
  [/\barn:aws[a-z-]*:[^\s"']+/g, '[aws-arn]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[slack-token]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[api-key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[jwt]'],
  [/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [token]'],
  [/\b([a-z][a-z0-9+.-]*):\/\/[^\s:/@]+:[^\s@]+@/gi, '$1://[credentials]@'],
  // No leading \b, so prefixed names like DB_PASSWORD and AWS_SECRET are caught too.
  [/(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)(["']?\s*[:=]\s*)(["']?)[^\s"',]+/gi, '$1$2$3[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1?[query]'],
  [/\b[A-Fa-f0-9]{40,}\b/g, '[hex]'],
  [/\b[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g, '[blob]'],
  // Long digit runs are often student or institution identifiers.
  [/\b\d{9,}\b/g, '[number]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

export function redactLines(lines: string[]): string[] {
  return lines.map(redact);
}
