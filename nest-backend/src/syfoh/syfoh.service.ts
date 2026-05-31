import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Thin wrapper around the Syfoh Python CLI.
 *
 * This is intentionally isolated: the long-term plan is to drop the CLI call
 * entirely and perform the sysex conversion in the front-end. Keeping it behind
 * a single service means that future removal touches only this file.
 *
 * Unlike the original Flask version (which built a shell string and was open to
 * command injection), we invoke the interpreter with an argument array — no
 * shell, no injection.
 */
@Injectable()
export class SyfohService {
  private readonly pythonBin = process.env.PYTHON_BIN ?? 'python3';
  private readonly syfohScript =
    process.env.SYFOH_SCRIPT ?? '../flask-backend/Syfoh/Syfoh.py';

  async translate(sysexCommand: string): Promise<string> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(this.pythonBin, [
        this.syfohScript,
        '-i',
        sysexCommand,
        '-m',
        'HEX',
        '--log-no-index',
      ]));
    } catch {
      throw new InternalServerErrorException('Syfoh translation failed');
    }

    // Syfoh prints a line like "Out: f0 00 ...". Keep everything after the
    // marker, mirroring the original Flask extraction.
    const marker = 'Out: ';
    const markerIndex = stdout.indexOf(marker);
    if (markerIndex === -1) {
      return stdout.trim();
    }
    return stdout.slice(markerIndex + marker.length).trim();
  }
}
