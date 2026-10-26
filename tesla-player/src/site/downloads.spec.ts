import { describe, expect, it } from 'vitest';
import { buildsOfRelease, osOfFile, versionOf } from './downloads';

describe('desktop builds', () => {
  it('tell their system by their extension', () => {
    expect(osOfFile('Tesla Player-2.0.0.AppImage')).toBe('linux');
    expect(osOfFile('Tesla Player-Setup-2.0.0.exe')).toBe('windows');
    expect(osOfFile('Tesla Player-Setup-2.0.0.exe.blockmap')).toBeNull();
    expect(osOfFile('latest.yml')).toBeNull();
  });

  it('carry their version in their name', () => {
    expect(versionOf('Tesla Player-Setup-2.0.0.exe')).toBe('2.0.0');
    expect(versionOf('tesla-player.AppImage')).toBeNull();
  });

  it('are taken one per system from a release', () => {
    const asset = (name: string, size = 1) => ({ name, browser_download_url: `https://x/${name}`, size });
    expect(buildsOfRelease([
      asset('Tesla Player-Setup-2.0.0.exe.blockmap'),
      asset('Tesla Player-Setup-2.0.0.exe', 80),
      asset('Tesla Player-2.0.0.AppImage', 95),
      asset('latest-linux.yml'),
    ])).toEqual([
      { os: 'windows', url: 'https://x/Tesla Player-Setup-2.0.0.exe', file: 'Tesla Player-Setup-2.0.0.exe', size: 80 },
      { os: 'linux', url: 'https://x/Tesla Player-2.0.0.AppImage', file: 'Tesla Player-2.0.0.AppImage', size: 95 },
    ]);
  });
});
