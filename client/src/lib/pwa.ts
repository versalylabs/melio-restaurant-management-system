import { useEffect, useState } from 'react';

/**
 * Installable app for staff: the service worker keeps the app on the device so
 * the POS opens without internet. It is only set up for staff (signed in, or on
 * a staff screen), so customers ordering online don't download the staff app.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
let started = false;
let updateRequested = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => { installEvent = null; emit(); });
}

const STAFF_PATHS = /^\/(pos|login|dashboard|orders|tables|kitchen|payments|shifts)(\/|$)/;

/** Call at startup and after a staff sign-in; does nothing for customers or in development. */
export function registerServiceWorker(force = false) {
  if (started || !import.meta.env.PROD || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const isStaff = force || !!localStorage.getItem('token') || STAFF_PATHS.test(window.location.pathname);
  if (!isStaff) return;
  started = true;
  const hadController = !!navigator.serviceWorker.controller;
  const register = async () => {
    try {
      // The file itself carries the build version, so the browser spots a new one on its own.
      const reg = await navigator.serviceWorker.register('/sw.js');
      const track = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // A new version finished downloading while this one is in use.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) { waitingWorker = worker; emit(); }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { waitingWorker = reg.waiting; emit(); }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // Look for a new version when staff come back to the app, and every 30 minutes.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => undefined); });
      setInterval(() => reg.update().catch(() => undefined), 30 * 60 * 1000);
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register());
  // Reload only when staff asked for the update; never on the first install.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || !updateRequested) return;
    updateRequested = false;
    window.location.reload();
  });
}

export function usePwa() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return {
    canInstall: !!installEvent,
    install: async () => {
      if (!installEvent) return;
      await installEvent.prompt();
      await installEvent.userChoice.catch(() => undefined);
      installEvent = null;
      emit();
    },
    updateReady: !!waitingWorker,
    update: () => {
      updateRequested = true;
      waitingWorker?.postMessage('SKIP_WAITING');
    },
  };
}
