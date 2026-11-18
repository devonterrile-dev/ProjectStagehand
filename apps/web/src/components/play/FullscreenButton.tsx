import { Maximize, Minimize } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * The whole page in fullscreen, through the browser: the page and not the theater alone, so
 * dialogs and menus (put at the end of the body) and the GM's desk stay on screen.
 */
function useFullscreen() {
  const supported = document.fullscreenEnabled;
  const [active, setActive] = useState(() => document.fullscreenElement !== null);

  // Esc or the browser's own way out leaves fullscreen too: follow it.
  useEffect(() => {
    const onChange = () => {
      setActive(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  const toggle = () => {
    // A request the browser refuses changes nothing.
    const request = active
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    request.catch(() => undefined);
  };

  return { supported, active, toggle };
}

/**
 * Fullscreen at the table. None where the browser doesn't allow it, as in Discord's Activity
 * frame, which has its own.
 */
export function FullscreenButton() {
  const { supported, active, toggle } = useFullscreen();
  // `fullscreenEnabled` is missing altogether (undefined) where there is no Fullscreen API.
  if (!supported) return null;

  return (
    <Button size="xs" variant="secondary" aria-pressed={active} onClick={toggle}>
      {active ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
      {active ? 'Exit fullscreen' : 'Fullscreen'}
    </Button>
  );
}
