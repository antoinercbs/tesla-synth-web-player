import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBytes } from '@/tuning/heat';
import type { NoteResult, SessionEvent, SessionInfo } from '@/tuning/protocol';
import { fakeTuningRequest, joinFakePhone, phoneStartCamera, phoneTapBreakout, phoneValidateZone, phoneView, resetFakeCamera } from './fake-camera';

const SESSION = '/api/tuning/sessions/tour-demo';
const call = (method: string, path: string, body?: unknown): unknown => fakeTuningRequest(method, new URL(path, 'http://demo'), body);
const poll = (): { events: SessionEvent[]; info: SessionInfo } =>
  call('get', `${SESSION}/poll?after=0&who=desktop`) as { events: SessionEvent[]; info: SessionInfo };
const send = (type: string, payload: unknown): unknown => call('post', `${SESSION}/events`, { from: 'desktop', type, payload });
const last = (type: string): SessionEvent | undefined => poll().events.filter((e) => e.type === type).at(-1);

function runNote(tapTurns: number): NoteResult {
  send('trial:begin', { trialId: `t${tapTurns}`, tapTurns });
  send('tone:start', { trialId: `t${tapTurns}`, noteIndex: 0, note: 60, holdMs: 1500 });
  vi.advanceTimersByTime(1500);
  send('tone:end', { trialId: `t${tapTurns}`, noteIndex: 0 });
  return last('measure:note')!.payload as NoteResult;
}

describe("the tuning tour's fake phone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetFakeCamera();
    vi.useRealTimers();
  });

  it('only answers the session it created', () => {
    expect(call('get', `${SESSION}/poll?after=0`)).toBeUndefined();
    expect(call('post', '/api/tuning/sessions')).toMatchObject({ id: 'tour-demo' });
    expect(call('get', '/api/tuning/sessions/other/poll?after=0')).toBeUndefined();
    call('delete', SESSION);
    expect(call('get', `${SESSION}/poll?after=0`)).toBeUndefined();
  });

  it('joins when asked, then sends its zone once validated', () => {
    call('post', '/api/tuning/sessions');
    vi.advanceTimersByTime(5000);
    expect(poll().info.cameraOnline).toBe(false); // waits for its step
    joinFakePhone();
    vi.advanceTimersByTime(500);
    expect(poll().info.cameraOnline).toBe(true);
    phoneValidateZone();
    expect(last('camera:geometry')).toBeUndefined(); // no breakout yet
    phoneStartCamera();
    phoneTapBreakout();
    phoneValidateZone();
    expect(phoneView.step).toBe('ready');
    expect(last('camera:geometry')?.payload).toMatchObject({ width: 640, height: 480 });
  });

  it('answers the background capture of a trial', () => {
    call('post', '/api/tuning/sessions');
    send('capture:background', { trialId: 'a', frames: 24 });
    vi.advanceTimersByTime(1000);
    expect(last('background:ready')?.payload).toMatchObject({ trialId: 'a' });
  });

  it('measures longer arcs near the peak, with a silhouette', () => {
    call('post', '/api/tuning/sessions');
    const near = runNote(6);
    const far = runNote(4);
    expect(near.p90).toBeGreaterThan(far.p90 * 1.5);
    expect(decodeBytes(near.heat!.data).length).toBe(near.heat!.w * near.heat!.h);
  });
});
