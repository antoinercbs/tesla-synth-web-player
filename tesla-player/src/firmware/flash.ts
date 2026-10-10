import type { FirmwareImage, FirmwareRelease } from '@/firmware/api';

/**
 * Writing a firmware into an ESP32 board in its ROM download mode, over the
 * chip's USB-Serial-JTAG port, with esptool-js (loaded only here: it is big).
 */

/** What the board turns into in download mode: Espressif's USB-Serial-JTAG unit. */
export const ROM_PORT = { usbVendorId: 0x303a, usbProductId: 0x1001 } as const;

/** A board in its download mode: a port for the flasher, never for the coils. */
export const isRomPort = (p: SerialPort): boolean => {
  const info = p.getInfo();
  return info.usbVendorId === ROM_PORT.usbVendorId && info.usbProductId === ROM_PORT.usbProductId;
};

/**
 * The ROM's port once it shows up, if this app was allowed it before (Chrome
 * remembers the device): no picker needed then. null after `timeoutMs`.
 */
export async function waitForGrantedRomPort(timeoutMs: number, signal?: AbortSignal): Promise<SerialPort | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !signal?.aborted) {
    const port = (await navigator.serial.getPorts()).find(isRomPort);
    if (port) return port;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/** The browser's picker, showing the ROM's port only. Needs a user gesture. */
export function requestRomPort(): Promise<SerialPort> {
  return navigator.serial.requestPort({ filters: [ROM_PORT] });
}

export interface FlashProgress {
  /** 0..1 over all the images. */
  ratio: number;
  file: string;
}

const norm = (chip: string): string => chip.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Writes `images` at their offsets, then resets the board into its new
 * firmware. Never erases the whole flash: the settings (NVS) stay.
 */
export async function flashFirmware(
  port: SerialPort,
  release: FirmwareRelease,
  images: FirmwareImage[],
  onProgress: (p: FlashProgress) => void,
): Promise<void> {
  const { ESPLoader, Transport } = await import('esptool-js');
  const transport = new Transport(port, false);
  const log: string[] = [];
  const terminal = {
    clean: () => {},
    write: (s: string) => { log.push(s); },
    writeLine: (s: string) => { log.push(s); },
  };
  try {
    const loader = new ESPLoader({ transport, baudrate: 921600, terminal });
    const chip = await loader.main();
    if (!norm(chip).startsWith(norm(release.chip))) {
      throw new Error(`this is an ${chip}, the firmware is for an ${release.chip}`);
    }
    const total = images.reduce((sum, i) => sum + i.data.length, 0);
    const before = images.map((_, i) => images.slice(0, i).reduce((sum, im) => sum + im.data.length, 0));
    await loader.writeFlash({
      fileArray: images.map((i) => ({ data: i.data, address: i.offset })),
      flashMode: release.flash.mode as never,
      flashFreq: release.flash.freq as never,
      flashSize: release.flash.size as never,
      eraseAll: false,
      compress: true,
      reportProgress: (index, written, size) => {
        const image = images[index];
        if (!image) return;
        // `written` counts the image's own bytes, `size` its length
        const done = before[index] + (size ? (written / size) * image.data.length : 0);
        onProgress({ ratio: total ? done / total : 1, file: image.name });
      },
    });
    await loader.after('hard_reset');
  } catch (err) {
    console.error('Firmware update failed', err, log.join(''));
    throw err;
  } finally {
    await transport.disconnect().catch(() => {});
  }
}
