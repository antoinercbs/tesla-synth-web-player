import string
import json
import argparse
import struct
from pathlib import Path
import time
try:
    import serial
    serialAvailable = True
except:
    serialAvailable = False
if (serialAvailable):
    from serial.tools.list_ports import comports
try:
    import rtmidi
    midiAvailable = True
except:
    midiAvailable = False


scriptDir = Path(__file__).parent
with open(scriptDir / "Sysex-Name-Number-Mapping.json") as f:
    names2num = json.load(f)
for k,v in names2num.items():
    if type(v) == str:
        if "x" in v:
            names2num[k] = int(v, 16)
        else:
            names2num[k] = int(v)
with open(scriptDir / "Sysex-Properties-Mapping.json") as f:
    m = json.load(f)
mapping = dict()
for k, v in m.items():
    if type(k) == str:
        if "x" in k:
            k = int(k, 16)
        else:
            k = int(k)
    mapping[k] = v

def findInt(num:str):
    try:
        n = int(num)
    except:
        try:
            n = int(num, 2)
        except:
            try:
                n = int(num, 16)
            except:
                return None
    return n

def bytes2sysexDict(b:bytes, expectFloat=False):
    sysex = {"number": 0, "targetMSB": 0, "targetLSB": 0, "value": 0, "deviceID": 0, "protocolVer": 0, "valid": False}
    if len(b) != 16 or b[0] != 0xf0 or b[-1] != 0xf7:
        sysex["valid"] = False
    else:
        sysex["protocolVer"] = b[4]
        sysex["deviceID"]    = b[5]
        sysex["number"]      = (b[7] << 8) + b[6]
        sysex["targetLSB"]   = b[8]
        sysex["targetMSB"]   = b[9]
        for i in range(5):
            sysex["value"]  += b[10 + i] << (7 * i)

        if sysex["number"] & 0x2000 or expectFloat:
            sysex["value"] = struct.unpack("<f", struct.pack("<I", sysex["value"]))[0]
        sysex["valid"] = True
    return sysex

def invertDict(d:dict):
    revDict = dict()
    for k,v in d.items():
        # Only use first occurences
        if v not in revDict:
            revDict[v] = k
    return revDict

def sysexDict2str(d:dict):
    readCommands = {v:k for k,v in {"check": 0x02, "read": 0x03, "get": 0x04}.items()}
    targets = {127: "all"}
    targets.update({k:str(k) for k in range(127)})
    if not "origin" in d:
        # "origin" is used for replies. it encodes the type of read command that
        # caused this reply. If no origin is given, it defaults to 0.
        d["origin"] = 0x00
    targetPrefix = "for"
    cmdNames = invertDict(names2num)
    s = []
    cmdType = "normal"
    cmdNum = d["number"]
    if cmdNum in readCommands:
        cmdType = "read"
        s.append(readCommands[cmdNum])
        cmdNum = d["value"]
        targetPrefix = "of"
    elif cmdNum == 0x01: # reply
        if d["origin"] == 0x02:#"check"
            cmdType = "check_reply"
            s.append("confirming support of")
            targetPrefix = "for"
            # In this case the reply value encodes the PN that's supported.
            cmdNum = d["value"]
            if cmdNum in cmdNames:
                s.append(cmdNames[cmdNum])
            else:
                s.append(str(cmdNum))
        else:
            cmdType = "reply"
            s.append("input")
            targetPrefix = "from"
    else:
        s.append("set")
        targetPrefix = "for"

    isFloat = False
    if cmdNum & 0x2000:
        cmdNum &= ~0x2000
        isFloat = True

    if "reply" not in cmdType:
        if cmdNum in cmdNames:
            s.append(cmdNames[cmdNum])
        else:
            s.append(str(cmdNum))

    s.append(targetPrefix)
    s.append("device")
    s.append(targets[d["deviceID"]])
    s.append("and")
    if cmdType != "reply" and cmdNum in mapping:
        s.append(mapping[cmdNum]["targetMSB-name"])
        msbDict = invertDict(mapping[cmdNum]["targetMSB"])
        if d["targetMSB"] in msbDict:
            s.append(msbDict[d["targetMSB"]])
        else:
            s.append(targets[d["targetMSB"]])
        s.append("and")
        s.append(mapping[cmdNum]["targetLSB-name"])
        lsbDict = invertDict(mapping[cmdNum]["targetLSB"])
        if d["targetLSB"] in lsbDict:
            s.append(lsbDict[d["targetLSB"]])
        else:
            s.append(targets[d["targetLSB"]])
    else:
        s.append("targetMSB")
        s.append(targets[d["targetMSB"]])
        s.append("and")
        s.append("targetLSB")
        s.append(targets[d["targetLSB"]])

    if cmdType == "reply":
        s.append("is")
    elif cmdType != "check_reply":
        s.append("to")

    if cmdType not in ("read", "check_reply"):
        if isFloat:
            s.append(str(struct.unpack("<f", struct.pack("<I", d["value"]))))
        else:
            valDict = dict()
            if cmdNum in mapping:
                valDict = invertDict(mapping[cmdNum]["value"])
            if d["value"] in valDict:
                s.append(valDict[d["value"]])
            else:
                s.append(str(d["value"]))

    return " ".join(s)


