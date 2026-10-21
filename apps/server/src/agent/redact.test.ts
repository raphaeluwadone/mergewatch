import { describe, expect, it } from 'vitest';
import { redact } from './redact.ts';

describe('redact', () => {
  it('removes tokens and keys', () => {
    expect(redact('auth ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('auth [github-token]');
    expect(redact('key AKIAABCDEFGHIJKLMNOP used')).toBe('key [aws-key] used');
    expect(redact('Authorization: Bearer abc.def-ghi_123')).toBe('Authorization: Bearer [token]');
    expect(redact('role arn:aws:iam::123456789012:role/deploy')).toBe('role [aws-arn]');
  });

  it('removes credentials in connection strings and assignments', () => {
    expect(redact('postgres://admin:hunter2@db.internal:5432/eai')).toBe('postgres://[credentials]@db.internal:5432/eai');
    expect(redact('DB_PASSWORD=hunter2 next')).toBe('DB_PASSWORD=[redacted] next');
    expect(redact('"api_key": "abc123"')).toBe('"api_key": "[redacted]"');
  });

  it('removes personal data and identifiers', () => {
    expect(redact('student jane.doe@univ.edu failed')).toBe('student [email] failed');
    expect(redact('id 123-45-6789')).toBe('id [ssn]');
    expect(redact('student_id=900123456 row')).toBe('student_id=[number] row');
    expect(redact('host 10.0.12.4 refused')).toBe('host [ip] refused');
    expect(redact('GET https://api.x.com/v1/students?term=fall&id=4')).toBe('GET https://api.x.com/v1/students?[query]');
  });

  it('keeps ordinary test output readable', () => {
    const line = 'FAILED tests/test_export.py::test_round_trip - AssertionError: expected 6 columns, got 5';
    expect(redact(line)).toBe(line);
  });
});
