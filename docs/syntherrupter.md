# Configuring the Syntherrupter over USB

← [Docs](./README.md) · [Project README](../readme.md)

Besides playing music, the app can read and edit the **Syntherrupter's own on-board settings** over a USB-serial link (or the native USB-MIDI port of the ESP32 Syntherrupter), no touchscreen needed. This is for **operators** setting up the coils.

**Contents**

- [Connecting](#connecting)
- [ESP32 Syntherrupter (native USB-MIDI)](#esp32-syntherrupter-native-usb-midi)
- [Which board: Tiva or ESP32](#which-board-tiva-or-esp32)
- [Board state and protection (ESP32)](#board-state-and-protection-esp32)
- [The configuration page](#the-configuration-page)
- [Applying, saving & rebooting](#applying-saving--rebooting)
- [Updating the ESP32's firmware](#updating-the-esp32s-firmware)
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

- **Recommended for playback: Coils output = "Syntherrupter ESP32" under Syntherrupters.** The output menu lists it apart from the plain MIDI interfaces. Web MIDI keeps the player's timestamped scheduling (the serial link sends notes as soon as they're processed).
- **The configuration page also works over MIDI**: the device answers on its USB-MIDI input, so the app pairs the output with the input of the same name and reads the settings back. With a plain USB-MIDI interface to a Tiva Syntherrupter this only works if the Syntherrupter's DIN MIDI OUT is wired back to the interface; otherwise use the serial link.

## Which board: Tiva or ESP32

The app drives the original Syntherrupter (Tiva LaunchPad, 6 outputs) and its ESP32 port (4 outputs, board state, no touchscreen). It recognises the board by itself on the ESP32's USB-MIDI port and on the serial port of either board.

When the output can't tell (the built-in synth, a plain MIDI interface), pick the board in the output menu: **Board** under the emulated synth, **To** under the interface in use. The choice is kept per computer. It sets how many coils Live, Fixed, the tuning page and the envelope test offer, and the board the synth stands for. Songs keep up to 6 coils whatever the board: the ones past its outputs stay silent, and the player says so.

## Board state and protection (ESP32)

The ESP32 board reports its state by itself; the app shows it on the **Coils** output line and at the top of its menu:

- **Armed**: all is well.
- **On STOP: fibers off**: the board's STOP switch cuts the fiber transmitters' supply. Nothing fires until it is back on RUN. It is a quick stop on the signal, **not the emergency stop**, which acts on the coils' power.
- **Protection tripped**: a channel's hardware protection cut a pulse that was too long or a duty that was too high. The board switches its outputs off and keeps them off; the app stops whatever plays, names the coil and its trip count, and greys out Play. Check that coil's limits, then **Re-arm…**. If a channel is still cutting, the board refuses and the app says which one: wait, or stop the signal, then try again. Nothing restarts by itself.
- **Protection not monitored**: a board without protection inputs (a DevKit). A trip would go unseen.
- **Not answering**: the board stopped replying; its state is no longer followed.

On the configuration page, the **Board** section shows the same, and the coils table counts the trips of each coil since the board started. A max on-time or max duty close to the board's typical cut-off (about 210 µs, 15 %) gets an orange warning; it is never refused.

## The configuration page

Open the **Syntherrupter** page. It reads the device's current settings on open (a progress bar shows the per-coil/system/user reads). Settings are grouped:

- **Per-coil safety limits**, for each coil: **max on-time**, **max duty**, **min on-time**, **min off-time**, **max voices**, and **output invert**. These are the physical guardrails the live power control can never exceed.
- **System settings**: **device ID**, **buffer duration**, **background shutdown**, and the device's **touchscreen** (brightness, standby, button feel).
- **User accounts**: the device's user accounts and their permission limits (the on-screen slider ranges).

What the page offers depends on the board: the ESP32 has a **Board** section and no touchscreen, user accounts or output invert.

Two helpful cues:

- A small **"resets at startup"** icon marks values that are **not persisted to EEPROM** and revert each time the device powers on.
- Any value the firmware **can't report back** (some parameters are write-only or unavailable on a given firmware version) is shown **disabled with an orange warning**.

## Applying, saving & rebooting

- Edits are **applied per section**, not all at once.
- **Safety-critical** changes ask for confirmation (output-invert asks twice).
- **Save to EEPROM** persists the **applied** values so they survive a power cycle. It asks first, and says how many edits aren't applied yet (those aren't saved: cancel and apply them first).
- **Reboot** restarts the device. The ESP32 leaves USB while it reboots: the page waits for it to come back.
- On the ESP32 the button reads **Save to the board** (its flash memory).

## Updating the ESP32's firmware

When the server offers a newer firmware for the ESP32 board than the one it runs, its **Syntherrupter** page shows **v… available** next to the board's name (the server's operator puts the firmwares in place: see [Deployment → Offering board firmwares](./deployment.md#offering-board-firmwares)). The update runs over the same USB cable, in a Chromium-based browser or the desktop app:

1. The app downloads the firmware and checks it against its manifest.
2. The coils stop, and the board reboots into its download mode.
3. The board comes back as **USB JTAG/serial debug unit**. The first time, the browser asks to pick that port; afterwards it is found by itself.
4. The bootloader, the partition table and the application are written. The settings (coil limits, envelopes…) are left alone.
5. The board restarts and the app reads its version back.

If the board does not come back, hold **BOOT**, press **RESET**, release **BOOT**, then **Pick the port…**. A failed update cannot brick it: the download mode is in the chip's ROM.

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
   # Tiva LaunchPad (TI ICDI debug probe, 1cbe:00fd)
   SUBSYSTEM=="tty", ATTRS{idVendor}=="1cbe", ENV{ID_MM_DEVICE_IGNORE}="1"
   # ESP32 Syntherrupter (Espressif VID)
   SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ENV{ID_MM_DEVICE_IGNORE}="1"
   ```
   then reload:
   ```bash
   sudo udevadm control --reload-rules && sudo udevadm trigger
   ```