def sysexBytes(number, targetMSB, targetLSB, value, deviceID=127, protocolVer=1, **kwargs):
    start = bytes([0xf0, 0x00, 0x26, 0x05, protocolVer, deviceID])
    for i in range(2):
        start += bytes([number & 0x7f])
        number >>= 8
    start += bytes([targetLSB, targetMSB])
    for i in range(5):
        start += bytes([value & 0x7f])
        value >>= 7
    start += bytes([0xf7])
    return start

def str2sysexDict(s:str):
    sysex = {"number": 0, "targetMSB": 0, "targetLSB": 0, "value": 0, "deviceID": 127, "reading": 0}
    readCommands = {"check": 0x02, "read": 0x03, "get": 0x04}
    s = s.split(" ")
    sl = [strng.lower() for strng in s]
    readOnly = False
    valStart = len(sl)
    if "to" not in sl:
        readOnly = True
    else:
        valStart = sl.index("to")
        sysexVal = " ".join(s[valStart + 1:])
    s = [strng for strng in sl[:valStart] if strng]
    if not s:
        return -1
    if readOnly:
        if s[0] in readCommands:
            readOnly = readCommands[s[0]]
            sysex["reading"] = readOnly
        else:
            return -1
    elif s[0] != "set":
        return -1
    explicitNum = False
    num = findInt(s[1])
    if num is None:
        if s[1] in names2num:
            num = names2num[s[1]]
        else:
            return -1
    else:
        explicitNum = True
    sysex["number"] = num
    targets = []
    if len(s) > 4 and s[2] in ("of", "for"):
        targets.append({"name": s[3], "val": s[4], "type": "None"})
        if len(s) > 7 and s[5] in "and":
            targets.append({"name": s[6], "val": s[7], "type": "None"})
            if len(s) > 10 and s[8] == "and":
                targets.append({"name": s[9], "val": s[10], "type": "None"})
        for t in targets:
            t["val"] = t["val"].replace("all", "127")
            if t["name"] == "device":
                n = findInt(s[1])
                if n is None:
                    return -1
                sysex["deviceID"] = n
                continue
            elif t["name"] == mapping[num & 0xffff]["targetMSB-name"]: #0xffff: for range commands use lower bound for lookup
                t["type"] = "targetMSB"
            elif t["name"] == mapping[num & 0xffff]["targetLSB-name"]:
                t["type"] = "targetLSB"
            else:
                return -1
            n = findInt(t["val"])
            if n is None:
                if t["val"] in mapping[num & 0xffff][t["type"]]:
                    n = mapping[num & 0xffff][t["type"]][t["val"]]
                else:
                    return -1
            t["val"] = n
            sysex[t["type"]] = t["val"]

    if readOnly:
        # Use float as default if available. Do this only if the sysex number (and thus float/nofloat)
        # has not been explicitly specified (e.g. "ontime" leads to a float (0x2021) response
        # but "0x21" remains "0x21".
        if not explicitNum:
            if num in mapping:
                if mapping[num]["type"] == "float":
                    num |= 0x2000

        # When reading, what has been processed above as sysex number actually
        # belongs to the value (while the number indicates the type of read command).
        sysex["value"] = num
        sysex["number"] = readOnly
    else:
        if mapping[num]["type"] == "str":
            sysexVal = sysexVal[:4].encode("iso-8859-1")
            sysex["value"] = 0
            for i,e in enumerate(sysexVal):
                sysex["value"] += e << (8 * i)
        else:
            sysexVal = sysexVal.replace(" ", "")
            n = findInt(sysexVal)
            if n is None:
                try:
                    # Convert float object to 32bit IEEE754 float, then store these bytes in an int
                    # such that it can be later processed and packed by sysexBytes (packed into 7bit chunks).
                    n = struct.unpack("<I", struct.pack("<f", float(sysexVal)))[0]
                    # if it's not a float we're already in th except section and the following won't be executed
                    sysex["number"] |= 0x2000
                except:
                    if sysexVal in mapping[num]["value"]:
                        n = mapping[num]["value"][sysexVal]
                    else:
                        return -1
            sysex["value"] = n
    return sysex

