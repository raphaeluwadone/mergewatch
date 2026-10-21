import type { StreamMessage } from '@mergewatch/shared';

type Listener = (msg: StreamMessage) => void;
const listeners = new Map<number, Set<Listener>>();

export function subscribe(userId: number, fn: Listener): () => void {
  const set = listeners.get(userId) ?? new Set();
  set.add(fn);
  listeners.set(userId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(userId);
  };
}

export function publish(userId: number, msg: StreamMessage) {
  for (const fn of listeners.get(userId) ?? []) fn(msg);
}
