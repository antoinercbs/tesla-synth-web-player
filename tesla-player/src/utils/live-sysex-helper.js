
/*
Syntherrupter sysex format:
    F0 00 [DMID] [DMID] [version] [device ID] [PN LSB] [PN MSB] [TG LSB] [TG MSB] [value LSB] [value] [value] [value] [value MSB] F7
    where [DMID] is the device manufacturer ID (0x7D for Syntherrupter)
    [version] is the firmware version (0x01 for Syntherrupter)
    [device ID] is the device ID (0x7f for all devices)
    [PN] is the parameter number Defines the meaning of the command. Note: unlike the parameter value, the parameter number is not split into 7 bit groups. Meaning, that the next PN after 0x7f is 0x100 (PN = (PN MSB << 8) + PN LSB).
    [TG] Target. Specifies to what the command applies. Taking the example of an ontime command, the target specifies what coil is affected.
    Parameter value. With 5 MIDI data bytes, full 32 bit values can be covered. Any 32bits of data will be sent in groups of 7 bits, LSB first.
*/

sendSysex = (midiOutput, payload) => {
    const strBytes = payload.split(' ');
    const bytes = strBytes.map(str => parseInt(str, 16));
    midiOutput.sendSysex(bytes.slice(1, 4), bytes.slice(4, 15));
};
exports.sendSysex = sendSysex;

exports.sendLiveOntimeAdjustForSong = function (song, ontimeRatio, midiOutput) {
    const coilsUpdatedOntimes = getCoilsParamValuesFromSong(0x21, song, false).map(coilOntime => 
        ({ coil: coilOntime.coil, ontime: Math.round(coilOntime.value * ontimeRatio / 100) })
    );
    for (const coilOntime of coilsUpdatedOntimes) {
        const sysex = generateSysexCommandForCoilAndParam(coilOntime.coil, 0x21, coilOntime.ontime, false);
        console.log(sysex);
        sendSysex(midiOutput, sysex);
    }
};

exports.sendLiveDutyAdjustForSong = function (song, dutyRatio, midiOutput) {
    const coilsUpdatedDuties = getCoilsParamValuesFromSong(0x22, song, true).map(coilDuty =>
        ({ coil: coilDuty.coil, duty: coilDuty.value * dutyRatio / 100 })
    );
    for (const coilDuty of coilsUpdatedDuties) {
        const sysex = generateSysexCommandForCoilAndParam(coilDuty.coil, 0x22, coilDuty.duty, true);
        console.log(sysex);
        sendSysex(midiOutput, sysex);
    }
}

function getCoilsParamValuesFromSong(paramHexId, song, isFloat = false) {
    const coilsParamValues = song.sysex.filter(sysex => sysex.value.startsWith(`f0 00 26 05 01 7f ${paramHexId.toString(16).padStart(2, '0')}`))
        .map(sysex => ( { 
            coil : parseInt(sysex.value.split(' ')[8], 16), 
            value: isFloat ?
                convert5BytesFloatToNumber(sysex.value.split(' ').slice(10, 15))
                : convert5BytesIntToNumber(sysex.value.split(' ').slice(10, 15))
        }));
    return coilsParamValues;
}

function generateSysexCommandForCoilAndParam(coil, paramHexId, ontimeInteger, isFloat = false) {
    const valueBytes = isFloat ? convertNumberTo5BytesFloat(ontimeInteger) : convertNumberTo5BytesInt(ontimeInteger);
    const sysex = [0xf0, 0x00, 0x26, 0x05, 0x01, 0x7f, paramHexId, (isFloat ? 0x20 : 0x00), coil, 0x02, ...valueBytes, 0xf7];
    return sysex.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
}


function convert5BytesIntToNumber(bytes) {
    return  bytes.reduce((acc, byte, index) => {
        const value = parseInt(byte, 16);
        const shift = index * 7;
        return acc + (value << shift);
    }, 0);
}

function convert5BytesFloatToNumber(bytes) {
    const int32Value = convert5BytesIntToNumber(bytes);
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setInt32(0, int32Value);
    return view.getFloat32(0);
}


function convertNumberTo5BytesInt(value) {
    const bytes = [];
    for (let i = 0; i < 5; i++) {
        bytes.push((value >> (i * 7)) & 0x7f);
    }
    return bytes;
}

function convertNumberTo5BytesFloat(value) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, value);
    const int32Value = view.getInt32(0);
    return convertNumberTo5BytesInt(int32Value);
}