def hexStr(b:bytes):
    return " ".join(["{:02x}".format(c) for c in b])

def sysex2fileOrConsole(data:bytes, mode:str, file=None, dir="Out", index=0, cmdOrigin=0, expectFloat=False):
    data = bytes(data) # incoming data could also be a list (f.ex. when it comes from the midirt library)
    dataDict = bytes2sysexDict(data, expectFloat)
    dataDict["origin"] = cmdOrigin
    if not dataDict["valid"] or dataDict["protocolVer"] != 1:
        return
    fileOut = ""
    if mode == "HEX":
        data = hexStr(data)
        if file:
            data += "\n"
            fileOut = "a"
    elif mode == "VAL":
        data = str(dataDict["value"])
        if file:
            data += "\n"
            fileOut = "a"
    elif mode == "PAR":
        data = sysexDict2str(dataDict)
        if file:
            data += "\n"
            fileOut = "a"
    elif mode == "BIN" or mode == "SYX":
        if file:
            fileOut = "ab"
    else:
        print("Unknown mode: {}. I won't be happy about this bug report because it means I goofed up...".format(mode))
        exit()

    if fileOut:
        with open(file, fileOut) as f:
            f.write(data)
    else:
        prefix = dir
        prefix += " " * (3 - len(dir))
        if index:
            prefix += "[{:03}]".format(index)
        prefix += ":"
        print(prefix, data)


