(function () {
    'use strict';

    class Logger {
        enabled = true;
        log(...args) {
            if (this.enabled) {
                console.log(...args);
            }
        }
        warn(...args) {
            if (this.enabled) {
                console.warn(...args);
            }
        }
        error(...args) {
            if (this.enabled) {
                console.error(...args);
            }
        }
    }
    const logger = new Logger();
    logger.enabled = false;

    class SampleTable {
        samples = {};
        addSample(sample, bank, instrument, keyRange, velRange) {
            for (let i = keyRange[0]; i <= keyRange[1]; i++) {
                if (this.samples[bank] === undefined) {
                    this.samples[bank] = {};
                }
                if (this.samples[bank][instrument] === undefined) {
                    this.samples[bank][instrument] = {};
                }
                if (this.samples[bank][instrument][i] === undefined) {
                    this.samples[bank][instrument][i] = [];
                }
                this.samples[bank][instrument][i].push({ ...sample, velRange });
            }
        }
        getSamples(bank, instrument, pitch, velocity) {
            const samples = this.samples?.[bank]?.[instrument]?.[pitch];
            return (samples?.filter((s) => velocity >= s.velRange[0] && velocity <= s.velRange[1]) ?? []);
        }
    }

    var MIDIControlEvents = {
        MSB_BANK: 0x00,
        MSB_MODWHEEL: 0x01,
        MSB_BREATH: 0x02,
        MSB_FOOT: 0x04,
        MSB_PORTAMENTO_TIME: 0x05,
        MSB_DATA_ENTRY: 0x06,
        MSB_MAIN_VOLUME: 0x07,
        MSB_BALANCE: 0x08,
        MSB_PAN: 0x0a,
        MSB_EXPRESSION: 0x0b,
        MSB_EFFECT1: 0x0c,
        MSB_EFFECT2: 0x0d,
        MSB_GENERAL_PURPOSE1: 0x10,
        MSB_GENERAL_PURPOSE2: 0x11,
        MSB_GENERAL_PURPOSE3: 0x12,
        MSB_GENERAL_PURPOSE4: 0x13,
        LSB_BANK: 0x20,
        LSB_MODWHEEL: 0x21,
        LSB_BREATH: 0x22,
        LSB_FOOT: 0x24,
        LSB_PORTAMENTO_TIME: 0x25,
        LSB_DATA_ENTRY: 0x26,
        LSB_MAIN_VOLUME: 0x27,
        LSB_BALANCE: 0x28,
        LSB_PAN: 0x2a,
        LSB_EXPRESSION: 0x2b,
        LSB_EFFECT1: 0x2c,
        LSB_EFFECT2: 0x2d,
        LSB_GENERAL_PURPOSE1: 0x30,
        LSB_GENERAL_PURPOSE2: 0x31,
        LSB_GENERAL_PURPOSE3: 0x32,
        LSB_GENERAL_PURPOSE4: 0x33,
        SUSTAIN: 0x40,
        PORTAMENTO: 0x41,
        SOSTENUTO: 0x42,
        SUSTENUTO: 0x42,
        SOFT_PEDAL: 0x43,
        LEGATO_FOOTSWITCH: 0x44,
        HOLD2: 0x45,
        SC1_SOUND_VARIATION: 0x46,
        SC2_TIMBRE: 0x47,
        SC3_RELEASE_TIME: 0x48,
        SC4_ATTACK_TIME: 0x49,
        SC5_BRIGHTNESS: 0x4a,
        SC6: 0x4b,
        SC7: 0x4c,
        SC8: 0x4d,
        SC9: 0x4e,
        SC10: 0x4f,
        GENERAL_PURPOSE5: 0x50,
        GENERAL_PURPOSE6: 0x51,
        GENERAL_PURPOSE7: 0x52,
        GENERAL_PURPOSE8: 0x53,
        PORTAMENTO_CONTROL: 0x54,
        E1_REVERB_DEPTH: 0x5b,
        E2_TREMOLO_DEPTH: 0x5c,
        E3_CHORUS_DEPTH: 0x5d,
        E4_DETUNE_DEPTH: 0x5e,
        E5_PHASER_DEPTH: 0x5f,
        DATA_INCREMENT: 0x60,
        DATA_DECREMENT: 0x61,
        NONREG_PARM_NUM_LSB: 0x62,
        NONREG_PARM_NUM_MSB: 0x63,
        REGIST_PARM_NUM_LSB: 0x64,
        REGIST_PARM_NUM_MSB: 0x65,
        ALL_SOUNDS_OFF: 0x78,
        RESET_CONTROLLERS: 0x79,
        LOCAL_CONTROL_SWITCH: 0x7a,
        ALL_NOTES_OFF: 0x7b,
        OMNI_OFF: 0x7c,
        OMNI_ON: 0x7d,
        MONO1: 0x7e,
        MONO2: 0x7f,
    };

    function toCharCodes(str) {
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
            bytes.push(str.charCodeAt(i));
        }
        return bytes;
    }

    /** @class */ ((function () {
        function Buffer() {
            this.data = [];
            this.position = 0;
        }
        Object.defineProperty(Buffer.prototype, "length", {
            get: function () {
                return this.data.length;
            },
            enumerable: false,
            configurable: true
        });
        Buffer.prototype.writeByte = function (v) {
            this.data.push(v);
            this.position++;
        };
        Buffer.prototype.writeStr = function (str) {
            this.writeBytes(toCharCodes(str));
        };
        Buffer.prototype.writeInt32 = function (v) {
            this.writeByte((v >> 24) & 0xff);
            this.writeByte((v >> 16) & 0xff);
            this.writeByte((v >> 8) & 0xff);
            this.writeByte(v & 0xff);
        };
        Buffer.prototype.writeInt16 = function (v) {
            this.writeByte((v >> 8) & 0xff);
            this.writeByte(v & 0xff);
        };
        Buffer.prototype.writeBytes = function (arr) {
            var _this = this;
            arr.forEach(function (v) { return _this.writeByte(v); });
        };
        Buffer.prototype.writeChunk = function (id, func) {
            this.writeStr(id);
            var chunkBuf = new Buffer();
            func(chunkBuf);
            this.writeInt32(chunkBuf.length);
            this.writeBytes(chunkBuf.data);
        };
        Buffer.prototype.toBytes = function () {
            return new Uint8Array(this.data);
        };
        return Buffer;
    })());

    // https://gist.github.com/fmal/763d9c953c5a5f8b8f9099dbc58da55e
    function insertSorted(arr, item, prop) {
        let low = 0;
        let high = arr.length;
        let mid;
        while (low < high) {
            mid = (low + high) >>> 1; // like (num / 2) but faster
            if (arr[mid][prop] < item[prop]) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        arr.splice(low, 0, item);
    }

    class SynthEventHandler {
        processor;
        scheduledEvents = [];
        currentEvents = [];
        rpnEvents = {};
        bankSelectMSB = {};
        constructor(processor) {
            this.processor = processor;
        }
        get currentFrame() {
            return this.processor.currentFrame;
        }
        addEvent(e) {
            logger.log(e);
            if ("delayTime" in e) {
                // handle in process
                insertSorted(this.scheduledEvents, {
                    ...e,
                    scheduledFrame: this.currentFrame + e.delayTime,
                }, "scheduledFrame");
            }
            else {
                this.handleImmediateEvent(e);
            }
        }
        processScheduledEvents() {
            if (this.scheduledEvents.length === 0) {
                return;
            }
            while (true) {
                const e = this.scheduledEvents[0];
                if (e === undefined || e.scheduledFrame > this.currentFrame) {
                    // scheduledEvents are sorted by scheduledFrame,
                    // so we can break early instead of iterating through all scheduledEvents,
                    break;
                }
                this.scheduledEvents.shift();
                this.currentEvents.push(e);
            }
            while (true) {
                const e = this.currentEvents.pop();
                if (e === undefined) {
                    break;
                }
                this.handleDelayableEvent(e.midi);
            }
        }
        handleImmediateEvent(e) {
            switch (e.type) {
                case "loadSample":
                    this.processor.loadSample(e.sample, e.bank, e.instrument, e.keyRange, e.velRange);
                    break;
            }
        }
        handleDelayableEvent(e) {
            logger.log("handle delayable event", e);
            switch (e.type) {
                case "channel": {
                    switch (e.subtype) {
                        case "noteOn":
                            this.processor.noteOn(e.channel, e.noteNumber, e.velocity);
                            break;
                        case "noteOff":
                            this.processor.noteOff(e.channel, e.noteNumber);
                            break;
                        case "pitchBend":
                            this.processor.pitchBend(e.channel, e.value);
                            break;
                        case "programChange":
                            this.processor.programChange(e.channel, e.value);
                            break;
                        case "controller": {
                            switch (e.controllerType) {
                                case MIDIControlEvents.NONREG_PARM_NUM_MSB:
                                case MIDIControlEvents.NONREG_PARM_NUM_LSB: // NRPN LSB
                                    // Delete the rpn for do not send NRPN data events
                                    delete this.rpnEvents[e.channel];
                                    break;
                                case MIDIControlEvents.REGIST_PARM_NUM_MSB: {
                                    if (e.value === 127) {
                                        delete this.rpnEvents[e.channel];
                                    }
                                    else {
                                        this.rpnEvents[e.channel] = {
                                            ...this.rpnEvents[e.channel],
                                            rpnMSB: e,
                                        };
                                    }
                                    break;
                                }
                                case MIDIControlEvents.REGIST_PARM_NUM_LSB: {
                                    if (e.value === 127) {
                                        delete this.rpnEvents[e.channel];
                                    }
                                    else {
                                        this.rpnEvents[e.channel] = {
                                            ...this.rpnEvents[e.channel],
                                            rpnLSB: e,
                                        };
                                    }
                                    break;
                                }
                                case MIDIControlEvents.MSB_DATA_ENTRY: {
                                    const rpn = {
                                        ...this.rpnEvents[e.channel],
                                        dataMSB: e,
                                    };
                                    this.rpnEvents[e.channel] = rpn;
                                    // In case of pitch bend sensitivity,
                                    // send without waiting for Data LSB event
                                    if (rpn.rpnLSB?.value === 0) {
                                        this.processor.setPitchBendSensitivity(e.channel, rpn.dataMSB.value);
                                    }
                                    break;
                                }
                                case MIDIControlEvents.LSB_DATA_ENTRY: {
                                    this.rpnEvents[e.channel] = {
                                        ...this.rpnEvents[e.channel],
                                        dataLSB: e,
                                    };
                                    // TODO: Send other RPN events
                                    break;
                                }
                                case MIDIControlEvents.MSB_MAIN_VOLUME:
                                    this.processor.setMainVolume(e.channel, e.value);
                                    break;
                                case MIDIControlEvents.MSB_EXPRESSION:
                                    this.processor.expression(e.channel, e.value);
                                    break;
                                case MIDIControlEvents.ALL_SOUNDS_OFF:
                                    this.removeScheduledEvents(e.channel);
                                    this.processor.allSoundsOff(e.channel);
                                    break;
                                case MIDIControlEvents.ALL_NOTES_OFF:
                                    this.processor.allNotesOff(e.channel);
                                    break;
                                case MIDIControlEvents.SUSTAIN:
                                    this.processor.hold(e.channel, e.value);
                                    break;
                                case MIDIControlEvents.MSB_PAN:
                                    this.processor.setPan(e.channel, e.value);
                                    break;
                                case MIDIControlEvents.MSB_MODWHEEL:
                                    this.processor.modulation(e.channel, e.value);
                                    break;
                                case MIDIControlEvents.MSB_BANK:
                                    this.bankSelectMSB[e.channel] = e.value;
                                    break;
                                case MIDIControlEvents.LSB_BANK: {
                                    const msb = this.bankSelectMSB[e.channel];
                                    if (msb !== undefined) {
                                        const bank = (msb << 7) + e.value;
                                        this.processor.bankSelect(e.channel, bank);
                                    }
                                    break;
                                }
                                case MIDIControlEvents.RESET_CONTROLLERS:
                                    this.processor.resetChannel(e.channel);
                                    break;
                            }
                            break;
                        }
                    }
                    break;
                }
            }
        }
        removeScheduledEvents(channel) {
            this.scheduledEvents = this.scheduledEvents.filter((e) => e.midi.channel !== channel);
            this.currentEvents = this.currentEvents.filter((e) => e.midi.channel !== channel);
        }
    }

    var EnvelopePhase;
    (function (EnvelopePhase) {
        EnvelopePhase[EnvelopePhase["attack"] = 0] = "attack";
        EnvelopePhase[EnvelopePhase["decay"] = 1] = "decay";
        EnvelopePhase[EnvelopePhase["sustain"] = 2] = "sustain";
        EnvelopePhase[EnvelopePhase["release"] = 3] = "release";
        EnvelopePhase[EnvelopePhase["forceStop"] = 4] = "forceStop";
        EnvelopePhase[EnvelopePhase["stopped"] = 5] = "stopped";
    })(EnvelopePhase || (EnvelopePhase = {}));
    const forceStopReleaseTime = 0.1;
    class AmplitudeEnvelope {
        parameter;
        phase = EnvelopePhase.attack;
        lastAmplitude = 0;
        sampleRate;
        constructor(parameter, sampleRate) {
            this.parameter = parameter;
            this.sampleRate = sampleRate;
        }
        noteOn() {
            this.phase = EnvelopePhase.attack;
        }
        noteOff() {
            if (this.phase !== EnvelopePhase.forceStop) {
                this.phase = EnvelopePhase.release;
            }
        }
        // Rapidly decrease the volume. This method ignores release time parameter
        forceStop() {
            this.phase = EnvelopePhase.forceStop;
        }
        getAmplitude(bufferSize) {
            const { attackTime, decayTime, sustainLevel, releaseTime } = this.parameter;
            const { sampleRate } = this;
            // Attack
            switch (this.phase) {
                case EnvelopePhase.attack: {
                    const amplificationPerFrame = (1 / (attackTime * sampleRate)) * bufferSize;
                    const value = this.lastAmplitude + amplificationPerFrame;
                    if (value >= 1) {
                        this.phase = EnvelopePhase.decay;
                        this.lastAmplitude = 1;
                        return 1;
                    }
                    this.lastAmplitude = value;
                    return value;
                }
                case EnvelopePhase.decay: {
                    const attenuationPerFrame = (1 / (decayTime * sampleRate)) * bufferSize;
                    const value = this.lastAmplitude - attenuationPerFrame;
                    if (value <= sustainLevel) {
                        if (sustainLevel <= 0) {
                            this.phase = EnvelopePhase.stopped;
                            this.lastAmplitude = 0;
                            return 0;
                        }
                        else {
                            this.phase = EnvelopePhase.sustain;
                            this.lastAmplitude = sustainLevel;
                            return sustainLevel;
                        }
                    }
                    this.lastAmplitude = value;
                    return value;
                }
                case EnvelopePhase.sustain: {
                    return sustainLevel;
                }
                case EnvelopePhase.release: {
                    const attenuationPerFrame = (1 / (releaseTime * sampleRate)) * bufferSize;
                    const value = this.lastAmplitude - attenuationPerFrame;
                    if (value <= 0) {
                        this.phase = EnvelopePhase.stopped;
                        this.lastAmplitude = 0;
                        return 0;
                    }
                    this.lastAmplitude = value;
                    return value;
                }
                case EnvelopePhase.forceStop: {
                    const attenuationPerFrame = (1 / (forceStopReleaseTime * sampleRate)) * bufferSize;
                    const value = this.lastAmplitude - attenuationPerFrame;
                    if (value <= 0) {
                        this.phase = EnvelopePhase.stopped;
                        this.lastAmplitude = 0;
                        return 0;
                    }
                    this.lastAmplitude = value;
                    return value;
                }
                case EnvelopePhase.stopped: {
                    return 0;
                }
            }
        }
        get isPlaying() {
            return this.phase !== EnvelopePhase.stopped;
        }
    }

    class LFO {
        // Hz
        frequency = 5;
        phase = 0;
        sampleRate;
        constructor(sampleRate) {
            this.sampleRate = sampleRate;
        }
        getValue(bufferSize) {
            const phase = this.phase;
            this.phase +=
                ((Math.PI * 2 * this.frequency) / this.sampleRate) * bufferSize;
            return Math.sin(phase);
        }
    }

    class WavetableOscillator {
        sample;
        sampleIndex = 0;
        _isPlaying = false;
        _isNoteOff = false;
        baseSpeed = 1;
        envelope;
        pitchLFO;
        sampleRate;
        speed = 1;
        // 0 to 1
        velocity = 1;
        // 0 to 1
        volume = 1;
        modulation = 0;
        // cent
        modulationDepthRange = 50;
        // -1 to 1
        pan = 0;
        // This oscillator should be note off when hold pedal off
        isHold = false;
        constructor(sample, sampleRate) {
            this.sample = sample;
            this.sampleRate = sampleRate;
            this.envelope = new AmplitudeEnvelope(sample.amplitudeEnvelope, sampleRate);
            this.pitchLFO = new LFO(sampleRate);
        }
        noteOn(pitch, velocity) {
            this.velocity = velocity;
            this._isPlaying = true;
            this.sampleIndex = this.sample.sampleStart;
            this.baseSpeed = Math.pow(2, ((pitch - this.sample.pitch) / 12) * this.sample.scaleTuning);
            this.pitchLFO.frequency = 5;
            this.envelope.noteOn();
        }
        noteOff() {
            this.envelope.noteOff();
            this._isNoteOff = true;
        }
        forceStop() {
            this.envelope.forceStop();
        }
        process(outputs) {
            if (!this._isPlaying) {
                return;
            }
            const speed = (this.baseSpeed * this.speed * this.sample.sampleRate) / this.sampleRate;
            const volume = this.velocity * this.volume * this.sample.volume;
            // zero to pi/2
            const panTheta = ((Math.min(1, Math.max(-1, this.pan + this.sample.pan)) + 1) * Math.PI) /
                4;
            const leftPanVolume = Math.cos(panTheta);
            const rightPanVolume = Math.sin(panTheta);
            const gain = this.envelope.getAmplitude(outputs[0].length);
            const leftGain = gain * volume * leftPanVolume;
            const rightGain = gain * volume * rightPanVolume;
            const pitchLFOValue = this.pitchLFO.getValue(outputs[0].length);
            const pitchModulation = pitchLFOValue * this.modulation * (this.modulationDepthRange / 1200);
            const modulatedSpeed = speed * (1 + pitchModulation);
            for (let i = 0; i < outputs[0].length; ++i) {
                const index = Math.floor(this.sampleIndex);
                const advancedIndex = this.sampleIndex + modulatedSpeed;
                let loopIndex = null;
                if (this.sample.loop !== null && advancedIndex >= this.sample.loop.end) {
                    loopIndex =
                        this.sample.loop.start + (advancedIndex - Math.floor(advancedIndex));
                }
                const nextIndex = loopIndex !== null
                    ? Math.floor(loopIndex)
                    : Math.min(index + 1, this.sample.sampleEnd - 1);
                // linear interpolation
                const current = this.sample.buffer[index];
                const next = this.sample.buffer[nextIndex];
                const level = current + (next - current) * (this.sampleIndex - index);
                outputs[0][i] += level * leftGain;
                outputs[1][i] += level * rightGain;
                this.sampleIndex = loopIndex ?? advancedIndex;
                if (this.sampleIndex >= this.sample.sampleEnd) {
                    this._isPlaying = false;
                    break;
                }
            }
        }
        get isPlaying() {
            return this._isPlaying && this.envelope.isPlaying;
        }
        get isNoteOff() {
            return this._isNoteOff;
        }
        get exclusiveClass() {
            return this.sample.exclusiveClass;
        }
    }

    const initialChannelState = () => ({
        volume: 1,
        bank: 0,
        instrument: 0,
        pitchBend: 0,
        pitchBendSensitivity: 2,
        oscillators: {},
        expression: 1,
        pan: 0,
        modulation: 0,
        hold: false,
    });
    const RHYTHM_CHANNEL = 9;
    const RHYTHM_BANK = 128;
    class SynthProcessorCore {
        sampleTable = new SampleTable();
        channels = {};
        eventHandler;
        sampleRate;
        getCurrentFrame;
        constructor(sampleRate, getCurrentFrame) {
            this.eventHandler = new SynthEventHandler(this);
            this.sampleRate = sampleRate;
            this.getCurrentFrame = getCurrentFrame;
        }
        get currentFrame() {
            return this.getCurrentFrame();
        }
        getSamples(channel, pitch, velocity) {
            const state = this.getChannelState(channel);
            // Play drums for CH.10
            const bank = channel === RHYTHM_CHANNEL ? RHYTHM_BANK : state.bank;
            return this.sampleTable.getSamples(bank, state.instrument, pitch, velocity);
        }
        loadSample(sample, bank, instrument, keyRange, velRange) {
            const _sample = {
                ...sample,
                buffer: new Float32Array(sample.buffer),
            };
            this.sampleTable.addSample(_sample, bank, instrument, keyRange, velRange);
        }
        addEvent(e) {
            this.eventHandler.addEvent(e);
        }
        noteOn(channel, pitch, velocity) {
            const state = this.getChannelState(channel);
            const samples = this.getSamples(channel, pitch, velocity);
            if (samples.length === 0) {
                logger.warn(`There is no sample for noteNumber ${pitch} in instrument ${state.instrument} in bank ${state.bank}`);
                return;
            }
            for (const sample of samples) {
                const oscillator = new WavetableOscillator(sample, this.sampleRate);
                const volume = velocity / 0x80;
                oscillator.noteOn(pitch, volume);
                if (state.oscillators[pitch] === undefined) {
                    state.oscillators[pitch] = [];
                }
                if (sample.exclusiveClass !== undefined) {
                    for (const key in state.oscillators) {
                        for (const osc of state.oscillators[key]) {
                            if (osc.exclusiveClass === sample.exclusiveClass) {
                                osc.forceStop();
                            }
                        }
                    }
                }
                state.oscillators[pitch].push(oscillator);
            }
        }
        noteOff(channel, pitch) {
            const state = this.getChannelState(channel);
            if (state.oscillators[pitch] === undefined) {
                return;
            }
            for (const osc of state.oscillators[pitch]) {
                if (!osc.isNoteOff) {
                    if (state.hold) {
                        osc.isHold = true;
                    }
                    else {
                        osc.noteOff();
                    }
                }
            }
        }
        pitchBend(channel, value) {
            const state = this.getChannelState(channel);
            state.pitchBend = (value / 0x2000 - 1) * state.pitchBendSensitivity;
        }
        programChange(channel, value) {
            const state = this.getChannelState(channel);
            state.instrument = value;
        }
        setPitchBendSensitivity(channel, value) {
            const state = this.getChannelState(channel);
            state.pitchBendSensitivity = value;
        }
        setMainVolume(channel, value) {
            const state = this.getChannelState(channel);
            state.volume = value / 0x80;
        }
        expression(channel, value) {
            const state = this.getChannelState(channel);
            state.expression = value / 0x80;
        }
        allSoundsOff(channel) {
            const state = this.getChannelState(channel);
            for (const key in state.oscillators) {
                for (const osc of state.oscillators[key]) {
                    osc.forceStop();
                }
            }
        }
        allNotesOff(channel) {
            const state = this.getChannelState(channel);
            for (const key in state.oscillators) {
                for (const osc of state.oscillators[key]) {
                    osc.noteOff();
                }
            }
        }
        hold(channel, value) {
            const hold = value >= 64;
            const state = this.getChannelState(channel);
            state.hold = hold;
            if (hold) {
                return;
            }
            for (const key in state.oscillators) {
                for (const osc of state.oscillators[key]) {
                    if (osc.isHold) {
                        osc.noteOff();
                    }
                }
            }
        }
        setPan(channel, value) {
            const state = this.getChannelState(channel);
            state.pan = (value / 127 - 0.5) * 2;
        }
        bankSelect(channel, value) {
            const state = this.getChannelState(channel);
            state.bank = value;
        }
        modulation(channel, value) {
            const state = this.getChannelState(channel);
            state.modulation = value / 0x80;
        }
        resetChannel(channel) {
            delete this.channels[channel];
        }
        getChannelState(channel) {
            const state = this.channels[channel];
            if (state !== undefined) {
                return state;
            }
            const newState = initialChannelState();
            this.channels[channel] = newState;
            return newState;
        }
        process(outputs) {
            this.eventHandler.processScheduledEvents();
            for (const channel in this.channels) {
                const state = this.channels[channel];
                for (let key in state.oscillators) {
                    state.oscillators[key] = state.oscillators[key].filter((oscillator) => {
                        oscillator.speed = Math.pow(2, state.pitchBend / 12);
                        oscillator.volume = state.volume * state.expression;
                        oscillator.pan = state.pan;
                        oscillator.modulation = state.modulation;
                        oscillator.process([outputs[0], outputs[1]]);
                        if (!oscillator.isPlaying) {
                            return false;
                        }
                        return true;
                    });
                }
            }
            // master volume
            const masterVolume = 0.3;
            for (let i = 0; i < outputs[0].length; ++i) {
                outputs[0][i] *= masterVolume;
                outputs[1][i] *= masterVolume;
            }
        }
    }

    class SynthProcessor extends AudioWorkletProcessor {
        synth = new SynthProcessorCore(sampleRate, () => currentFrame);
        constructor() {
            super();
            this.port.onmessage = (e) => {
                this.synth.addEvent(e.data);
            };
        }
        process(_inputs, outputs) {
            this.synth.process(outputs[0]);
            return true;
        }
    }

    registerProcessor("synth-processor", SynthProcessor);

})();
//# sourceMappingURL=processor.js.map
