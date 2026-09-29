import { useEffect, useState } from 'react';

// Realtime SSE client for the authenticated /stream endpoint.
//
// The stream is session-authenticated and metadata-only (event type, object id,
// timestamp) — it carries no report content. Because it requires a session,
// anonymous screens (the public community map) deliberately do NOT subscribe:
// they poll, and the server cache keeps that cheap. Staff screens subscribe
// while authenticated only: the subscription below opens when at least one
// listener is enabled and closes when the last one disables (logout clears the
// app-level subscriber in AppShell).

export interface RealtimeEvent {
  id?: string | number;
  type: string;
  object_id: string;
  event: string;
  at?: number;
}

const listeners = new Set<(ev: RealtimeEvent) => void>();
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
      es.onmessage = (raw) => {
        let ev: RealtimeEvent | null = null;
        try {
          const p = JSON.parse(String((raw as MessageEvent).data));
          if (p && typeof p.type === 'string' && typeof p.object_id === 'string') {
            ev = p as RealtimeEvent;
          }
        } catch {
          /* non-JSON or unexpected shape: ignore */
        }
        if (ev) listeners.forEach((l) => { try { l(ev as RealtimeEvent); } catch {} });
      };
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

/**
 * Subscribe to typed realtime events. Opens the single shared EventSource when
 * `enabled` and a listener are present; closes it when the last listener goes
 * away (e.g. user signs out). `onEvent` receives parsed `{type,object_id,event,at}`.
 */
export function useRealtimeEvents(onEvent?: (ev: RealtimeEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
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
  }, [onEvent, enabled]);
}

/** Backwards-compatible fire-and-forget tick (App.tsx legacy usage). */
export function useRealtime(onEvent?: () => void) {
  useRealtimeEvents(() => {
    if (onEvent) onEvent();
  });
}

export function useRealtimeTick(): number {
  const [tick, setTick] = useState(0);
  useRealtimeEvents(() => setTick((n) => n + 1));
  return tick;
}

/** Test-only reset so suites start with a clean module-level stream. */
export function __realtimeTestReset() {
  if (es) {
    try { es.close(); } catch {}
  }
  es = null;
  listeners.clear();
  startedAt = 0;
}