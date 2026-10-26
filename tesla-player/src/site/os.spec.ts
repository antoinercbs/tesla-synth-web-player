import { describe, expect, it } from 'vitest';
import { detectOs } from './os';

describe('detectOs', () => {
  it('reads the platform of a desktop browser', () => {
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' })).toBe('windows');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' })).toBe('linux');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe('macos');
  });

  it('prefers the client hints when the browser gives them', () => {
    expect(detectOs({ userAgent: 'Mozilla/5.0', userAgentData: { mobile: false, platform: 'Windows' } })).toBe('windows');
    expect(detectOs({ userAgent: 'Mozilla/5.0', userAgentData: { mobile: true, platform: 'Android' } })).toBe('mobile');
  });

  it('takes a phone or a tablet for a phone, an iPad posing as a Mac included', () => {
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', platform: 'Linux armv8l' })).toBe('mobile');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone' })).toBe('mobile');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('mobile');
  });
});
