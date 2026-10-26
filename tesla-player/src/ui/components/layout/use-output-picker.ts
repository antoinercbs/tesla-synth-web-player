import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { WebMidi, type Output } from 'webmidi';
import { useMidiStore } from '@/app/stores/midi';
import { SndTeslaSynth, SYNTH_MODELS, SYNTH_OUTPUT_ID, type MidiSink, type SynthModel } from '@/engine/audio/synth';
import { SERIAL_OUTPUT_ID, SerialMidiOutput } from '@/engine/serial/serial-midi';
import { WebMidiLink } from '@/engine/serial/webmidi-link';
import { isRomPort } from '@/engine/firmware/flash';
import { DevProfiles } from '@/model/devices/registry';
import { DevBoardStatus } from '@/model/sysex/board';
import { ICONS } from '@/ui/helpers/icons';
import { notify } from '@/ui/helpers/toast';

/** An output's row in the sidebar: what plays, and how it is. */
export interface OutRow { icon: string; name: string; sub: string; state: string }
/** The board's own word, in the coils' menu: an alarm, or its lines. */
export type BoardBlock = { alarm: true; coils: string } | { alarm: false; lines: { tone: string; text: string }[] } | null;

/**
 * The outputs, as the sidebar picks them: the coils' (the built-in synth, a Web
 * MIDI interface or board, a serial link to a Syntherrupter) and the speakers'
 * (a Web MIDI interface). It owns the Web MIDI lifecycle and the output
 * resolution, remembers the choices on this machine, says what plays (not what
 * was chosen: a missing device shows as such, the synth standing in) and what
 * the board says of itself.
 */
