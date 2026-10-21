import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DashboardResponse, Me, PrDetail, Settings, StreamMessage } from '@mergewatch/shared';
import { api, ApiError } from './api.ts';
import { inQuietHours } from './format.ts';

export interface AppConfig {
  demo: boolean;
  githubConfigured: boolean;
  jiraConfigured: boolean;
  org: string;
}

export type SettingsResponse = Settings & { jiraSite: string | null; githubLogin: string };

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/auth/config'), staleTime: Infinity });

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });

export const useDashboard = (enabled = true) =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardResponse>('/api/dashboard'),
    enabled,
    // The stream invalidates on change; this is only a fallback if it drops.
    refetchInterval: (q) => (q.state.data?.syncing ? 3_000 : 60_000),
  });

export const usePrDetail = (id: string | null) =>
  useQuery({ queryKey: ['pr', id], queryFn: () => api<PrDetail>(`/api/prs/${id}`), enabled: !!id });

export const useSettings = (enabled = true) =>
  useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/api/settings'), enabled });

export function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['pr'] });
  };
}

/** Live updates: refetch on every server sync and raise desktop notifications for attention events. */
export function useLiveStream(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/stream');
    source.addEventListener('sync', (e) => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['pr'] });
      const msg = JSON.parse((e as MessageEvent<string>).data) as StreamMessage;
      notify(msg, qc.getQueryData<SettingsResponse>(['settings']));
    });
    return () => source.close();
  }, [enabled, qc]);
}

function notify(msg: StreamMessage, settings: SettingsResponse | undefined) {
  if (!msg.attention.length || !settings?.desktopNotifications) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (inQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) return;
  // Batched per PR, as the design asks.
  const byPr = new Map<string, StreamMessage['attention']>();
  for (const a of msg.attention) byPr.set(a.prId, [...(byPr.get(a.prId) ?? []), a]);
  for (const [prId, items] of byPr) {
    const first = items[0]!;
    const repo = first.repo.split('/').pop();
    const body = items.length === 1 ? first.text : `${first.text} and ${items.length - 1} more`;
    const n = new Notification(`${repo} #${first.number} needs you`, { body, tag: `mw-${prId}` });
    n.onclick = () => {
      window.focus();
      window.history.pushState(null, '', `/pr/${prId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
  }
}

/* ---------- Toasts ---------- */

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let toast: Toast | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();

export function showToast(text: string, action?: Toast['action']) {
  toast = { id: Date.now(), text, action };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(dismissToast, action ? 8_000 : 4_000);
  for (const fn of toastListeners) fn();
}

export function dismissToast() {
  toast = null;
  for (const fn of toastListeners) fn();
}

export const useToast = () =>
  useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toast,
  );
