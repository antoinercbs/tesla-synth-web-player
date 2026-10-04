/** The visitor's system, for the download offered first. */
export type Os = 'windows' | 'linux' | 'macos' | 'mobile' | 'other';

interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean; platform?: string };
}

export function detectOs(nav: NavigatorLike = navigator as NavigatorLike): Os {
  const ua = nav.userAgent ?? '';
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'mobile';
  const platform = nav.userAgentData?.platform || nav.platform || ua;
  if (/win/i.test(platform)) return 'windows';
  // an iPad asks for the desktop site and says Mac: only its touch screen tells
  if (/mac/i.test(platform)) return (nav.maxTouchPoints ?? 0) > 1 ? 'mobile' : 'macos';
  if (/linux|x11|cros/i.test(platform)) return 'linux';
  return 'other';
}
