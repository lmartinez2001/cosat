// CelesTrak GP "groups" we pull, and the astrological "domain" each one rules.
// Order matters: it is also the fetch order (small, important groups first so
// the app is usable before the 11k-object Starlink file arrives).
module.exports = [
  { id: 'stations',     label: 'Space stations',        domain: 'self' },
  { id: 'weather',      label: 'Weather',               domain: 'spirit' },
  { id: 'gps-ops',      label: 'GPS',                   domain: 'routine' },
  { id: 'galileo',      label: 'Galileo',               domain: 'routine' },
  { id: 'glo-ops',      label: 'GLONASS',               domain: 'routine' },
  { id: 'beidou',       label: 'BeiDou',                domain: 'routine' },
  { id: 'science',      label: 'Science',               domain: 'mind' },
  { id: 'iridium-NEXT', label: 'Iridium',               domain: 'love' },
  { id: 'globalstar',   label: 'Globalstar',            domain: 'love' },
  { id: 'planet',       label: 'Planet imaging',        domain: 'work' },
  { id: 'spire',        label: 'Spire',                 domain: 'work' },
  { id: 'geo',          label: 'Geostationary',         domain: 'money' },
  { id: 'last-30-days', label: 'Launched this month',   domain: 'change' },
  { id: 'amateur',      label: 'Amateur radio',         domain: 'mind' },
  { id: 'military',     label: 'Military',              domain: 'shadow' },
  { id: 'oneweb',       label: 'OneWeb',                domain: 'social' },
  { id: 'starlink',     label: 'Starlink',              domain: 'social' },
];
