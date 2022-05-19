# Syfoh

Syfoh - **Sy**sex commands **fo**r **h**umans - is a simple Python command line tool which takes a human readable text source and generates Sysex commands as defined by the [Syntherrupter Sysex Standard](https://github.com/MMMZZZZ/Syntherrupter/blob/dev/Documentation/Wiki/Custom%20MIDI%20Commands.md#system-exclusive-messages-sysex).

## Index

* [Overview](#overview)
* [Requirements](#requirements)
* [Setup](#setup)
* [The Human Readable Sysex Format](#the-human-readable-sysex-format)
* [Usage](#usage)
  * [General Examples and Explanations](#general-examples-and-explanations)
  * [Batch Processing Text Files](#batch-processing-text-files)
* [Reading and Monitoring Values](#reading-and-monitoring-values)
  * [Examples](#examples)
    * [Basics](#basics-chosing-ports-writing-read-commands)
    * [Monitoring](#monitoring)
    * [Export settings](#export-settings)

## Overview

In a nutshell, Syfohs input and output look like the following. Readable input, machine output. Therefore you don't need to speak machine language. 

```
Input:  set ontime for mode simple and coil 1 to 100

Output: F0 00 26 05 01 7F 21 00 01 00 64 00 00 00 00 F7
```

Syfoh can batch process text files with multiple commands, process any data that Syntherrupter sends back, and store everything as text files or binary files which you can integrate into your MIDI files if desired. Changing Syntherrupters configuration between different MIDI files boils down to a single click.

## Requirements

* [Python 3](https://www.python.org/downloads/)
* Optional: [pyserial](https://pypi.org/project/pyserial/)
* Optional: [python-rtmidi](https://pypi.org/project/python-rtmidi/)

## Setup

* Install Python 3. Make sure you tick the option to add python to your PATH variable (I think this only applies to windows users but not sure). 
* Optional: open a console and install the two optional python modules by executing `pip install pyserial` (similarly for rtmidi). 
* Optional: follow the [Syntherrupter PC MIDI Setup](https://github.com/MMMZZZZ/Syntherrupter#pc-midi-setup) to communicate with Syntherrupter via MIDI. 
* Clone this repository. You can also download it but cloning (f.ex. using [GitHub Desktop]()) makes it easier to keep the script up to date. 
* Open a console inside the folder of this repository. If you open your console elsewhere you need to specify the full path to the script in the next step.
* Run the script with `python Syfoh.py -h`. 

## The Human Readable Sysex Format

Input commands have the following basic structure:
```
set [sysex number] for [target name] [target value] and [another target name] [value] to [sysex value]
```

## Usage

A complete description of the command line options can be obtained with 

```
python Syfoh.py -h
```

Process a text file and save it as `.syx` (binary) file. This file can be directly sent to a serial port using tools like Realterm. This file can also be processed by any generic Sysex tools (f.ex. converted into a MIDI file). Vendor-specific tools likely won't work. 
```
python Syfoh.py -i "Example-Input.txt" -m BIN -o "Sysex-binary.syx"
```

Write the hex data to the console output (file input):
```
python Syfoh.py -i "Example-Input.txt" -m HEX
```

Process a single command and let Syfoh sent it directly to serial port 2 (with the default baudrate of 115200baud/s):
```
python Syfoh.py -i "set some-command to some-value" -m SER -p COM2
```
Sending data to a MIDI port works exactly the same but with `-m MID`. Note that you can get a list of ports using the `-l` parameter. On top of that you can use the index of the resulting list instead of the port name. Again, please check out the `-h/--help` for details. 

### General Examples and Explanations

* The structure is case insensitive. 
* hex (`0x...`), binary (`0b...`) and decimal notation are valid for any integer
* The sysex command can either be selected by its short name, long name or parameter number. See [Sysex-Name-Number-Mapping.json](/Sysex-Name-Number-Mapping.json) for the full list of short and long names.
* For every command, there may be optional or required targets, like the coil that shall be modified. In case the names for those targets are not obvious from the [sysex command documentation](https://github.com/MMMZZZZ/Syntherrupter/blob/dev/Documentation/Wiki/Custom%20MIDI%20Commands.md#system-exclusive-messages-sysex), the full list of names for every command is contained in the [Sysex-Properties-Mapping.json](/Sysex-Properties-Mapping.json) file.
* Similarly, the target values and the sysex value can be replaced by keywords, like `enabled`/`disabled` instead of `1`/`0`, or `simple`/`midi-live`/... for the `mode` target. Again, all those keywords should be obvious from the documentation of the commands and if not, are contained in the json file linked above.
* Unless noted otherwise, all values are zero indexed. This means f.ex. that coil numbers run from 0 to 5 (unlike in the Syntherrupter UI) and MIDI Channels run from 0-15. Check the documentation linked above for details about the supported value ranges of every command.

```
Command:       Set enable for mode simple to enabled
Equal variant: set Mode-Enable for MODE 1 to 0x01
Equal variant: set 0x20 for MODE simple to 0b1
```

* In addition to the command-specific targets, a target device can be specified using `device [deviceID]`. If no device is given, the command is sent as broadcast to all devices. In a nutshell, this is necessary if more than one Syntherrupter is connected to the same MIDI bus. More details can be found in the [sysex command documentation](https://github.com/MMMZZZZ/Syntherrupter/blob/dev/Documentation/Wiki/Custom%20MIDI%20Commands.md#system-exclusive-messages-sysex). 
* Multiple targets are separated by `and`. The order is not important.
* Almost all parameters can be written with floats - except for things like enable/disable commands where floats don't make sense. Therefore you don't need to convert anything to percent or permille. Details and conventions for float values can be found in the [sysex command documentation](https://github.com/MMMZZZZ/Syntherrupter/blob/dev/Documentation/Wiki/Custom%20MIDI%20Commands.md#conventions).

For MIDI program/envelope `0x20` on device `0`, set the amplitude of step 1 to 1.75. 
```
Command:       set envelope-amplitude for device 0 and program 0x20 and step 1 to 1750
Equal variant: set envelope-amplitude for device 0 and program 0x20 and step 1 to 1.75
```

* Broadcasting/wildcards not only work for the device but for all targets, too. You can broadcast by explicitly writing the broadcast value `127` or `0x7f` or by using the keyword `all`. Not all commands support broadcasting because it doesn't always make sense. 

```
Command:       set ontime for mode simple and coil all to 42
Equal variant: set ontime for mode simple and coil 127 to 42
```

* For string commands, the first 4 characters behind the `to ` (including the first space behind `to`!) are taken as string. This part obviously is case sensitive and can contain additional spaces.
* Remember, because of the limited sysex size, every sysex command can only carry up to 4 characters. Strings longer than 4 characters are split into "char-groups".
* char-group 0 will cause the target device to delete the entire string (overwrite with `\x00`). Hence no additional `\x00` character is needed at the end.

Set the name of user 0 (admin) to `Hello, World!`:
```
set user-name for user 0 and char-group 0 to Hell
set user-name for user 0 and char-group 1 to o, W
set user-name for user 0 and char-group 2 to orld
set user-name for user 0 and char-group 3 to !
```

### Batch Processing Text Files

Syfoh can not only accept a single command from the command line but also a text file with any amount of commands, one per line. Here's and example of how such a file could look (Included in this repository as [Example-Input.txt](/Example-Input.txt)). It enables stereo for all 6 coils, sets reach mode to constant and distributes them equally across the stereo range. The example also demonstrates how easy such setups are with the float commands; no need to mess with fractions of 127 or other weird values. 

Any line that doesn't mach the format will be ignored. So you can use C style comments, Python style, whatever. You probably could write plain text and it would be properly ignored. Only thing you can't do is write a comment in the same line as a command. 

**Important** if you're using batch processing you should [disable UI Updates (Sysex command `0x226`)](https://github.com/MMMZZZZ/Syntherrupter/blob/dev/Documentation/Wiki/Custom%20MIDI%20Commands.md#0x220-0x23f-ui-settings), otherwise Syntherrupter might not be able to process the commands fast enough. With UI Updates disabled there are no issues (processing time <<10ms; commands send with 40ms delay). 

```
# Disable UI updates to ensure fast processing
set ui-update to manual

# Configure stereo mode, range and position for all six coils
set midi-pan-cfg for coil all to constant
set midi-pan-reach for coil all to 0.1
set midi-pan-pos for coil 0 to 0.0
set midi-pan-pos for coil 1 to 0.2
set midi-pan-pos for coil 2 to 0.4
set midi-pan-pos for coil 3 to 0.6
set midi-pan-pos for coil 4 to 0.8
set midi-pan-pos for coil 5 to 1.0
```

## Reading and Monitoring Values

It is not only possible to set values but also to request them, export settings or continuously monitor them. There are a few (really only a few) additional things to consider when reading values:

* If you're using loopMIDI, you need separate loopMIDI ports for incoming and outgoing data because a loopMIDI ports echoes *everything* (and thus also your read commands). 
* The pyserial package has shown very weird behavior on my PC. It sometimes misses the *beginning* of incoming serial data and I don't know why. I recommend to avoid direct serial access. MIDI is more practical anyways because the loopMIDI port can be opened by Syfoh and your Syntheziser at the same time (unlike a serial port). 

There are 3 types of read commands: `check`, `read` and `get`. 

* `check` returns whether the command is available. If you specified any targets it checks whether the command is available for the specified targets. Wildcards are supported; you'll get a reply for every target. 
* `read` returns the value of the parameter and target(s) you requested. 
* `get` is useful for exporting. It works like `read` except that it doesn't send a "reply" message but instead a "command" message. These commands can be saved and used in the future to configure Syntherrupter to the exported values. 

Syfoh has a couple command line options to customize the behavior. You can f.ex. specify what to do with the return data. Either display it as hex, or parse it (and thus display the actual value(s). You can also save it to a file; as readable Syfoh commands, or in binary form which can be handled by other sysex or MIDI programs. 

A special option is `-w/--watch`. It makes Syfoh repeat every x seconds all `check`, `read` and `get` commands (though it's honestly only useful for `read`). This allows you f.ex. to actively monitor the interrupter signal duty cycle. Since `set` commands are ignored, you can add such monitor commands to the end of your batch file and run the file with `-w/--watch` enabled. There are a few other command line options that help formatting the console output. Note that you can also log this data to a file. To stop watching, hit `CTRL+C`.

### Examples

#### Basics (chosing ports, writing read commands)
To make you more comfortable with the additional command line (CLI) parameters the following examples show the entire command line. 

Assume you have loopMIDI set up as recommended above. Now we need to check what ports are available:
```python Syfoh-py --list```
In my case this gives the following output:
```
List of available serial ports:
  0: "COM5"
List of available MIDI Out ports:
  0: "Microsoft GS Wavetable Synth 0"
  1: "loopMIDI Out 1"
  2: "loopMIDI In 2"
List of available MIDI In ports:
  0: "loopMIDI Out 0"
  1: "loopMIDI In 1"
```
Note that MIDI ports (f.ex. `loopMIDI Out`) are listed as in- and output ports. We want to select `loopMIDI Out` as output port and `loopMIDI In` as input port. Because it's easier I'll use the list index numbers (in both cases 1; it's the value at the beginning of every line). This gives the following CLI parameters: `--mode MIDI --port-out 1 --port-in 1`. 

Now we want to check if a command is available. Let's f.ex. check if the `duty` command is available in all modes. The Syfoh command is almost what I just wrote: `check duty for mode simple`. Note that you don't need to specify a value since we're not *setting* the duty to a given value but we're *reading* a property. 

Next we need to decide how Syfoh should treat the received data. I want to *parse* it, meaning that Syfoh decodes the incoming binary data into the same sort of human readable commands. Therefore I add the CLI parameter `--receive PARSED`. 

The resulting command line is this: 
```python Syfoh.py --mode MIDI --port-out 1 --port-in 1 --receive PARSED --input "check ontime for coil all and mode simple"```

Assuming our Syntherrupter only has 4 ports, our console now looks like this:

```
Valid commands (1):
Req[001]: check duty for mode all

Incoming/Outgoing Data:
Out[001]: f0 00 26 05 01 7f 02 00 00 7f 22 00 00 00 00 f7
In [001]: confirming support of duty for device 0 and mode simple and coil 0
In [001]: confirming support of duty for device 0 and mode midi-live and coil 0
Sent 1 command(s) to MIDI port.
```

The replies tell us that `duty` is only supported in `mode simple` and `mode midi-live` - which matches the documentation. Note that the valid commands from your input are numbered such that you can see what in-/outgoing data belongs to what input. 

#### Monitoring

This example shows how to continuously monitor let's say the signal duty. Furthermore we assume that we want to keep our batch processing from above. Monitoring works in theory for as many commands as you like but it quickly becomes unreadable. Therefore we only monitor 2 values: the current number of tones for output 0 and the current duty cycle of the same output. 

The current duty is available as `coil-active-duty`. Note that this is not the same as the `duty` command. The `duty` command is a preset that each mode uses when generating its signal. The `coil-active-duty` is read-only and gives you the sum of all tones of all modes for the given output. Same thing for the `coil-active-tones` command. Our read commands thus look like this: 
```
read coil-active-duty of coil 0
read coil-active-tones of coil 0
```

As you can see, you can susbstitute `for` by `of` - for the simple reason that it is more readable. 

These commands are now appended to our batch file:

```
# Disable UI updates to ensure fast processing
set ui-update to manual

# Configure stereo mode, range and position for all six coils
set midi-pan-cfg for coil all to constant
set midi-pan-reach for coil all to 0.1
set midi-pan-pos for coil 0 to 0.0
set midi-pan-pos for coil 1 to 0.2
set midi-pan-pos for coil 2 to 0.4
set midi-pan-pos for coil 3 to 0.6
set midi-pan-pos for coil 4 to 0.8
set midi-pan-pos for coil 5 to 1.0

# Read commands for monitoring coil 0
read coil-active-duty of coil 0
read coil-active-tones of coil 0
```

To enable continuous monitoring we need to specify an interval (in seconds) with the CLI parameter `-w/--watch`. Let's choose an 1.5 seconds interval: `--watch 1.5`

Furthermore we don't want the full console output. A first step is to not show the outgoing data by adding the flag `--log-no-out`. We can also limit the incoming data to the value - without having Syfoh list all of its targets. We already know we're only logging from coil 0. To do this we change the processing of the received data from `PARSED` to `VALUE`.

This leads to the following command line:
```
python Syfoh.py --mode MIDI --port-out 1 --port-in 1 --receive VALUE --watch 1.5 --log-no-out --input "Examples\Pan-Distribution-6-Coils-Monitoring.txt"
```

Result: 
```
Ignored invald command: # Disable UI updates to ensure fast processing
Ignored invald command:
Ignored invald command: # Enable and configure MIDI Live
Ignored invald command:
Ignored invald command: # Read commands for monitoring coil 0

Valid commands (6):
Set[001]: set ui-update to manual
Set[002]: set enable for mode midi-live to 1
Set[003]: set ontime for mode midi-live and coil all to 100
Set[004]: set duty for mode midi-live and coil all to 0.03
Req[005]: read coil-active-duty of coil 0
Req[006]: read coil-active-tones of coil 0

Incoming Data:
In [005]: 0.056627869606018066
In [006]: 3
In [005]: 0.07208606600761414
In [006]: 3
In [005]: 0.0959746316075325
In [006]: 6
In [005]: 0.0938042551279068
In [006]: 4
In [005]: 0.11566603183746338
In [006]: 5
In [005]: 0.12845882773399353
In [006]: 4

User aborted watching by keyboard interrupt.
Sent 18 command(s) to MIDI port.
```

As you can see I aborted this particular example after 6 watch intervals. A few things to note from this output: 

* Check/Read/Get commands use by default the float version of a command (if available). If you explicitly want the integer version, you need to use the parameter number. Example: if you write `read ontime` you will actually get the float version (`0x2021`). You need to write `read 0x21` to really get the non-float version (`0x0021`). 
* It is not always as obvious as in this case what the individual incoming values are. That's why they all have that number at the beginning. Those numbers match the numbers in the list of valid commands just above. This allows you to identify what command triggered the reply. 

#### Export settings

New scenario: you designed an awesome envelope and want to export it to your computer such that you can embed it into the MIDI file it's been designed for. As we want to get the *commands* that'll later configure Syntherrupter, we use `get` instead of `read`.

To get this done we need to export multiple commands and it would be annoying to do it by hand. This is where ranges come into play. So far we've only send `check`/`read`/`get` requests for single commands. But we can actually ask for a whole range of parameter numbers. The only drawback currently is that you cannot have mixed integer and float commands. Therefore range commands - for now - always give you the integer version. 

What do we need to read? Basically all properties of our envelope. That is *amplitude*, *duration*, *ntau*, *next step* - for all 8 steps of the envelope. Or in other words, we need the range of all envelope parameters for this program. Let's assume the envelope is stored as program 10. Then the Syfoh command is simply `get range-settings-envelope for program 10 and step all`. Since program 10 is actually a built-in program you can try this example yourself without having to create your own envelope.

For the command line we still need to specify that we'd like to write the data to a .syx file (binary file with all sysex commands) which can later be processed by other MIDI tools. This is done by setting `-r/--receive SYX` and specifying a file path with `-o/--output`. 

Finished command line:
```
python Syfoh.py --mode midi --port-out 1 --port-in 1 --receive syx --input "get range-settings-envelope for program 42 and step all" --output "CrazyEnvelope.syx"
```

The resulting .syx file - opened in a hex viewer - is visible below. It's a really simple file format; no headers, nothing. Only sysex commands one after the other. You can see how every line corresponds to one 16 byte long sysex command starting with F0 and ending with F7. At offset 07 and 06 you find the parameter number ranging from 0x0300 to 0x0303. Offset 8 is the step number (increasing from 0 to 7 for each parameter number), offset 9 the program number (0x0a = 10), followed by the value. 

```
Offset(h) 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F

00000000  F0 00 26 05 01 00 00 03 00 0A 01 00 00 00 00 F7
00000010  F0 00 26 05 01 00 00 03 01 0A 01 00 00 00 00 F7
00000020  F0 00 26 05 01 00 00 03 02 0A 01 00 00 00 00 F7
00000030  F0 00 26 05 01 00 00 03 03 0A 01 00 00 00 00 F7
00000040  F0 00 26 05 01 00 00 03 04 0A 01 00 00 00 00 F7
00000050  F0 00 26 05 01 00 00 03 05 0A 01 00 00 00 00 F7
00000060  F0 00 26 05 01 00 00 03 06 0A 01 00 00 00 00 F7
00000070  F0 00 26 05 01 00 00 03 07 0A 01 00 00 00 00 F7
00000080  F0 00 26 05 01 00 01 03 00 0A 50 0F 00 00 00 F7
00000090  F0 00 26 05 01 00 01 03 01 0A 68 07 00 00 00 F7
000000A0  F0 00 26 05 01 00 01 03 02 0A 68 07 00 00 00 F7
000000B0  F0 00 26 05 01 00 01 03 03 0A 2C 02 00 00 00 F7
000000C0  F0 00 26 05 01 00 01 03 04 0A 68 07 00 00 00 F7
000000D0  F0 00 26 05 01 00 01 03 05 0A 68 07 00 00 00 F7
000000E0  F0 00 26 05 01 00 01 03 06 0A 68 07 00 00 00 F7
000000F0  F0 00 26 05 01 00 01 03 07 0A 2C 02 00 00 00 F7
00000100  F0 00 26 05 01 00 02 03 00 0A 18 75 00 00 00 F7
00000110  F0 00 26 05 01 00 02 03 01 0A 30 6A 01 00 00 F7
00000120  F0 00 26 05 01 00 02 03 02 0A 00 12 74 01 00 F7
00000130  F0 00 26 05 01 00 02 03 03 0A 40 3E 00 00 00 F7
00000140  F0 00 26 05 01 00 02 03 04 0A 60 46 5B 00 00 F7
00000150  F0 00 26 05 01 00 02 03 05 0A 38 17 00 00 00 F7
00000160  F0 00 26 05 01 00 02 03 06 0A 58 36 00 00 00 F7
00000170  F0 00 26 05 01 00 02 03 07 0A 40 3E 00 00 00 F7
00000180  F0 00 26 05 01 00 03 03 00 0A 50 0F 00 00 00 F7
00000190  F0 00 26 05 01 00 03 03 01 0A 38 17 00 00 00 F7
000001A0  F0 00 26 05 01 00 03 03 02 0A 38 17 00 00 00 F7
000001B0  F0 00 26 05 01 00 03 03 03 0A 38 17 00 00 00 F7
000001C0  F0 00 26 05 01 00 03 03 04 0A 38 17 00 00 00 F7
000001D0  F0 00 26 05 01 00 03 03 05 0A 38 17 00 00 00 F7
000001E0  F0 00 26 05 01 00 03 03 06 0A 38 17 00 00 00 F7
000001F0  F0 00 26 05 01 00 03 03 07 0A 38 17 00 00 00 F7
```