if __name__ == "__main__":
    desc = """Sysex-Tool for Syntherrupter
              Convert human readable commands into MIDI Sysex commands and send them to a serial port. 
              Developped by Max Zuidberg, licensed under MPL-2.0"""
    parser = argparse.ArgumentParser(description=desc)
    parser.add_argument("-i", "--input", type=str, required=False, default="",
                        help="Command as string or path to text file.")
    parser.add_argument("-m", "--mode", type=str, required=False, default="",
                        help="Select what output is generated. Can be SER/SERIAL, MID/MIDI, HEX or BIN (case insensitive). "
                             "For SERIAL and MIDI a port must be specified using -p/--port. "
                             "For HEX an output file can be specified using -o/--output. "
                             "For BIN an output file must be specified using -o/--output.")
    parser.add_argument("-r", "--receive", required=False, default="",
                        help="Select how to treat return data. Can be HEX, VAL/VALUE, PAR/PARSED, SYX/BIN "
                             "(case insensitive). "
                             "For HEX, VAL/VALUE and PAR/PARSED an output file can be specified using -o/--output. "
                             "For SYX/BIN an output file must be specified using -o/--output.D")
    parser.add_argument("-o", "--output", required=False, default="",
                        help="Output file for hex, binary or return data.")
    parser.add_argument("-p", "--port-out", "--port", required=False,
                        help="Serial or MIDI port to send commands to. Example (Windows): \"COM3\". If an integer is "
                             "given, it'll be used as index in the list of available ports (see -l/--list).")
    parser.add_argument("-q", "--port-in", required=False,
                        help="Serial or MIDI port to read incoming (return) data from. If not specified, the same port "
                             "is used for incoming and outgoing data. Note: when using MIDI ports you need to "
                             "explicitly specify the input port - even if it's the same as the output port. If you're "
                             "using loopMIDI, you MUST create separate loopMIDI ports. Otherwise you'll get every "
                             "outgoing message echoed back. Also note that you cannot mix serial and midi ports. ")
    parser.add_argument("-b", "--baudrate", required=False, type=int, default=115200,
                        help="Select baudrate for serial commands. Default is 115200baud/s.")
    parser.add_argument("-w", "--watch", required=False, type=float, default=0,
                        help="Specify an interval in seconds for repeating the read commands. This allows you to "
                             "monitor certain values. Can be a float (f.ex. 0.1). Set commands will only be sent once.")
    parser.add_argument("-l", "--list", required=False, action="store_true",
                        help="List all available serial and MIDI ports.")
    parser.add_argument("--log-no-out", required=False, action="store_true",
                        help="Use this flag to disable logging of the outgoing hex data. Mainly useful when using "
                             "-w/--watch")
    parser.add_argument("--log-no-index", required=False, action="store_true",
                        help="Use this flag to disable the index number on all console messages. The index is the "
                             "number of the command. 1=first, 2=second, etc. This way you can quickly associate the "
                             "log info with the respective command from your input file. ")

    args = parser.parse_args()

    serialPorts  = []
    midiOutPorts = []
    if serialAvailable:
        serialPorts = [p.name for p in comports()]
    if midiAvailable:
        midiOut = rtmidi.MidiOut()
        midiOutPorts = midiOut.get_ports()
        midiIn = rtmidi.MidiIn()
        midiInPorts = midiIn.get_ports()

    if args.list:
        if serialAvailable:
            print("List of available serial ports:")
            for i, p in enumerate(serialPorts):
                print("{:3}: \"{}\"".format(i, p))
        else:
            print("To list or use serial ports you need to install the pyserial package: "
                  "https://pypi.org/project/pyserial/")
        if midiAvailable:
            print("List of available MIDI Out ports:")
            for i, p in enumerate(midiOutPorts):
                print("{:3}: \"{}\"".format(i, p))
            print("List of available MIDI In ports:")
            for i, p in enumerate(midiInPorts):
                print("{:3}: \"{}\"".format(i, p))
        else:
            print("To list or use MIDI ports you need to install the python-rtmidi package: "
                  "https://pypi.org/project/python-rtmidi/")
        exit()

    if not args.mode:
        parser.error("-m/--mode is required.")
    if not args.input:
        parser.error("-i/--input is required.")

    args.mode = args.mode[:3].upper()
    if args.mode not in ["SER", "HEX", "BIN", "MID"]:
        parser.error("Invalid mode. Must be SER/SERIAL, MID/MIDI, HEX or BIN (case insensitive).")

    args.receive = args.receive[:3].upper()
    if args.receive and args.mode not in ("SER", "MID"):
        parser.error("Invalid mode. To receive data you must select SER/SERIAL or MID/MIDI (case insensitive).")
    if args.receive not in ["", "HEX", "PAR", "VAL", "BIN", "SYX"]:
        parser.error("Invalid receive mode. Must be HEX, PAR/PARSED, VAL/VALUE or BIN/SYX (case insensitive).")
    if args.receive and args.mode == "MID" and not args.port_in:
        parser.error("Input MIDI port missing. See -h/--help for details about the input port.")

    if args.port_in and not args.receive:
        parser.error("-q/--port-in requires -r/--receive.")
    if args.watch and not args.receive:
        parser.error("-w/--watch requires -r/--receive.")
    if args.watch and args.watch < 0.1:
        parser.error("Watch interval cannot be shorter than 0.1s (100ms)")

    if args.output:
        out = Path(args.output)
        try:
            # make sure the file exists and is blank.
            with open(out, "w") as f:
                pass
        except:
            parser.error("Invalid output file.")
    elif args.mode == "BIN" or args.receive in ("BIN", "SYX"):
        parser.error("Valid output file required.")
    else:
        out = ""

    p = Path(args.input)
    strs = []
    if p.is_file():
        with open(p) as f:
            strs = [cmd.rstrip("\n") for cmd in f.readlines()]
    else:
        strs.append(args.input)

    cmds = []
    validStrs = []
    for i,e in enumerate(strs):
        e = str2sysexDict(e)
        if e == -1:
            print("Ignored invald command: {}".format(strs[i]))
        else:
            validStrs.append(strs[i])
            # append binary form to sysex dict
            e["bin"] = sysexBytes(**e)
            cmds.append(e)

    print("")
    print("Valid commands ({}):".format(len(cmds)))
    for i,e in enumerate(validStrs):
        prefix = "Set"
        if cmds[i]["reading"]:
            prefix = "Req"
        if not args.log_no_index:
            prefix += "[{:03}]".format(i + 1)
        prefix += ":"
        print(prefix, e)
    print("")

    if not len(cmds):
        exit()

    if args.log_no_out:
        print("Incoming Data:")
    else:
        print("Incoming/Outgoing Data: ")
    if args.mode == "SER":
        if not serialAvailable:
            parser.error("To use the serial feature you need to install the pyserial package: "
                         "https://pypi.org/project/pyserial/")
        portOk = (args.port_out in serialPorts)
        if not portOk:
            isInt = True
            try:
                args.port_out = int(args.port_out)
            except:
                isInt = False
            if isInt and args.port_out < len(serialPorts):
                portOk = True
                args.port_out = serialPorts[args.port_out]
        if not portOk:
            parser.error("Specified port \"{}\" not among available ports or index too high. "
                         "{} ports available: {}".format(args.port_out, len(serialPorts),
                                                         ", ".join(["\"" + p + "\"" for p in serialPorts])))
        # Copy paste isn't nice. but it is easy. even though future me will hate it.
        portInOk = (args.port_in in serialPorts)
        if not portInOk:
            isInt = True
            try:
                args.port_in = int(args.port_in)
            except:
                isInt = False
            if isInt and args.port_in < len(serialPorts):
                portInOk = True
                args.port_in = serialPorts[args.port_in]
        if args.port_in and not portInOk:
            parser.error("Specified port \"{}\" not among available ports or index too high. "
                         "{} ports available: {}".format(args.port_in, len(serialPorts),
                                                         ", ".join(["\"" + p + "\"" for p in serialPorts])))
        serOut = serial.Serial()
        serOut.baudrate = args.baudrate
        serOut.port = args.port_out
        serOut.open()
        serIn = serial.Serial()
        if portInOk:
            serIn.baudrate = args.baudrate
            serIn.port = args.port_in
            serIn.open()
        else:
            serIn = serOut
        txCounter = 0
        looping = False
        if args.watch > 0:
            looping = True
        else:
            # loop time needs to be >0 nonetheless
            args.watch = 1
        try:
            # do-while loop; break condition is at the bottom of the loop.
            while True:
                loopTime = time.time()
                for i,e in enumerate(cmds):
                    # (for watch mode) set commands (a.k.a. non-read commands) are deleted after they've been sent.
                    # Thus, skip any empty "leftovers". They're not removed to keep the log_index working.
                    if not e:
                        continue
                    # log index
                    log_index = i + 1
                    if args.log_no_index:
                        log_index = 0
                    if not e["reading"]:
                        # this does not affect e which will be used in this iteration.
                        cmds[i] = None
                        sysex2fileOrConsole(e["bin"], "HEX", None, "Out", log_index)
                    serOut.write(e["bin"])
                    txCounter += 1
                    while serOut.out_waiting:
                        pass
                    # Let Syntherrupter process the data
                    time.sleep(0.04)
                    # read incoming data if there is any
                    if portInOk:
                        timeout = 0.04
                        start = time.time()
                        while time.time() - start < timeout:
                            if serIn.in_waiting < 16:
                                continue
                            data = serIn.read(16)
                            expectFloat = e["number"] & 0x2000
                            if e["reading"]:
                                expectFloat = e["value"] & 0x2000
                            sysex2fileOrConsole(data, args.receive, args.output, "In", log_index, e["reading"], expectFloat)
                            start = time.time()

                if not looping:
                    # abort after 1 iteration without waiting
                    break
                # Measure how much time is left from the loop interval and sleep during the remaining time.
                # Additionally set a lower limit of 0
                freeTime = max(0, args.watch - (time.time() - loopTime))
                time.sleep(freeTime)
        except KeyboardInterrupt:
            print("\nUser aborted watching by keyboard interrupt.")
        serOut.close()
        serIn.close()
        print("Sent {} command(s) to serial port.".format(txCounter))

    elif args.mode == "MID":
        if not midiAvailable:
            parser.error("To use the MIDI feature you need to install the python-rtmidi package: "
                         "https://pypi.org/project/python-rtmidicd/")
        portOk = (args.port_out in midiOutPorts)
        if portOk:
            args.port_out = midiOutPorts.index(args.port_out)
        else:
            isInt = True
            try:
                args.port_out = int(args.port_out)
            except:
                isInt = False
            if isInt and args.port_out < len(midiOutPorts):
                portOk = True
        if not portOk:
            parser.error("Specified port \"{}\" not among available output ports or index too high. "
                         "{} ports available: {}".format(args.port_out, len(midiOutPorts),
                                                         ", ".join(["\"" + p + "\"" for p in midiOutPorts])))
        portInOk = (args.port_in in midiInPorts)
        if portInOk:
            args.port_in = midiInPorts.index(args.port_in)
        else:
            isInt = True
            try:
                args.port_in = int(args.port_in)
            except:
                isInt = False
            if isInt and args.port_in < len(midiInPorts):
                portInOk = True
        if args.port_in and not portInOk:
            parser.error("Specified port \"{}\" not among available input ports or index too high. "
                         "{} ports available: {}".format(args.port_in, len(midiInPorts),
                                                         ", ".join(["\"" + p + "\"" for p in midiInPorts])))
        midiOut.open_port(args.port_out)
        if portInOk:
            midiIn.open_port(args.port_in)
            midiIn.ignore_types(sysex=False)
        txCounter = 0
        looping = False
        if args.watch > 0:
            looping = True
        else:
            # loop time needs to be >0 nonetheless
            args.watch = 1
        try:
            # do-while loop; break condition is at the bottom of the loop.
            while True:
                loopTime = time.time()
                for i,e in enumerate(cmds):
                    # (for watch mode) process non-read commands only once.
                    if not e:
                        continue
                    # log index
                    log_index = i + 1
                    if args.log_no_index:
                        log_index = 0
                    if not e["reading"]:
                        # this does not affect e which will be used in this iteration.
                        cmds[i] = None
                    if not args.log_no_out:
                        sysex2fileOrConsole(e["bin"], "HEX", None, "Out", log_index)
                    midiOut.send_message(e["bin"])
                    txCounter += 1
                    # Let Syntherrupter process the data
                    time.sleep(0.04)
                    # read incoming data if there is any
                    if portInOk:
                        timeout = 0.04
                        start = time.time()
                        while time.time() - start < timeout:
                            msg = midiIn.get_message()
                            if not msg:
                                continue
                            expectFloat = e["number"] & 0x2000
                            if e["reading"]:
                                expectFloat = e["value"] & 0x2000
                            sysex2fileOrConsole(msg[0], args.receive, args.output, "In", log_index, e["reading"], expectFloat)
                            start = time.time()
                if not looping:
                    # abort after 1 iteration without waiting.
                    break
                # Measure how much time is left from the loop interval and sleep during the remaining time.
                # Additionally set a lower limit of 0
                freeTime = max(0, args.watch - (time.time() - loopTime))
                time.sleep(freeTime)
        except KeyboardInterrupt:
            print("\nUser aborted watching by keyboard interrupt.")
        del midiOut
        del midiIn
        print("Sent {} command(s) to MIDI port.".format(txCounter))

    elif args.mode == "HEX":
        for i,e in enumerate(cmds):
            # log index
            log_index = i + 1
            if args.log_no_index:
                log_index = 0
            if not args.log_no_out:
                sysex2fileOrConsole(e["bin"], "HEX", None, "Out", log_index)
            if (out):
                sysex2fileOrConsole(e["bin"], "HEX", out, "Out", log_index)
        if out:
            print("Wrote {} command(s) as hex to file.".format(len(cmds)))

    elif args.mode == "BIN":
        for i, e in enumerate(cmds):
            # log index
            log_index = i + 1
            if args.log_no_index:
                log_index = 0
            if not args.log_no_out:
                sysex2fileOrConsole(e["bin"], "HEX", None, "Out", log_index)
            if (out):
                sysex2fileOrConsole(e["bin"], "BIN", out, "Out", log_index)
        if out:
            print("Wrote {} command(s) as binary to file.".format(len(cmds)))
