import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useMe, useLiveStream, useSettings } from './lib/data.ts';
import { navigate, useLocation } from './lib/router.ts';
import { usePrefs } from './lib/prefs.ts';
import { SignIn } from './pages/SignIn.tsx';
import { OnboardingJira, OnboardingRepos } from './pages/Onboarding.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Settings } from './pages/Settings.tsx';
import { ToastHost, WelcomeTour } from './components/Shell.tsx';
import { Mark } from './components/icons.tsx';

export function App() {
  const { path, params } = useLocation();
  const { data: me, isLoading } = useMe();
  const prefs = usePrefs();
  const [tourOpen, setTourOpen] = useState(false);
  const signedIn = !!me;
  useLiveStream(signedIn && !!me?.onboarded);
  useSettings(signedIn);

  useEffect(() => {
    if (isLoading) return;
    if (!me && path !== '/signin') navigate('/signin', { replace: true });
    else if (me && path === '/signin') navigate('/', { replace: true });
    else if (me && !me.onboarded && !path.startsWith('/onboarding')) navigate('/onboarding/jira', { replace: true });
  }, [me, isLoading, path]);

  useEffect(() => {
    if (params.get('welcome') === '1') {
      if (!prefs.tourSeen) setTourOpen(true);
      navigate('/', { replace: true });
    }
  }, [params, prefs.tourSeen]);

  if (isLoading) {
    return (
      <div className="auth-wrap">
        <Mark size={66} />
      </div>
    );
  }

  let page: ReactNode;
  if (!me) page = <SignIn />;
  else if (path === '/onboarding/jira') page = <OnboardingJira />;
  else if (path === '/onboarding/repos') page = <OnboardingRepos />;
  else if (path === '/settings') page = <Settings me={me} onTour={() => setTourOpen(true)} />;
  else {
    const detail = /^\/pr\/(\d+)$/.exec(path)?.[1] ?? null;
    page = <Dashboard me={me} detailId={detail} onTour={() => setTourOpen(true)} modalOpen={tourOpen} />;
  }

  return (
    <>
      {page}
      {tourOpen && <WelcomeTour onClose={() => setTourOpen(false)} />}
      <ToastHost />
    </>
  );
}
