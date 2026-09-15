/**
 * Conditions helpers: current weather from Open-Meteo (free, no key, CORS) and a
 * place name from OpenStreetMap's Nominatim. Both are best-effort: the tuning
 * form works without them (manual entry).
 */
export interface CurrentWeather {
  tempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  /** WMO weather interpretation code. */
  weatherCode: number | null;
  precipitationMm: number | null;
  isDay: boolean | null;
}

export async function fetchCurrentWeather(lat: number, lon: number, signal?: AbortSignal): Promise<CurrentWeather> {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', lat.toFixed(4));
  u.searchParams.set('longitude', lon.toFixed(4));
  u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,surface_pressure,weather_code,precipitation,is_day');
  u.searchParams.set('timezone', 'auto');
  const r = await fetch(u.toString(), { signal });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = (await r.json()) as { current?: Record<string, unknown> };
  const c = j.current ?? {};
  const num = (k: string): number | null => (typeof c[k] === 'number' ? (c[k] as number) : null);
  return {
    tempC: num('temperature_2m'),
    humidityPct: num('relative_humidity_2m'),
    pressureHpa: num('surface_pressure'),
    weatherCode: num('weather_code'),
    precipitationMm: num('precipitation'),
    isDay: typeof c['is_day'] === 'number' ? c['is_day'] === 1 : null,
  };
}

/** Place label for coordinates (Nominatim reverse geocoding), or null. */
export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  const u = new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('lat', lat.toFixed(5));
  u.searchParams.set('lon', lon.toFixed(5));
  u.searchParams.set('zoom', '16');
  const r = await fetch(u.toString(), { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const j = (await r.json()) as { address?: Record<string, string>; display_name?: string };
  const a = j.address ?? {};
  const parts = [a.amenity || a.building || a.road, a.village || a.town || a.city || a.municipality].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return j.display_name?.split(',').slice(0, 2).join(',').trim() || null;
}

/** WMO code → coarse family used for the icon + i18n key. */
export type WeatherFamily = 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

export function weatherFamily(code: number | null | undefined): WeatherFamily | null {
  if (code == null) return null;
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

export function weatherIcon(code: number | null | undefined): string {
  switch (weatherFamily(code)) {
    case 'clear': return 'fa-sun';
    case 'cloudy': return 'fa-cloud';
    case 'fog': return 'fa-smog';
    case 'drizzle': return 'fa-cloud-rain';
    case 'rain': return 'fa-cloud-showers-heavy';
    case 'snow': return 'fa-snowflake';
    case 'storm': return 'fa-cloud-bolt';
    default: return 'fa-question';
  }
}

/** Browser geolocation as a promise (null when unavailable / refused). */
export function currentPosition(timeoutMs = 12000): Promise<{ lat: number; lon: number; accuracyM: number | null } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
