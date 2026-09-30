# Configuring the Syntherrupter over USB

← [Docs](./README.md) · [Project README](../readme.md)

Besides playing music, the app can read and edit the **Syntherrupter's own on-board settings** over a USB-serial link (or the native USB-MIDI port of the ESP32 Syntherrupter), no touchscreen needed. This is for **operators** setting up the coils.

**Contents**

- [Connecting](#connecting)
- [ESP32 Syntherrupter (native USB-MIDI)](#esp32-syntherrupter-native-usb-midi)
- [The configuration page](#the-configuration-page)
- [Applying, saving & rebooting](#applying-saving--rebooting)
- [Safety notes](#safety-notes)
- [Linux: making the serial port work](#linux-making-the-serial-port-work)

---

## Connecting

1. Plug the Syntherrupter into your computer's USB port.
2. In the sidebar, click the **Coils** output line, then **Connect a USB port…** under **Syntherrupter over USB**.
3. Pick the device's serial port in the browser prompt (on Linux it usually shows up as `ttyACM0`).

Once the link is up, a **Syntherrupter** entry appears in the sidebar navigation. (The port is remembered, so next time it reconnects without prompting.)

> Requires a **Chromium-based browser** and a **secure context** (`https://` or `http://localhost`). If "Connect" fails on Linux, see [Linux: making the serial port work](#linux-making-the-serial-port-work).

## ESP32 Syntherrupter (native USB-MIDI)

The ESP32 port of the Syntherrupter (ESP32-S3, native USB) shows up on USB as **two devices at once**: a serial port (same byte stream as the Tiva LaunchPad, so the serial link works as above) and a **USB-MIDI** device named **Syntherrupter ESP32** (no driver needed).

- **Recommended for playback: Coils output = "Syntherrupter ESP32" under MIDI interfaces.** Web MIDI keeps the player's timestamped scheduling (the serial link sends notes as soon as they're processed).
- **The configuration page also works over MIDI**: the device answers on its USB-MIDI input, so the app pairs the output with the input of the same name and reads the settings back. With a plain USB-MIDI interface to a Tiva Syntherrupter this only works if the Syntherrupter's DIN MIDI OUT is wired back to the interface; otherwise use the serial link.

## The configuration page

Open the **Syntherrupter** page. It reads the device's current settings on open (a progress bar shows the per-coil/system/user reads). Settings are grouped:

- **Per-coil safety limits**, for each coil: **max on-time**, **max duty**, **min on-time**, **min off-time**, **max voices**, and **output invert**. These are the physical guardrails the live power control can never exceed.
- **System settings**: **device ID**, **buffer duration**, **background shutdown**, and the device's **touchscreen** (brightness, standby, button feel).
- **User accounts**: the device's user accounts and their permission limits (the on-screen slider ranges).

Two helpful cues:

- A small **"resets at startup"** icon marks values that are **not persisted to EEPROM** and revert each time the device powers on.
- Any value the firmware **can't report back** (some parameters are write-only or unavailable on a given firmware version) is shown **disabled with an orange warning**.

## Applying, saving & rebooting

- Edits are **applied per section**, not all at once.
- **Safety-critical** changes ask for confirmation (output-invert asks twice).
- **Save to EEPROM** persists the **applied** values so they survive a power cycle. It asks first, and says how many edits aren't applied yet (those aren't saved: cancel and apply them first).
- **Reboot** restarts the device.

## Safety notes
 
- Driving the device over serial bypasses the on-screen **login**: it's gated only by the **coil hardware limits** above, not by the per-user limits (which are the touchscreen slider ranges). Treat the serial/MIDI link as full operator access.

## Linux: making the serial port work

If you see the device in the dropdown (e.g. `ttyACM0`) but get **"Failed to open serial port"**, two Linux specifics are usually the cause:

1. **Serial port permissions.** Your user must be in the `dialout` group:
   ```bash
   sudo usermod -aG dialout "$USER"
   ```
   Group membership only takes effect in a **new login session**: log out and back in (a reboot is the surest).

2. **ModemManager grabbing the device.** On many distros, ModemManager probes new `ttyACM*` devices and holds the port open. Tell it to ignore the Syntherrupter with a udev rule, e.g. create `/etc/udev/rules.d/99-syntherrupter.rules`:
   ```
   # Adjust idVendor/idProduct to your device (see: lsusb)
   # Tiva LaunchPad (ICDI debug probe)
   SUBSYSTEM=="tty", ATTRS{idVendor}=="0483", ENV{ID_MM_DEVICE_IGNORE}="1"
   # ESP32 Syntherrupter (Espressif VID)
   SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ENV{ID_MM_DEVICE_IGNORE}="1"
   ```
   then reload:
   ```bash
   sudo udevadm control --reload-rules && sudo udevadm trigger
   ```
