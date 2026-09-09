'use strict';

/**
 * Location presets.
 *
 * Each entry ties together the three things that must stay consistent for a
 * believable "location" per tab:
 *   1. Decodo proxy geo-targeting params (country / state / city)  -> the exit IP
 *   2. HTML5 geolocation coordinates (lat / lng)                   -> navigator.geolocation
 *   3. IANA timezone + language                                   -> Intl / Date / Accept-Language
 *
 * Decodo parameter conventions (from their docs):
 *   - country: ISO 3166-1 alpha-2, lowercase (e.g. "us", "gb")
 *   - state:   "us_<state>" style, lowercase with underscores (US only)
 *   - city:    lowercase, spaces -> underscores (e.g. "new_york")
 * Adjust `decodo` values if your Decodo dashboard shows a different token.
 */
const CITIES = [
  { key: 'us-new-york',    label: 'New York, USA',        lat: 40.7128,  lng: -74.0060, tz: 'America/New_York',    lang: 'en-US', decodo: { country: 'us', state: 'us_new_york',   city: 'new_york' } },
  { key: 'us-los-angeles', label: 'Los Angeles, USA',     lat: 34.0522,  lng: -118.2437, tz: 'America/Los_Angeles', lang: 'en-US', decodo: { country: 'us', state: 'us_california', city: 'los_angeles' } },
  { key: 'us-chicago',     label: 'Chicago, USA',         lat: 41.8781,  lng: -87.6298, tz: 'America/Chicago',     lang: 'en-US', decodo: { country: 'us', state: 'us_illinois',   city: 'chicago' } },
  { key: 'us-miami',       label: 'Miami, USA',           lat: 25.7617,  lng: -80.1918, tz: 'America/New_York',    lang: 'en-US', decodo: { country: 'us', state: 'us_florida',    city: 'miami' } },
  { key: 'gb-london',      label: 'London, UK',           lat: 51.5074,  lng: -0.1278,  tz: 'Europe/London',      lang: 'en-GB', decodo: { country: 'gb', city: 'london' } },
  { key: 'fr-paris',       label: 'Paris, France',        lat: 48.8566,  lng: 2.3522,   tz: 'Europe/Paris',       lang: 'fr-FR', decodo: { country: 'fr', city: 'paris' } },
  { key: 'de-berlin',      label: 'Berlin, Germany',      lat: 52.5200,  lng: 13.4050,  tz: 'Europe/Berlin',      lang: 'de-DE', decodo: { country: 'de', city: 'berlin' } },
  { key: 'nl-amsterdam',   label: 'Amsterdam, Netherlands', lat: 52.3676, lng: 4.9041,  tz: 'Europe/Amsterdam',   lang: 'nl-NL', decodo: { country: 'nl', city: 'amsterdam' } },
  { key: 'es-madrid',      label: 'Madrid, Spain',        lat: 40.4168,  lng: -3.7038,  tz: 'Europe/Madrid',      lang: 'es-ES', decodo: { country: 'es', city: 'madrid' } },
  { key: 'ca-toronto',     label: 'Toronto, Canada',      lat: 43.6532,  lng: -79.3832, tz: 'America/Toronto',    lang: 'en-CA', decodo: { country: 'ca', city: 'toronto' } },
  { key: 'br-sao-paulo',   label: 'São Paulo, Brazil',    lat: -23.5505, lng: -46.6333, tz: 'America/Sao_Paulo',  lang: 'pt-BR', decodo: { country: 'br', city: 'sao_paulo' } },
  { key: 'mx-mexico-city', label: 'Mexico City, Mexico',  lat: 19.4326,  lng: -99.1332, tz: 'America/Mexico_City', lang: 'es-MX', decodo: { country: 'mx', city: 'mexico_city' } },
  { key: 'ae-dubai',       label: 'Dubai, UAE',           lat: 25.2048,  lng: 55.2708,  tz: 'Asia/Dubai',         lang: 'en-AE', decodo: { country: 'ae', city: 'dubai' } },
  { key: 'in-mumbai',      label: 'Mumbai, India',        lat: 19.0760,  lng: 72.8777,  tz: 'Asia/Kolkata',       lang: 'en-IN', decodo: { country: 'in', city: 'mumbai' } },
  { key: 'sg-singapore',   label: 'Singapore',            lat: 1.3521,   lng: 103.8198, tz: 'Asia/Singapore',     lang: 'en-SG', decodo: { country: 'sg' } },
  { key: 'jp-tokyo',       label: 'Tokyo, Japan',         lat: 35.6762,  lng: 139.6503, tz: 'Asia/Tokyo',         lang: 'ja-JP', decodo: { country: 'jp', city: 'tokyo' } },
  { key: 'au-sydney',      label: 'Sydney, Australia',    lat: -33.8688, lng: 151.2093, tz: 'Australia/Sydney',   lang: 'en-AU', decodo: { country: 'au', city: 'sydney' } },
  { key: 'ng-lagos',       label: 'Lagos, Nigeria',       lat: 6.5244,   lng: 3.3792,   tz: 'Africa/Lagos',       lang: 'en-NG', decodo: { country: 'ng', city: 'lagos' } },
  { key: 'za-johannesburg', label: 'Johannesburg, South Africa', lat: -26.2041, lng: 28.0473, tz: 'Africa/Johannesburg', lang: 'en-ZA', decodo: { country: 'za', city: 'johannesburg' } }
];

const CITY_BY_KEY = new Map(CITIES.map((c) => [c.key, c]));

/**
 * Resolve a location descriptor into a normalized object usable by the proxy
 * builder and the geolocation override.
 *
 * @param {object} loc  Either { key } for a preset, or a custom
 *                      { custom:true, label, lat, lng, tz, lang, decodo } object,
 *                      or { direct:true } for a no-proxy tab.
 */
function nearestCity(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function resolveLocation(loc) {
  if (!loc || loc.direct) {
    return { direct: true, label: 'Direct (no proxy)' };
  }
  // Auto mode: the browser geolocation is filled in later from the real exit IP,
  // so IP-geo and GPS-geo always agree. Coords are unknown until the IP resolves.
  if (loc.auto) {
    const cc = loc.decodo && loc.decodo.country;
    return {
      auto: true,
      label: cc ? `Auto · ${String(cc).toUpperCase()}` : 'Auto (match IP)',
      lat: null,
      lng: null,
      tz: null,
      lang: loc.lang || 'en-US',
      decodo: loc.decodo || {}
    };
  }
  if (loc.custom) {
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    // If no proxy country was given, target the country of the nearest known city
    // so the exit IP at least lands in the right region as the coordinates.
    let decodo = loc.decodo || {};
    if (!decodo.country) {
      const near = nearestCity(lat, lng);
      if (near && near.decodo.country) decodo = { ...decodo, country: near.decodo.country };
    }
    return {
      custom: true,
      label: loc.label || `${lat}, ${lng}`,
      lat,
      lng,
      tz: loc.tz || 'UTC',
      lang: loc.lang || 'en-US',
      decodo
    };
  }
  const preset = CITY_BY_KEY.get(loc.key);
  if (!preset) {
    return { direct: true, label: 'Direct (no proxy)' };
  }
  return { ...preset };
}

function listCities() {
  return CITIES.map(({ key, label, lat, lng, tz, decodo }) => ({
    key,
    label,
    lat,
    lng,
    tz,
    country: decodo.country || null
  }));
}

module.exports = { CITIES, resolveLocation, listCities };
