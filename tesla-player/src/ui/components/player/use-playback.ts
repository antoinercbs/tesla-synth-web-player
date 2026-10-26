import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import type { CoilConfig, Song } from '@/model/domain';
import type { MidiAnalysis } from '@/model/midi/analyze';
import { MidAutomation } from '@/model/midi/automation';
import { DevChannelMask } from '@/model/sysex/channel-mask';
import { SERIAL_OUTPUT_ID } from '@/engine/serial/serial-midi';
import SmfPlayer from '@/engine/smfplayer/js/smfPlayer.js';

interface SmfPlayerInstance {
  init(midi: unknown, latency: number, eventNo: number): void;
  startPlay(): void;
  stopPlay(): void;
  /** Reposition the event cursor to `targetMs` (no output); sets `eventTime`. */
  seek(targetMs: number): void;
  setGM(): void;
  finished: boolean;
  /** Wall-clock origin (performance.now) the player schedules output against. */
  startTime: number;
  /** Cumulative song position (ms) of the cursor — set by seek / advanced by playback. */
  eventTime: number;
  /** Manual timing offset (ms) added to the 2nd output (hardware calibration). */
  output2Offset: number;
  /** The timer's period (ms); 0: a tick of the song. */
  tickMs: number;
  dispEventMonitor: (msg: unknown[], type: unknown) => void;
}

export interface PlaybackInputs {
  /** The song as the board plays it (each place on its output). */
  song: Ref<Song | null>;
  /** Its MIDI file, parsed (SmfParser). */
  parsed: Ref<unknown>;
  analysis: Ref<MidiAnalysis | null>;
  durationMs: Ref<number>;
  /** The live power (%) of the coil on an output. */
  powerOf: (o: number) => number;
  onPlayingChange: (playing: boolean) => void;
  onFinished: () => void;
}

const PLAY_LATENCY_MS = 800; // output look-ahead passed to the SmfPlayer
// playheadMs while playing: the clock to the tenth, the strips' lights. What moves with the
// sound (a playhead line, the arcs) reads clock() every frame instead
const PLAYHEAD_TICK_MS = 66;
const AUTOMATION_TICK_MS = 50;
// Web MIDI and the synth play a message at its timestamp: fed every 20 ms, far inside the look-ahead,
// rather than every tick of the song (~1 ms). The serial link plays it as it comes: fed every tick
const SCHEDULE_TICK_MS = 20;

// the players sounding now: while one does, the looks' decorations hold still (styles/themes/_index.scss)
const sounding = new Set<object>();
function setSounding(who: object, on: boolean): void {
  if (on) sounding.add(who);
  else sounding.delete(who);
  if (sounding.size) document.documentElement.dataset.playing = '';
  else delete document.documentElement.dataset.playing;
}
const DUTY_STEPS = 2000; // 0.05 % of duty

/**
 * A song played on the outputs: the SmfPlayer streaming its notes a look-ahead
 * ahead of the clock, the board configured for it, its power automation and the
 * live power sent as it is heard, the transport (play, pause, seek, stop) and the
 * playhead the views follow.
 */
