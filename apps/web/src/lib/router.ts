import { useSyncExternalStore } from 'react';

const subscribe = (fn: () => void) => {
  window.addEventListener('popstate', fn);
  return () => window.removeEventListener('popstate', fn);
};

export function useLocation() {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return { path, params: new URLSearchParams(search) };
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === window.location.pathname + window.location.search) return;
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia(query).matches,
  );
}

export const useNarrow = () => useMediaQuery('(max-width: 640px)');
