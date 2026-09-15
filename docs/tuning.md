# Camera-assisted tuning

← [Docs](./README.md) · [Project README](../readme.md)

Tuning ("accord") a Tesla coil means moving the **primary tap** until the primary resonates with the secondary *as loaded by its arcs*, which is a little off the no-load resonance. The usual way is to play a note, look at the arcs, cut the power, move the tap by an eighth of a turn, and repeat, judging by eye. The **Tuning** screen replaces the eye with a phone camera and remembers the result.

It runs as a guided session in four steps — **settings → camera → trials → save** — and every session ends with a saved record.

**Contents**

- [What you need](#what-you-need)
- [The procedure](#the-procedure)
- [Reading the results](#reading-the-results)
- [Saving a tuning](#saving-a-tuning)
- [How the measurement works](#how-the-measurement-works)
- [Limits and good practice](#limits-and-good-practice)
- [Safety](#safety)
- [For developers](#for-developers)

---

## What you need

- The coil driven from the app (MIDI or serial output) as for playing music.
- A **phone with a rear camera**, placed on a stand or leaning against something, framing the coil and the space above its toroid. It must not move during the session. Any laptop webcam works too (less convenient to place).
- The phone must reach the app:
  - **web server**: over HTTPS, as the browser only exposes the camera to secure origins;
  - **desktop app**: over Wi‑Fi, through the local HTTPS server the app starts for the session. Its certificate is self-signed: the phone shows a warning the first time, accept it once.

## The procedure

### 1. Settings — fixed for the whole session

- **Coil under test**: the coil, its usual on-time / duty, and optionally an envelope to force. The **fibre out** is the Syntherrupter optical output the tone fires on, preset to the coil's number (change it only if the wiring differs).
- **Test tone**: one to four MIDI notes held one after the other (three by default: C3, G3, C4, shown with their frequency in Hz since a coil's firing rate is its pitch), how long each is held (10 s by default) and the gap between them (3 s). The tone is identical for every trial, which is what makes the trials comparable. *Play the tone (no measurement)* checks the coil sings before involving the camera.
- **Primary**: total turns, the range of tap positions to explore (for example 4 to 8 turns), and the tap step (1/8 turn by default). The drawing here is a preview of the range, without a tap clip.

Once the first trial has run, the coil and tone fields are locked for the session; the primary range stays adjustable.

### 2. Camera

A QR code appears: scan it with the phone (or open the link on this computer for its webcam). On the phone: start the camera, **tap the picture where the arcs start** (the breakout point — nothing else is enabled until you do), turn the zone towards the **side the arcs go** (a breakout point throws them one way, so the zone is a half-disk), size it so the longest arcs fit inside, raise the **floor line** above the coil base and any LEDs, then *Zone OK*. The player moves on to the trials by itself. From now on, do not touch the phone.

### 3. Trials

The panel that stays on screen holds everything you act on: the primary drawing, the tap position and *Run trial*. It flips to **what the camera sees** while a trial runs, and back to the primary when it ends; the switch at its top does the same by hand. Beside it, the chart and the trials table build up, under a strip that recalls what is under test (coil, fibre, on-time, duty, tone).

Set the tap on the drawing (drag the clip along the copper spiral), on the ruler under the chart, with ±, keyboard arrows, or *Use* the suggestion. Move the physical tap **with the coil off**, then *Run trial* and confirm. The app captures the background while the coil is still off, holds the notes while the camera measures, and adds a row to the table. Repeat: the app suggests the next position — a coarse pass on half-turns over the range, then a fine pass around the best point, then an estimated optimum.

**STOP** on the player or on the phone cuts the tone immediately.

### 4. Save

The session ends with a record. See [Saving a tuning](#saving-a-tuning).

## Reading the results

- Each trial has a **score**: the mean, over the notes, of the 90th percentile of the arc length measured frame by frame (in **pixels of the camera's work frame**). The P90 is robust to the arc's flicker and to frames that miss it.
- The **chart** plots the per-note lengths and the score against the tap position, on the same scale as the tap ruler right under it (graduated at every turn and every tap step, with the best, suggested and previous positions marked); the best trial is highlighted in the table.
- **Arc silhouettes** show where the arcs went during a trial (brighter = more often), live for the current note and side by side for the best and the last trials.
- The **phone** mirrors the trial as it runs: trial number, tap under test, each note with a progress bar then its result, and the score against the best so far.
- Lengths are in pixels: they compare trials of one session (same camera, same place) perfectly well. Converting to centimetres will come with a physical reference placed in front of the coil in a later version.

## Saving a tuning

Saving is the last step of every session, not an afterthought: *Finish and save* shows a recap (best tap, its arc length, the trial count, the tone and the primary geometry) and the form below stores the retained tap position and its arc length, together with:

- the **place** (map with a draggable marker, pre-filled from the phone's position when available, with a name from OpenStreetMap on request);
- the **conditions**: indoor / outdoor, temperature, humidity and pressure (fetched from Open‑Meteo for the position, or typed in), dry / wet ground, and a free comment;
- the tone, the primary geometry and the whole trial series.

The **History** tab (switch at the top right of the Tuning screen) lists every saved tuning across coils, with a coil filter and a place search. A row opens into the full record: map, the trial series drawn on the primary, arc silhouettes, tone and comment. *Use this position* brings the coil, primary settings and tap back into the Tuning tab. When the camera reports a position near a saved tuning, the tool also recalls it ("Last tuning near here").

## How the measurement works

Everything runs on the phone; only small summaries travel to the player.

1. **Background**: right before each trial, with the coil off, the camera accumulates a couple of dozen frames. Their per-pixel 20th percentile is the background; the per-pixel noise is measured on the dark side of the distribution, so a stray arc cannot inflate it.
2. **Alignment**: each frame is aligned onto the background by an integer translation found by normalised cross-correlation on gradient features of the decor around the zone. The phone is supposed to be still: this is a safety net, and a shift beyond a few pixels flags the frame as *moved* and discards it.
3. **Difference and top-hat**: the frame minus the background (max over the colour channels), then a white top-hat with a 9×9 window: thin bright filaments survive, diffuse illumination (the arc lighting up the room) and exposure drift do not.
4. **Threshold**: per pixel, the largest of 5 × the measured noise, 2 × the background gradient (tolerates residual misalignment on static edges) and a floor of 16 levels.
5. **Thin channels only**: a pixel counts only if the top-hat keeps most of its brightness (a channel does; ground lit up by a strike keeps only its texture), and pixels whose 13-px neighbourhood is mostly lit are dropped as a surface (a channel is sparse, a glowing patch is dense). So a ground strike is measured up to where the channel meets the ground, not across the lit ground.
6. **Chaining**: the mask is bridged over small gaps and flood-filled from a small disk around the breakout; only what is connected to the breakout counts, and only if it contains a clearly bright core (an arc does, an edge residue does not). The length is the farthest kept pixel from the breakout.

On the club's test recordings this gives a P90 that varies by about 3 % between successive 3 s windows on a fixed camera, even with music playing rather than a constant tone.

## Limits and good practice

- **Keep the phone still.** The background is captured at each trial, so slow drifts are absorbed, but a bump during a note spoils that note (the *moved* flag drops the affected frames).
- **Frame against a dark background** when you can, with the coil base and any LEDs below the floor line. Bright lit windows behind the arcs reduce the contrast.
- **Filming a screen** (a video of a coil) is a useful dry run but a harsh one: screen refresh and moiré add flicker the background model cannot predict, so expect stray detections that a real scene does not produce.
- **Daylight** has not been validated: arcs are far less visible and the measurement gets noisy. Dusk or shade works much better.
- If the arc reaches the edge of the zone, the length saturates: enlarge the zone.
- The phone locks exposure, white balance and focus when the browser allows it (Android Chrome); on iOS the background capture at each trial compensates instead.

## Safety

- A trial cannot start until you confirm the coil is off and the tap has been moved with hands clear.
- Every note is bounded by a timer; at the end, and on any STOP, the app sends note-off and *all sound off* on both outputs.
- Only the selected fibre output listens to the tone (MIDI channel 1 mapped to it alone): the other outputs get an empty channel map for the duration.
- As always over SysEx, the Syntherrupter's own per-coil limits are the real guardrail: the app never asks for more than the coil's usual on-time and duty.

## For developers

- Front: `tesla-player/src/vision/arc-meter.ts` (the meter, pure TypeScript, unit-tested and replayable on recordings), `src/tuning/*` (session protocol and link, tone runner, suggestion, heat maps, components), views `TuneView.vue` (player, the four-step session) and `TuneCameraView.vue` (phone, route `/tune/cam/:sessionId`, no app chrome, public).
- Backend: `nest-backend/src/tuning/` — an in-memory session relay gated by the session token rather than OIDC, and the `CoilTuning` table behind `/api/tunings`.
- **The live channel is a WebSocket**, one per side, on `…/sessions/:id/ws?token=&after=&who=`: the hub (`tuning-ws.hub.ts`) pushes events and presence changes, and a publish travels up the same socket and comes back acknowledged with its sequence number. A reconnection replays from `after=`, so nothing is lost. SSE (`GET …/events`) and polling (`GET …/poll` + `POST …/events`) remain as fallbacks when a socket cannot be opened at all (a proxy that does not upgrade), and for publishing while the channel is down.
- Desktop: `electron/src/lan-server.ts` starts an HTTPS server on the in-process Nest app for the session (self-signed certificate cached in the user data folder) and routes its `upgrade` events to the same hub, so the phone gets the WebSocket. The renderer cannot upgrade over the in-process `app://` transport, so it runs the *same* hub connection through the main process (`tuning:open` / `tuning:send` / `tuning:message` IPC).
- Design notes and the prototype study behind the method: see the feasibility document shared with the team.