export function usePlayback(i: PlaybackInputs) {
  const midiStore = useMidiStore();
  const { song } = i;
  // `paused` = frozen at a position (cued), not sounding. `isPlaying` = actively sounding.
  const isPlaying = ref(false);
  const paused = ref(false);
  const playheadMs = ref(0);
  const me = {};
  watch(isPlaying, (on) => setSounding(me, on));

  let smfPlayer: SmfPlayerInstance | null = null;
  let rafId: number | null = null;
  let playStart = 0;
  let finishedTimer: ReturnType<typeof setInterval> | null = null;
  // natural end-of-song: when the player reports `finished` (nominal end), wait one
  // look-ahead so the events scheduled PLAY_LATENCY_MS ahead actually play out (and
  // the playhead reaches the end) before we stop. Null = not yet finished.
  let finishedAt: number | null = null;
  // apply 2nd-output calibration live (takes effect on events scheduled after the change)
  watch(() => midiStore.output2OffsetMs, (v) => { if (smfPlayer) smfPlayer.output2Offset = v; });
  // set when a song must auto-start as soon as its MIDI is parsed
  let pendingAutoplay = false;

  // Playhead = the song position currently HEARD. Output is scheduled PLAY_LATENCY_MS
  // ahead of the nominal clock (look-ahead buffer), so the audio of song-position X is
  // heard at startTime + X + latency. We therefore offset the playhead by the latency so
  // the progress bar / VU / cursor line up with the sound (for the synth and real MIDI
  // alike) instead of running ~latency ahead. It sits at 0 until the first sound is heard.
  function startPlayhead(): void {
    playStart = smfPlayer?.startTime ?? performance.now();
    let last = -Infinity;
    const tick = (t: number): void => {
      if (t - last >= PLAYHEAD_TICK_MS) {
        last = t;
        playheadMs.value = heardMs();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  /** Where the song is heard, as of now: read every frame, where playheadMs comes a few times a second. */
  function clock(): number {
    return rafId != null ? heardMs() : playheadMs.value;
  }

  /** The board's outputs a song leaves free, with no channel. */
  function freeOutputs(s: Song): CoilConfig[] {
    const used = new Set((s.coils ?? []).map((c) => c.coilIndex));
    return Array.from({ length: midiStore.deviceProfile.coils }, (_, o) => o)
      .filter((o) => !used.has(o))
      .map((o) => ({ coilIndex: o, channelMask: 0, ontimeUs: 0, duty: 0 }));
  }

  function executeConfig(): void {
    if (!song.value) return;
    const driver = midiStore.driver;
    // the device may lack the file's library envelopes, or hold another version
    for (const frame of driver.libraryEnvelopes(i.analysis.value?.programs ?? [])) midiStore.sendSysex(frame);
    for (const frame of driver.coilConfig(song.value.coils ?? [], song.value.mode ?? 'midi')) {
      midiStore.sendSysex(frame);
    }
    // the outputs it leaves free play nothing: no channel from the previous song
    for (const frame of driver.coilRouting(freeOutputs(song.value))) midiStore.sendSysex(frame);
    // sent even when the song has none: the coils would keep the previous song's places
    for (const frame of driver.stereo(song.value.stereo, song.value.coilCount)) midiStore.sendSysex(frame);
    for (const message of driver.stereoChannels(song.value.stereo)) midiStore.midiOutput?.send(message);
  }

  /*
   * Power automation, sent as the song is HEARD rather than queued ahead on the
   * output with the notes: every send takes the live power as it is at that
   * moment, so the fader always applies on top of the automation. A frame queued
   * ahead could not be recalled when the fader moves (clearing the output would
   * drop the notes too). A timer tick of jitter is harmless for power changes.
   */
  let automationTimer: ReturnType<typeof setInterval> | null = null;
  // last level sent per coil: a ramp only sends when the rounded value changes,
  // which keeps a serial link from saturating
  const sentLevels = new Map<number, { ontimeUs: number; dutyKey: number }>();

  /**
   * A change made while the song plays (the song editor) reaches the board at
   * once: the coils' channels and places when they changed, their levels always.
   * The playback mode is not switched on again: that resets the controllers.
   */
  function applyEdits(before: Song, now: Song): void {
    const driver = midiStore.driver;
    const routing = (x: Song): string => JSON.stringify((x.coils ?? []).map((c) => [c.coilIndex, c.channelMask]));
    if (routing(before) !== routing(now)) {
      for (const frame of driver.coilRouting([...(now.coils ?? []), ...freeOutputs(now)])) midiStore.sendSysex(frame);
    }
    if (JSON.stringify(before.stereo ?? null) !== JSON.stringify(now.stereo ?? null) || before.coilCount !== now.coilCount) {
      for (const frame of driver.stereo(now.stereo, now.coilCount)) midiStore.sendSysex(frame);
      for (const message of driver.stereoChannels(now.stereo)) midiStore.midiOutput?.send(message);
    }
    if (JSON.stringify(before.events ?? []) !== JSON.stringify(now.events ?? [])) startAutomation();
    sendCoilLevels(heardMs());
  }
  /** Send each coil its configured values × the automation at `ms` × the live power. */
  function sendCoilLevels(ms: number, force = false): void {
    const out = midiStore.midiOutput;
    if (!out || !song.value) return;
    const driver = midiStore.driver;
    for (const coil of song.value.coils ?? []) {
      const lvl = new MidAutomation(song.value.events ?? []).levelAt(coil, ms, i.powerOf(coil.coilIndex), i.powerOf(coil.coilIndex));
      const dutyKey = Math.round(lvl.duty * DUTY_STEPS);
      const last = sentLevels.get(coil.coilIndex);
      if (force || last?.ontimeUs !== lvl.ontimeUs) out.send(driver.coilLevel(coil.coilIndex, 'ontime', lvl.ontimeUs));
      if (force || last?.dutyKey !== dutyKey) out.send(driver.coilLevel(coil.coilIndex, 'duty', lvl.duty));
      sentLevels.set(coil.coilIndex, { ontimeUs: lvl.ontimeUs, dutyKey });
    }
  }
  /** The song position being heard now (the output runs PLAY_LATENCY_MS ahead). */
  function heardMs(): number {
    return Math.max(0, performance.now() - playStart - PLAY_LATENCY_MS);
  }
  function startAutomation(): void {
    stopAutomation();
    if (!song.value?.events?.length) return; // no curve: the fader alone, sent by applyLive
    automationTimer = setInterval(() => { if (isPlaying.value) sendCoilLevels(heardMs()); }, AUTOMATION_TICK_MS);
  }
  function stopAutomation(): void {
    if (automationTimer) { clearInterval(automationTimer); automationTimer = null; }
  }

  /** Build a fresh SmfPlayer for the current song/outputs (cursor at the start). */
  function buildPlayer(): SmfPlayerInstance {
    const coilUnion = (song.value?.coils ?? []).reduce((m, c) => m | c.channelMask, 0);
    const ch1 = new DevChannelMask(coilUnion).channels;
    const ch2 = new DevChannelMask(song.value?.output2Mask ?? 0).channels;
    const p = new SmfPlayer(midiStore.midiOutput, midiStore.midiOutput2, ch1, ch2) as unknown as SmfPlayerInstance;
    p.output2Offset = midiStore.output2OffsetMs; // hardware calibration for output 2
    p.tickMs = midiStore.midiOutput?.id === SERIAL_OUTPUT_ID ? 0 : SCHEDULE_TICK_MS;
    p.init(i.parsed.value, PLAY_LATENCY_MS, 0);
    return p;
  }

  function startFinishedTimer(): void {
    finishedAt = null;
    finishedTimer = setInterval(() => {
      if (!smfPlayer?.finished) return;
      // The player reports `finished` at the NOMINAL end, but events are scheduled one
      // look-ahead later, so the tail is still sounding. Wait that long before stopping
      // (otherwise the output flush would cut the last PLAY_LATENCY_MS of audio and the
      // bar would never reach the end).
      if (finishedAt == null) { finishedAt = performance.now(); return; }
      if (performance.now() - finishedAt < PLAY_LATENCY_MS) return;
      stop();
      i.onFinished();
    }, 100);
  }

  /** Flush an output's scheduled-but-unsent messages, if the browser supports it. */
  function clearOutput(out: typeof midiStore.midiOutput): void {
    const o = out as unknown as { clear?: () => void } | null;
    if (o && typeof o.clear === 'function') o.clear();
  }

  /** Tear down the live engine: timers, scheduled output, sounding notes, playhead loop.
   *  Does NOT touch isPlaying/paused/playheadMs — callers set the resulting state. */
  function teardownPlayback(): void {
    pendingAutoplay = false;
    finishedAt = null;
    if (finishedTimer) { clearInterval(finishedTimer); finishedTimer = null; }
    if (smfPlayer) smfPlayer.stopPlay();
    clearOutput(midiStore.midiOutput);
    clearOutput(midiStore.midiOutput2);
    midiStore.midiOutput?.sendAllSoundOff();
    midiStore.midiOutput2?.sendAllSoundOff();
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } // freeze the playhead in place
    stopAutomation();
  }

  /** Unified entry: (re)configure and play from song-position `fromMs` (0 = the start). */
  function playFrom(fromMs: number): void {
    if (!i.parsed.value || !midiStore.midiOutput) return;
    midiStore.midiOutput.resume?.(); // unlock the synth's AudioContext (a play is a gesture)
    const wasPlaying = isPlaying.value;
    cancelTailSilence(); // it would cut this song's first notes
    teardownPlayback();
    executeConfig();
    smfPlayer = buildPlayer();
    if (fromMs > 0) smfPlayer.seek(fromMs); // position the cursor (eventTime ≈ fromMs)
    else smfPlayer.setGM();
    sendCoilLevels(smfPlayer.eventTime, true); // coils → their level at this position
    // map wall-now to this song position, then schedule the notes; the automation follows the playhead
    smfPlayer.startTime = performance.now() - smfPlayer.eventTime;
    startPlayhead();
    startAutomation();
    smfPlayer.startPlay();
    isPlaying.value = true;
    paused.value = false;
    if (!wasPlaying) i.onPlayingChange(true);
    startFinishedTimer();
  }

  function play(): void {
    playFrom(0);
  }

  /** Freeze playback at the current position (cued). The cursor + playhead are kept;
   *  pressing play resumes from here. */
  function pause(): void {
    if (!isPlaying.value) return;
    playheadMs.value = clock(); // to the ms: resuming there doubles nothing
    teardownPlayback();
    silence(); // the coils stop where the playhead stops, so resuming there doubles nothing
    isPlaying.value = false;
    paused.value = true;
    i.onPlayingChange(false);
  }

  function togglePlayPause(): void {
    if (isPlaying.value) pause();
    // Resume from playheadMs = the HEARD position (0 if stopped, else the frozen paused
    // playhead). Correct because pause flushes the look-ahead, so the last sound heard was
    // exactly playheadMs — restarting there replays the rest with no gap and no double-play.
    else playFrom(playheadMs.value);
  }

  /** Jump to song-position `ms`. While playing → keep playing from there; otherwise
   *  just move the playhead and stay silent (no surprise coil output). */
  function seek(ms: number): void {
    if (!i.parsed.value) return;
    const target = Math.max(0, Math.min(ms, i.durationMs.value || 0));
    if (isPlaying.value) {
      playFrom(target);
    } else {
      playheadMs.value = target;
      paused.value = true; // cued at the new position
    }
  }

  function stop(): void {
    const wasPlaying = isPlaying.value;
    const active = wasPlaying || paused.value;
    teardownPlayback();
    if (active) silence();
    isPlaying.value = false;
    paused.value = false;
    if (wasPlaying) i.onPlayingChange(false);
    playheadMs.value = 0;
  }

  // The coils go quiet at once (silenceCoils), but the notes already queued on a Web
  // MIDI output still come out for up to a look-ahead, on the 2nd output (speakers)
  // too: a last All Sound Off follows them.
  let tailTimer: ReturnType<typeof setTimeout> | null = null;
  function silence(): void {
    midiStore.silenceCoils();
    cancelTailSilence();
    tailTimer = setTimeout(() => {
      tailTimer = null;
      midiStore.midiOutput?.sendAllSoundOff();
      midiStore.midiOutput2?.sendAllSoundOff();
    }, PLAY_LATENCY_MS + 100);
  }
  function cancelTailSilence(): void {
    if (tailTimer) { clearTimeout(tailTimer); tailTimer = null; }
  }

  // The stage changed while playing (a coil plugged elsewhere, unplugged, a twin, the coils' list): the song
  // starts again where it is heard, as a seek does. Re-routing the channels alone would leave the notes
  // already sounding on the coils they started on, and the coils that take them over silent until the next.
  watch(() => JSON.stringify([midiStore.wiring, midiStore.coilList.map((c) => [c.uuid, c.twinGroup ?? null])]), (now, before) => {
    if (now !== before && isPlaying.value && song.value) playFrom(clock());
  });
  // Panic, from this player, the Play page's Esc or the Live/Fixed modes
  watch(() => midiStore.panicRev, () => stop());
  // the engine holds the outputs it was built with: a song can't carry on on another one
  watch(() => midiStore.midiOutput, (out, prev) => {
    if (!isPlaying.value && !paused.value) return;
    stop();
    if (prev && prev !== out) midiStore.silenceCoils(prev);
  });

  // One live update: re-send each coil at the automation's level where the song is
  // heard × the new live power.
  function applyLive(): void {
    sendCoilLevels(isPlaying.value ? heardMs() : playheadMs.value, true);
  }
  // While a fader moves: at most one update per automation tick, and only the coils
  // whose rounded level changed, which a serial link keeps up with.
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  function applyLiveSoon(): void {
    if (liveTimer) return;
    liveTimer = setTimeout(() => {
      liveTimer = null;
      sendCoilLevels(isPlaying.value ? heardMs() : playheadMs.value);
    }, AUTOMATION_TICK_MS);
  }

  /** Starts as soon as the song's MIDI is parsed (ready()), unless something else stops it first. */
  function playWhenReady(): void {
    pendingAutoplay = true;
  }
  function cancelAutoplay(): void {
    pendingAutoplay = false;
  }
  /** The song's MIDI is parsed: a pending start goes. */
  function ready(): void {
    if (pendingAutoplay) { pendingAutoplay = false; play(); }
  }

  onBeforeUnmount(() => {
    stop(); // stop playback + clear timers if the player unmounts
    if (liveTimer) clearTimeout(liveTimer);
    setSounding(me, false);
  });

  return {
    isPlaying, paused, playheadMs, clock,
    play, playFrom, pause, togglePlayPause, seek, stop,
    executeConfig, applyEdits, applyLive, applyLiveSoon,
    playWhenReady, cancelAutoplay, ready,
  };
}