export function useOutputPicker() {
  const midiStore = useMidiStore();
  const { t } = useI18n();

  // output-1 transport mode: 'synth' | 'midi' | 'serial' (persisted). Defaults
  // from the legacy persisted device id (synth vs a real MIDI output).
  const output1Mode = ref(localStorage.getItem('output1Mode')
    || ((localStorage.getItem('midiOutput1Id') || SYNTH_OUTPUT_ID) === SYNTH_OUTPUT_ID ? 'synth' : 'midi'));
  // built-in synth timbre (persisted); an unknown stored value falls back to the coil
  const synthModels = SYNTH_MODELS;
  const stored = localStorage.getItem('synthModel') as SynthModel | null;
  const synthModel = ref<SynthModel>(stored && SYNTH_MODELS.includes(stored) ? stored : 'tesla');
  // the persisted serial port is being reopened: no "disconnected" before it's tried
  const serialRestoring = ref(localStorage.getItem('output1Mode') === 'serial' && 'serial' in navigator);
  // default to the built-in synth until a real output is explicitly chosen
  const selectedOutputId = ref(localStorage.getItem('midiOutput1Id') || SYNTH_OUTPUT_ID);
  const selectedOutput2Id = ref<string | null>(localStorage.getItem('midiOutput2Id') || null);
  // names of the devices picked, to say which one is unplugged
  const savedOutputName = { 1: ref(localStorage.getItem('midiOutput1Name') || ''), 2: ref(localStorage.getItem('midiOutput2Name') || '') };
  const profiles = DevProfiles.ALL;
  /** Web Serial available (Chromium; also Electron with the main-process handler). */
  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const outputs = computed(() => (midiStore.midiOutputList || []) as Output[]);
  // the ports that name their board come first, apart from the plain interfaces
  const boardOutputs = computed(() => outputs.value.filter((o) => DevProfiles.detect({ midiName: o.name })));
  const interfaceOutputs = computed(() => outputs.value.filter((o) => !DevProfiles.detect({ midiName: o.name })));
  // false while output 1 is still the synth fallback (no device picked yet)
  const selectedOutputListed = computed(() => outputs.value.some((o) => o.id === selectedOutputId.value));
  // until Web MIDI answers, a device not listed yet isn't a device unplugged
  const midiReady = computed(() => midiStore.midiOutputList !== null);
  // the coils' output as it is: 'synth', 'midi', 'serialOn', or chosen but not there:
  // 'missing' (a MIDI interface), 'serial' (no link)
  const coilsOn = computed(() => {
    if (output1Mode.value === 'serial') return midiStore.serialConnected ? 'serialOn' : 'serial';
    if (output1Mode.value === 'midi' && selectedOutputId.value !== SYNTH_OUTPUT_ID) {
      return selectedOutputListed.value ? 'midi' : 'missing';
    }
    return 'synth';
  });
  // where the menu asks which board this is: under the output in use, when it cannot say
  const boardChoiceAt = computed(() => {
    if (coilsOn.value === 'synth') return 'synth';
    if (midiStore.deviceDetected) return null;
    if (coilsOn.value === 'midi') return 'midi';
    if (coilsOn.value === 'serialOn') return 'serial';
    return null;
  });
  /** Compact-rail chip icon for the active output 1. */
  const output1Icon = computed(() => {
    if (midiStore.isSerialOutput) return ICONS.serial;
    if (midiStore.isSynthOutput) return ICONS.synth;
    return ICONS.midi;
  });

  // the board's own word over the output's line: the state it is in comes first
  function withBoard(row: OutRow): OutRow {
    if (midiStore.boardSilent) return { ...row, icon: 'fa-plug-circle-exclamation', sub: t('board.stateSilent'), state: 'warn' };
    const s = midiStore.boardStatus;
    if (!s) return row;
    switch (new DevBoardStatus(s).state) {
      case 'latched': return { ...row, icon: 'fa-triangle-exclamation', sub: t('board.stateLatched'), state: 'alarm' };
      case 'outputError': return { ...row, icon: 'fa-triangle-exclamation', sub: t('board.stateOutputError'), state: 'warn' };
      case 'stop': return { ...row, icon: ICONS.fiber, sub: t('board.stateStop'), state: 'warn' };
      case 'disarmed': return { ...row, sub: t('board.stateDisarmed'), state: 'warn' };
      case 'unmonitored': return { ...row, sub: `${row.sub} · ${t('board.stateUnmonitored')}` };
      default: return { ...row, sub: `${row.sub} · ${t('board.stateOk')}` };
    }
  }
  const coilsOut = computed<OutRow>(() => {
    const midiName = savedOutputName[1].value || t('output.midiSub');
    switch (coilsOn.value) {
      case 'serialOn': {
        const known = midiStore.deviceDetected;
        return withBoard({
          icon: ICONS.serial,
          name: known ? midiStore.deviceProfile.label : midiStore.serialPortLabel,
          sub: known ? t('output.serialLink') : t('output.serialSub'),
          state: 'ok',
        });
      }
      case 'serial':
        return serialRestoring.value
          ? { icon: ICONS.serial, name: t('output.serialName'), sub: t('output.serialSub'), state: 'idle' }
          : { icon: 'fa-plug-circle-xmark', name: t('output.serialName'), sub: t('output.disconnected'), state: 'warn' };
      case 'midi': {
        const known = midiStore.deviceDetected;
        return withBoard({
          icon: known ? ICONS.interrupter : ICONS.midi, name: outputs.value.find((o) => o.id === selectedOutputId.value)!.name,
          sub: known ? t('output.usbMidi') : t('output.midiTo', { board: midiStore.deviceProfile.label }), state: 'ok',
        });
      }
      case 'missing':
        return midiReady.value
          ? { icon: 'fa-plug-circle-xmark', name: midiName, sub: t('output.unplugged'), state: 'warn' }
          : { icon: ICONS.midi, name: midiName, sub: t('output.midiSub'), state: 'idle' };
      default:
        return { icon: ICONS.synth, name: t('output.synth'), sub: t(`label.synthModelName.${synthModel.value}`), state: 'emu' };
    }
  });
  // manual 2nd-output timing offset (ms), persisted per-machine in the store
  const output2Offset = computed({
    get: () => midiStore.output2OffsetMs,
    set: (v: number) => midiStore.setOutput2Offset(Number(v)),
  });
  const offsetLabel = computed(() => `${output2Offset.value > 0 ? '+' : ''}${output2Offset.value} ms`);
  const speakersOut = computed<OutRow>(() => {
    if (!selectedOutput2Id.value) return { icon: ICONS.speakers, name: t('output.none'), sub: '', state: 'none' };
    const dev = outputs.value.find((o) => o.id === selectedOutput2Id.value);
    if (dev) return { icon: ICONS.speakers, name: dev.name, sub: output2Offset.value ? offsetLabel.value : '', state: 'ok' };
    const name = savedOutputName[2].value || t('output.midiSub');
    return midiReady.value
      ? { icon: 'fa-plug-circle-xmark', name, sub: t('output.speakersUnplugged'), state: 'warn' }
      : { icon: ICONS.speakers, name, sub: '', state: 'idle' };
  });
  const outRows = computed(() => [
    { id: 'coils' as const, label: t('output.coils'), ...coilsOut.value },
    { id: 'speakers' as const, label: t('output.speakers'), ...speakersOut.value },
  ]);
  const boardBlock = computed<BoardBlock>(() => {
    const s = midiStore.boardStatus;
    if (midiStore.boardSilent) return { alarm: false, lines: [{ tone: 'warn', text: t('board.lineSilent') }] };
    if (!s) return null;
    if (s.latched) {
      const coils = s.latchCoils.map((i) => {
        const name = midiStore.coilName(i) || t('board.coilN', { n: i });
        const n = midiStore.boardTrips[i];
        return n ? `${name} · ${t('board.trips', { n }, n)}` : name;
      });
      return { alarm: true, coils: coils.join(', ') };
    }
    const state = new DevBoardStatus(s).state;
    const lines = [
      state === 'stop' ? { tone: 'warn', text: t('board.lineStop') }
        : state === 'disarmed' ? { tone: 'warn', text: t('board.lineDisarmed') }
          : { tone: 'ok', text: t('board.lineArmed') },
      s.monitored ? { tone: 'ok', text: t('board.lineMonitored') } : { tone: 'warn', text: t('board.lineUnmonitored') },
      s.outputError ? { tone: 'warn', text: t('board.lineOutputError') }
        : { tone: 'off', text: t('board.outputs', { n: midiStore.deviceProfile.coils }) },
    ];
    return { alarm: false, lines };
  });

  // the synth holds the coils to the same limits as the board (or its last reading, or the defaults)
  watch(() => midiStore.effectiveCoilLimits, (limits) => SndTeslaSynth.shared().setCoilLimits(limits), { immediate: true });
  // and plays each coil with its own physics (its sheet), when the coils' own sound is on
  watch(() => midiStore.coilResponses, (physics) => SndTeslaSynth.shared().setCoilPhysics(physics), { immediate: true });

  function rememberName(n: 1 | 2, name: string): void {
    savedOutputName[n].value = name;
    localStorage.setItem(`midiOutput${n}Name`, name);
  }
  // Config read-back over Web MIDI: pair the output with the device's input of
  // the same name (e.g. the ESP32 Syntherrupter's native USB-MIDI port). A
  // plain interface without such an input gives no link (config page stays off).
  function setMidiDeviceLink(dev: Output | null): void {
    const cur = midiStore.deviceLink;
    if (cur instanceof WebMidiLink) cur.dispose();
    const link = dev && WebMidi.enabled ? WebMidiLink.pair(dev, WebMidi.inputs) : null;
    midiStore.setDeviceLink(link ? markRaw(link) : null);
  }
  // Resolve output 1 from the current mode. Output 2 is always a WebMIDI device.
  // A live serial link is never clobbered (a WebMIDI (dis)connect must not drop
  // it); other modes fall back to the built-in synth so sound always works.
  function resolveOutputs(): void {
    if (output1Mode.value === 'serial') {
      if (!midiStore.serialConnected) midiStore.setMidiOutput(SndTeslaSynth.shared());
    } else if (output1Mode.value === 'midi') {
      const dev = outputs.value.find((o) => o.id === selectedOutputId.value) || null;
      midiStore.setMidiOutput((dev as unknown as MidiSink | null) || SndTeslaSynth.shared());
      setMidiDeviceLink(dev);
      if (dev) rememberName(1, dev.name);
    } else {
      midiStore.setMidiOutput(SndTeslaSynth.shared());
      selectedOutputId.value = SYNTH_OUTPUT_ID;
      setMidiDeviceLink(null);
    }
    const dev2 = outputs.value.find((o) => o.id === selectedOutput2Id.value) || null;
    midiStore.setMidiOutput2(dev2);
    if (dev2) rememberName(2, dev2.name);
  }
  // the synth stands in so that sound never stops, which is exactly what must not go unnoticed
  function reportOutputLost(name: string): void {
    midiStore.setOutputLost(name);
    notify(t('player.outputLostToast', { name }), 'error');
  }
  function reportOutputBack(name: string): void {
    if (!midiStore.outputLost) return;
    midiStore.setOutputLost(null);
    notify(t('player.outputBack', { name }));
  }
  function refreshOutputs(): void {
    const before = midiStore.midiOutput;
    midiStore.setMidiOutputList(WebMidi.outputs);
    resolveOutputs();
    const after = midiStore.midiOutput;
    if (output1Mode.value !== 'midi' || after === before) return;
    if (after?.id === SYNTH_OUTPUT_ID && before && before.id !== SYNTH_OUTPUT_ID) reportOutputLost(before.name);
    else if (after && after.id !== SYNTH_OUTPUT_ID) reportOutputBack(after.name);
  }
  function onEnabled(): void {
    midiStore.setMidiOutputList(WebMidi.outputs);
    WebMidi.addListener('connected', refreshOutputs);
    WebMidi.addListener('disconnected', refreshOutputs);
    resolveOutputs(); // restore the persisted output selection
  }

  // --- output-1 mode switch + serial (Syntherrupter) link ---
  function portLabel(port: SerialPort): string {
    const info = port.getInfo ? port.getInfo() : null;
    if (info && info.usbVendorId != null) {
      const hex = (n: number | undefined) => (n || 0).toString(16).padStart(4, '0');
      return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
    }
    return t('label.serialPort');
  }
  async function openSerial(port: SerialPort): Promise<void> {
    const label = portLabel(port);
    const out = await SerialMidiOutput.open(port, label, () => onSerialClosed(label));
    midiStore.setMidiOutput(markRaw(out));
    midiStore.setDeviceLink(out);
    midiStore.setSerialConnection(label);
    reportOutputBack(label);
  }
  async function closeSerial(): Promise<void> {
    const out = midiStore.midiOutput;
    midiStore.setSerialConnection(null);
    if (midiStore.deviceLink === (out as unknown)) midiStore.setDeviceLink(null);
    if (out && out.id === SERIAL_OUTPUT_ID) { try { await (out as SerialMidiOutput).close(); } catch { /* */ } }
  }
  function onSerialClosed(label: string): void {
    // stream ended (physical unplug or close) — drop the link + fall back
    const wasOpen = midiStore.serialConnected;
    midiStore.setSerialConnection(null);
    if (midiStore.deviceLink instanceof SerialMidiOutput) midiStore.setDeviceLink(null);
    if (output1Mode.value === 'serial') resolveOutputs();
    if (wasOpen && output1Mode.value === 'serial') reportOutputLost(label);
  }
  // A port this app was allowed before, plugged back (or the device rebooted, from
  // its config page): reopen it without the picker, as at startup.
  function onSerialPortConnect(e: Event): void {
    const port = e.target as SerialPort | null;
    if (output1Mode.value !== 'serial' || midiStore.serialConnected || !port || isRomPort(port)) return;
    openSerial(port).catch((err) => console.error('Serial reconnect failed', err));
  }
  function onMode1Change(mode: string): void {
    localStorage.setItem('output1Mode', mode);
    midiStore.setOutputLost(null);
    if (mode !== 'serial' && midiStore.serialConnected) void closeSerial();
    if (mode === 'serial') setMidiDeviceLink(null); // the serial link provides it once connected
    if (mode === 'synth') {
      const synth = SndTeslaSynth.shared();
      synth.resume(); // the click is a user gesture → unlock the AudioContext
      midiStore.setMidiOutput(synth);
      selectedOutputId.value = SYNTH_OUTPUT_ID;
      localStorage.setItem('midiOutput1Id', SYNTH_OUTPUT_ID);
    } else {
      resolveOutputs(); // midi → device/synth ; serial → synth until Connect
    }
  }
  function onOutput2Change(): void {
    if (selectedOutput2Id.value) localStorage.setItem('midiOutput2Id', selectedOutput2Id.value);
    else localStorage.removeItem('midiOutput2Id');
    midiStore.setMidiOutput2(outputs.value.find((o) => o.id === selectedOutput2Id.value) || null);
  }

  function setSynthModel(model: SynthModel): void {
    synthModel.value = model;
    localStorage.setItem('synthModel', model);
    SndTeslaSynth.shared().setModel(model);
  }
  function pickSynth(): void {
    if (coilsOn.value === 'synth') return;
    output1Mode.value = 'synth';
    onMode1Change('synth');
  }
  function pickMidi(dev: Output): void {
    selectedOutputId.value = dev.id;
    localStorage.setItem('midiOutput1Id', dev.id);
    rememberName(1, dev.name);
    output1Mode.value = 'midi';
    onMode1Change('midi');
  }
  function pickSpeakers(dev: Output | null): void {
    selectedOutput2Id.value = dev ? dev.id : null;
    if (dev) rememberName(2, dev.name);
    onOutput2Change();
  }
  // the output becomes the serial link once there is one: a dismissed picker changes nothing
  async function connectSerial(): Promise<void> {
    if (!serialSupported) return;
    try {
      const port = await navigator.serial.requestPort();
      setMidiDeviceLink(null);
      await openSerial(port);
    } catch (err) {
      if (err && (err as Error).name !== 'NotFoundError') { // NotFoundError = picker dismissed
        notify('label.serialError', 'error');
        console.error('Serial connect failed', err);
      }
      return;
    }
    output1Mode.value = 'serial';
    localStorage.setItem('output1Mode', 'serial');
    midiStore.setOutputLost(null);
  }
  function disconnectSerial(): void {
    output1Mode.value = 'synth';
    onMode1Change('synth'); // closes the link
  }

  onMounted(() => {
    SndTeslaSynth.shared().setModel(synthModel.value);
    resolveOutputs(); // built-in synth available immediately, even before/without WebMIDI
    WebMidi.enable({ sysex: true }).then(onEnabled).catch((err) => console.error('WebMIDI:', err));
    // Serial mode persisted → silently reopen a previously-authorized port (no prompt).
    if (output1Mode.value === 'serial' && serialSupported) {
      navigator.serial.getPorts()
        .then((ports) => {
          const port = ports.find((p) => !isRomPort(p));
          return port ? openSerial(port) : undefined;
        })
        .catch(() => { })
        .finally(() => { serialRestoring.value = false; });
    }
    if (serialSupported) navigator.serial.addEventListener('connect', onSerialPortConnect);
  });
  onBeforeUnmount(() => {
    if (serialSupported) navigator.serial.removeEventListener('connect', onSerialPortConnect);
    if (WebMidi.enabled) {
      WebMidi.removeListener('connected', refreshOutputs);
      WebMidi.removeListener('disconnected', refreshOutputs);
    }
  });

  return {
    profiles, synthModels, synthModel, serialSupported, outputs, boardOutputs, interfaceOutputs,
    selectedOutputId, selectedOutput2Id, coilsOn, boardChoiceAt, output1Icon, coilsOut, speakersOut, outRows,
    boardBlock, output2Offset, offsetLabel,
    setSynthModel, pickSynth, pickMidi, pickSpeakers, connectSerial, disconnectSerial,
  };
}
