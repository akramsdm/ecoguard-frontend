/** @vitest-environment jsdom */
// React 19 only wires act() when this environment flag is set (jsdom).
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import React from 'react';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {useRealtimeEvents,__realtimeTestReset} from './useRealtime';
import type {RealtimeEvent} from './useRealtime';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: {data: string}) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
}

function Host({cb, enabled}: {cb: (ev: RealtimeEvent) => void; enabled: boolean}) {
  useRealtimeEvents(cb, enabled);
  return null;
}

beforeEach(() => {
  __realtimeTestReset();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(cb: (ev: RealtimeEvent) => void, enabled = true): Root {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Host cb={cb} enabled={enabled} />));
  return root;
}

describe('realtime subscription wiring (step 5)', () => {
  it('opens the single shared stream only while enabled, and closes on disable', async () => {
    vi.useFakeTimers();
    const calls: RealtimeEvent[] = [];
    const root = mount((e) => calls.push(e), true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain('/stream');

    // Disable (simulates logout): the hole closes, no new stream is opened.
    act(() => root.render(<Host cb={(e) => calls.push(e)} enabled={false} />));
    expect(FakeEventSource.instances[0].close).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => root.unmount());
  });

  it('parses incoming messages and dispatches typed events to listeners', async () => {
    vi.useFakeTimers();
    const calls: RealtimeEvent[] = [];
    const root = mount((e) => calls.push(e), true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

    const es = FakeEventSource.instances[0];
    act(() => {
      es.onmessage!({data: JSON.stringify({type: 'reports.updated', object_id: 'r1', event: 'reports.updated', at: 1})});
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({type: 'reports.updated', object_id: 'r1', event: 'reports.updated', at: 1});

    // Malformed or non-matching payloads are ignored, never thrown.
    act(() => { es.onmessage!({data: 'not-json'}); });
    act(() => { es.onmessage!({data: JSON.stringify({unrelated: true})}); });
    expect(calls).toHaveLength(1);

    act(() => root.unmount());
  });
});