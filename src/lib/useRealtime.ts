import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();
let es: EventSource | null = null;
let startedAt = 0;

function ensureStream() {
  if (es) return;
  const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
  const open = () => {
    try {
      // withCredentials is required: the stream is session-authenticated, and a
      // cross-origin EventSource (dev server on :5173, API on :8000) omits cookies
      // without it. Harmless same-origin in production.
      es = new EventSource(base + '/stream', { withCredentials: true });
      es.onmessage = () => listeners.forEach((l) => { try { l(); } catch {} });
      es.onerror = () => { /* EventSource reconnects automatically */ };
    } catch {
      setTimeout(ensureStream, 4000);
    }
  };
  if (Date.now() - startedAt < 3000) {
    setTimeout(open, Math.max(0, 3000 - (Date.now() - startedAt)));
  } else {
    open();
  }
}

export function useRealtime(onEvent?: () => void) {
  useEffect(() => {
    const cb = onEvent || (() => {});
    listeners.add(cb);
    startedAt = Date.now();
    ensureStream();
    return () => {
      listeners.delete(cb);
      if (es && listeners.size === 0) {
        es.close();
        es = null;
      }
    };
  }, [onEvent]);
}

export function useRealtimeTick(): number {
  const [tick, setTick] = useState(0);
  useRealtime(() => setTick((n) => n + 1));
  return tick;
}