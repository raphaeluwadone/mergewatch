import { it, expect } from 'vitest';

// Temporary: fails on purpose to check Mergewatch sends a push for a failed check. Reverted right after.
it('fails on purpose to trigger a Mergewatch push', () => {
  expect('push sent').toBe('push test');
});
