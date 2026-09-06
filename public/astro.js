// Minimal celestial mechanics for the parody: Sun and Moon positions (low
// precision, a few tenths of a degree — plenty for "which satellite is nearest
// the Moon"), sidereal time and equatorial → horizontal conversion.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = x => ((x % 360) + 360) % 360;

export function julianDay(date) { return date.getTime() / 86400000 + 2440587.5; }

export function gmstDeg(date) {
  const n = julianDay(date) - 2451545.0;
  return norm360(280.46061837 + 360.98564736629 * n);
}

function eclipticToEquatorial(lonDeg, latDeg, n) {
  const eps = (23.439 - 0.0000004 * n) * D2R, l = lonDeg * D2R, b = latDeg * D2R;
  const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
  return { ra: norm360(ra * R2D), dec: dec * R2D };
}

export function sunPosition(date) {
  const n = julianDay(date) - 2451545.0;
  const L = norm360(280.460 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * D2R;
  const lon = norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  return { eclLon: lon, ...eclipticToEquatorial(lon, 0, n) };
}

export function moonPosition(date) {
  const n = julianDay(date) - 2451545.0;
  const Lp = norm360(218.316 + 13.176396 * n);
  const Mp = norm360(134.963 + 13.064993 * n) * D2R;
  const F = norm360(93.272 + 13.229350 * n) * D2R;
  const lon = norm360(Lp + 6.289 * Math.sin(Mp));
  const lat = 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(Mp);
  return { eclLon: lon, eclLat: lat, distKm: dist, ...eclipticToEquatorial(lon, lat, n) };
}

export function moonPhase(date) {
  const e = norm360(moonPosition(date).eclLon - sunPosition(date).eclLon);
  const illum = (1 - Math.cos(e * D2R)) / 2;
  const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  return { elongation: e, illuminated: illum, name: names[Math.floor(((e + 22.5) % 360) / 45)] };
}

// RA/Dec (deg) → azimuth (deg from north, clockwise) / elevation (deg)
export function toHorizontal(raDeg, decDeg, date, latDeg, lonDeg) {
  const H = (gmstDeg(date) + lonDeg - raDeg) * D2R;
  const phi = latDeg * D2R, dec = decDeg * D2R;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H));
  return { az: norm360(az * R2D), el: el * R2D };
}

// Sub-solar point for the day/night terminator on the globe.
export function subSolarPoint(date) {
  const s = sunPosition(date);
  return { lat: s.dec, lon: norm360(s.ra - gmstDeg(date) + 180) - 180 };
}

// Angular separation between two az/el directions (deg).
export function angularSeparation(az1, el1, az2, el2) {
  const a1 = az1 * D2R, e1 = el1 * D2R, a2 = az2 * D2R, e2 = el2 * D2R;
  const c = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
}

// Western zodiac sign of a date (for the "you used to be a Gemini" gag).
export function zodiacSign(month, day) {
  const signs = [['Capricorn', 19], ['Aquarius', 18], ['Pisces', 20], ['Aries', 19], ['Taurus', 20], ['Gemini', 20], ['Cancer', 22], ['Leo', 22], ['Virgo', 22], ['Libra', 22], ['Scorpio', 21], ['Sagittarius', 21], ['Capricorn', 31]];
  return day <= signs[month - 1][1] ? signs[month - 1][0] : signs[month][0];
}
