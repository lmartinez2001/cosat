// Report generator. Everything here is deterministic given (birth, today,
// live sky), so the copy stays stable across a day while the numbers move.
import { zodiacSign } from './astro.js';

export const CATEGORIES = [
  { key: 'self',    title: 'Self',                  groups: ['stations'],                                  ruler: 'space stations' },
  { key: 'mind',    title: 'Thinking & creativity', groups: ['science', 'amateur'],                        ruler: 'science & amateur satellites' },
  { key: 'love',    title: 'Love',                  groups: ['iridium-NEXT', 'globalstar'],                ruler: 'Iridium & Globalstar' },
  { key: 'social',  title: 'Social life',           groups: ['starlink', 'oneweb'],                        ruler: 'Starlink & OneWeb' },
  { key: 'routine', title: 'Routine',               groups: ['gps-ops', 'galileo', 'glo-ops', 'beidou'],   ruler: 'GPS, Galileo, GLONASS, BeiDou' },
  { key: 'work',    title: 'Work',                  groups: ['planet', 'spire'],                           ruler: 'Earth-imaging satellites' },
  { key: 'money',   title: 'Money',                 groups: ['geo'],                                       ruler: 'geostationary satellites' },
  { key: 'spirit',  title: 'Spirituality',          groups: ['weather'],                                   ruler: 'weather satellites' },
  { key: 'change',  title: 'Change',                groups: ['last-30-days'],                              ruler: 'objects launched this month' },
];

const LINES = {
  self: {
    power: ['A crewed station is above your horizon. Someone up there is doing 16 sunrises a day and still finds time to journal. What is your excuse.', 'The ISS is watching you, technically. Act like someone worth a 400 km glance.', 'You are unusually visible from orbit today. Stand up straight.'],
    pressure: ['No station overhead. Nobody is watching. This is either freedom or the problem.', 'The only humans in space are on the other side of the planet. Sit with that.', 'Your sky is empty of crews. Be your own crew. Run your own checklist.'],
    trouble: ['Two stations are almost in conjunction over you. Your sense of self is being double-booked.', 'Station traffic is crossing your zenith. Do not make decisions about your hair today.', 'Something crewed is directly overhead. Whatever you are avoiding, they can see it.'],
    neutral: ['A normal amount of humans are above you. Proceed at a normal amount.', 'Stations pass, you stay. That is the whole lesson.', 'The ISS orbits every 93 minutes. You have been thinking about the same thing for longer than that.'],
  },
  mind: {
    power: ['Unusually many science satellites overhead. Your ideas are being peer-reviewed by instruments. Write them down anyway.', 'The telescopes are aligned with you. Read something difficult.', 'Amateur radio satellites are dense over your sky. Somebody wants to talk to you at 145.8 MHz. Let them.'],
    pressure: ['The science is elsewhere. Your best idea today will be someone else\'s, which is fine.', 'Few instruments overhead. Nobody is measuring you. Make something unmeasurable.', 'Low scientific coverage. Trust your gut, since the data is out of range anyway.'],
    trouble: ['Two research satellites are nearly touching in your sky. Your thoughts are cross-contaminating. That is called creativity.', 'A science mission is at your zenith, pointed away from you. Relatable.', 'Conjunction in the house of instruments. Your inbox will contain a spreadsheet that ruins your afternoon.'],
    neutral: ['Average instrumentation overhead. Average thoughts are allowed.', 'Something with a spectrometer is above you. It is not judging you. It is judging aerosols.', 'The amateur satellites are quiet. Take the hint.'],
  },
  love: {
    power: ['Iridium overhead. Somebody can reach you from anywhere on Earth and has chosen not to. Or has chosen to. Check.', 'Personal-comms satellites are crowding your sky. Say the thing. The link budget is favorable.', 'The constellation that connects lonely places is above your lonely place. Use it.'],
    pressure: ['Iridium is thin over you. Messages will be delayed. So will feelings.', 'Few relays overhead. Whatever you send today will bounce. Send it anyway, later.', 'The satellites that carry voices are elsewhere. Text is not the same. You know this.'],
    trouble: ['Two relay satellites in near-conjunction. Someone is about to hear something meant for someone else.', 'A Globalstar bird is at your zenith, which is very direct of it. Be less direct.', 'Crossed links over your sky. Do not reply-all with your heart.'],
    neutral: ['Normal relay coverage. Normal amount of unread messages. You can leave them.', 'Iridium flares are a thing of the past. So is most of what you are still thinking about.', 'Love is a bent-pipe transponder: it repeats whatever it is given. Mind what you give.'],
  },
  social: {
    power: ['{n} Starlinks are above your horizon. That is more friends than you have and they all want the same thing: bandwidth.', 'Your sky is full of Starlink. Everyone is online. Nobody is present. Be the exception.', 'A megaconstellation is flexing over you. You could go to the party. You could also not.'],
    pressure: ['Fewer Starlinks than usual overhead. The group chat will be quiet. Enjoy it.', 'Low broadband coverage in your sky. Meet someone in person. Recall how.', 'The constellation is thin above you. So is your patience for plans. Cancel one.'],
    trouble: ['Two Starlinks are practically kissing over your head. You will be tagged in something.', 'Conjunction in the megaconstellation. A minor social collision is being computed. Maneuver early.', 'A Starlink is at your zenith. Someone is refreshing your profile. Do not refresh theirs.'],
    neutral: ['Expected number of Starlinks overhead. Expected number of people will text "u up".', 'Standard Starlink density. Your social life is nominal. Nominal is not nothing.', 'The constellation passes at 7.6 km/s. So does the urge to reply. Let both go.'],
  },
  routine: {
    power: ['Excellent GNSS geometry above you. You know exactly where you are, for once. Do not waste it.', 'Four constellations are giving you sub-metre certainty. Apply it to something other than a map.', 'Navigation satellites are stacked over your sky. Today, directions come easy. Ask for them.'],
    pressure: ['Poor navigation geometry. You will take a wrong turn and pretend it was the plan.', 'GNSS is thin. Your position is uncertain by a few metres and a few years.', 'The satellites that tell you where you are are busy elsewhere. Guess.'],
    trouble: ['Two navigation satellites are nearly conjunct. Your sense of direction is being triangulated by people who disagree.', 'A GPS bird at your zenith. Every step you take today is being timed. Walk normally.', 'Conjunction in the house of routine. Your alarm will go off at the wrong right time.'],
    neutral: ['Normal navigation coverage. You will get where you are going, roughly on time, roughly yourself.', 'Atomic clocks overhead, accurate to a nanosecond. Your calendar is not.', 'The GPS constellation repeats every sidereal day. So do you. That is not an insult.'],
  },
  work: {
    power: ['Unusually many imaging satellites overhead. Your desk is in a 3 m-per-pixel image somewhere. Tidy it.', 'The Earth-observation fleet is over you. Whatever you are pretending to do, do it convincingly.', 'Someone is imaging your city at high revisit rate. Productivity is a performance. Perform.'],
    pressure: ['Few cameras overhead. Nobody is watching your work. This is when the good work happens.', 'The imaging fleet is elsewhere. Take the long lunch. It will not be in the dataset.', 'Low observation coverage. Your afternoon is unrecorded. Make it count or do not.'],
    trouble: ['Two imaging satellites are conjunct. Your workplace is about to be photographed from two angles. Coordinate your story.', 'A Planet Dove at your zenith. Your open tabs are, morally, visible.', 'Conjunction in the house of work. An email that begins with "per my last" is inbound.'],
    neutral: ['Standard imaging coverage. Your work will be seen exactly as much as it deserves.', 'Doves overhead, weather satellites nearby. It is a good day to look busy near a window.', 'The imaging satellites do 15 orbits a day. Your to-do list does zero. Move one thing.'],
  },
  money: {
    power: ['Many geostationary satellites hang over you, fixed and patient. Money likes stillness this week. Do not touch it.', 'The GEO belt is bright above your horizon. Long-term instruments favor you. Short-term ones do not care.', 'A wall of television satellites is over you. Somebody is getting paid for every channel. Ask why not you.'],
    pressure: ['Few GEO satellites visible. Cash flow is at low elevation. Do not look directly at it.', 'The geostationary belt is barely above your horizon. So is your budget. Both are stable, technically.', 'Poor GEO coverage. The invoice you are waiting for is in a transfer orbit.'],
    trouble: ['Two geostationary satellites are in near-conjunction, which, for things that are not supposed to move, is alarming. Check your subscriptions.', 'A GEO satellite is unusually high in your sky. Something fixed is about to move. Read the terms.', 'Conjunction in the belt. A recurring charge you forgot about has remembered you.'],
    neutral: ['The geostationary belt is where it always is, doing what it always does. So is your rent.', 'GEO satellites do not move relative to you. Neither does your savings rate. One of these is a design choice.', 'Money is a geostationary problem: too far to touch, always there, mostly television.'],
  },
  spirit: {
    power: ['Weather satellites crowd your sky. Every cloud over you is accounted for. Your feelings are not. That is fine.', 'The meteorological fleet is above you. Look up: someone is forecasting exactly this moment, and getting it right.', 'High weather coverage. The heavens are being monitored in 16 spectral bands. Take a walk under them.'],
    pressure: ['Few weather satellites overhead. The clouds over you are unsupervised. Same.', 'The sky above you is under-observed. Whatever you feel is unforecast. Feel it anyway.', 'Meteorological coverage is low. Nobody knows if it will rain on you. Nobody ever did.'],
    trouble: ['Two weather satellites nearly conjunct. Two forecasts will disagree about you today. Both will be right.', 'A weather satellite is at your zenith, measuring water vapour. You are 60% water. It knows.', 'Conjunction in the house of weather. A mood front is moving through. Do not make it a system.'],
    neutral: ['Normal weather coverage. Normal weather. Normal you. The pressure is 1013 hPa and so are you.', 'The polar orbiters cross your sky twice a day, like doubt.', 'Weather satellites see clouds, not you. That is the definition of grace.'],
  },
  change: {
    power: ['Unusually many freshly launched objects overhead. Something new is orbiting your life. It has not been catalogued yet.', 'This month\'s launches are over you. Beginnings have momentum. Match it.', 'New objects are dense in your sky. Whatever you started recently has not decayed. Keep it up there.'],
    pressure: ['Few new launches overhead. Nothing changes today, which you will call stability.', 'Low freshness in your sky. The new thing is over someone else. Wait for the next pass.', 'Nothing recently launched is above you. Your routine is safe. Your growth is not.'],
    trouble: ['Two objects launched this month are nearly conjunct over you. Two new things are going to collide. Pick one.', 'A brand-new satellite at your zenith. Change is directly overhead. Look up, then do the thing.', 'Conjunction in the house of change. You will hear from someone you met last month.'],
    neutral: ['The usual trickle of new objects overhead. Small changes, daily. Compounding, like drag.', 'Something launched this month is crossing your sky. It does not know what it is yet. Neither do you. Fine.', 'New satellites, same orbit. Novelty is a plane change: expensive, and mostly unnecessary.'],
  },
};

const DO = [
  'Look {dir} at {t}: {sat} climbs over your horizon. Pretend you meant to be outside.',
  'Text the person you thought about when {sat} passed overhead. You did think about someone.',
  'Turn off location services for one hour. Let {gnss} navigation satellites miss you.',
  'Say "nominal" instead of "fine" once today.',
  'Walk in a straight line for 7.6 seconds. That is how far a Starlink goes in one second.',
  'Delete a screenshot. Debris mitigation starts at home.',
  'Look up at {t}. Something is looking down. Make eye contact with the idea of it.',
  'Drink water. Weather satellites are measuring it anyway.',
  'Reply to the {n}-day-old message. It has completed {orbits} orbits of your mind.',
  'Schedule something for exactly {t}. Be the satellite.',
  'Stand outside during the next ISS pass. Wave. They cannot see you. Wave anyway.',
  'Write down what you would do if nobody in orbit could see you. Then do the boring version.',
  'Recalibrate: say one true sentence out loud, to no one.',
  'Take the long way. Your natal satellite took {orbitsLife} orbits to get here.',
];
const DONT = [
  'Do not start a group chat while {starlinks} Starlinks are overhead. The bandwidth is a trap.',
  'Do not check the app again to see if your rising sign changed. It did.',
  'Do not explain orbital mechanics at dinner. You will be right and alone.',
  'Do not make a decision between {t} and {t2}. {sat} will be at zenith and you will feel watched.',
  'Do not send the long message. Send the short one. Transponders prefer it.',
  'Do not compare yourself to a geostationary satellite. It has a job for life and no free will.',
  'Do not re-read the thread. It is debris. Let it decay.',
  'Do not buy anything that says "quantum".',
  'Do not answer "where are you" literally, even though {gnss} satellites know to the metre.',
  'Do not schedule anything for the next {mins} minutes. {sat} is setting and so is your patience.',
  'Do not confuse being visible with being seen. {imaging} imaging satellites make this mistake constantly.',
  'Do not apologise for taking up space. There are {total} objects doing it right now, unpaid.',
  'Do not look for a sign. You have {above} of them above the horizon. Pick one.',
];

const GLANCE = [
  'Right now {above} of the {total} objects we track are above your horizon. {sunSat} sits nearest the Sun, {moonSat} shadows the {phase} Moon ({illum}% lit), and {risingSat} is climbing over your {risingDir} horizon at {risingRate}° per minute. {dominant} {element}',
  '{above} things are over your head, out of {total} we follow. Your sky is ruled by {dominantGroup} today. {sunSat} rides with the Sun, {moonSat} with the Moon, and {risingSat} is rising in the {risingDir}. {element}',
  'You are being passed over by {above} artificial objects at this moment. The Sun is escorted by {sunSat}; the {phase} Moon by {moonSat}. {risingSat} is coming up in the {risingDir}, which means whatever you are avoiding is also coming up. {element}',
];

const DOMINANT = {
  social: 'The megaconstellations own your sky today: everyone is reachable and nobody is available.',
  routine: 'Navigation satellites dominate: you will know exactly where you are and still feel lost.',
  money: 'The geostationary belt dominates: nothing moves, and that is the point.',
  spirit: 'Weather satellites dominate: the mood is a front, not a fact.',
  work: 'Imaging satellites dominate: assume you are in the picture.',
  mind: 'Science satellites dominate: measure twice, feel once.',
  love: 'Relay satellites dominate: whatever you say will arrive, slightly delayed, to the right person.',
  self: 'A crewed station dominates: someone is literally above this.',
  change: 'Fresh launches dominate: the new thing has momentum. Do not brake.',
};
const ELEMENT_LINE = {
  fire: 'Your sky is mostly Low Earth Orbit: fast, low, and burning up. You are a fire sign now.',
  air: 'Your sky leans Medium Earth Orbit: high, patient, everywhere at once. You are an air sign now.',
  earth: 'Your sky leans geostationary: fixed, distant, reliable, slightly boring. You are an earth sign now.',
  water: 'Your sky leans eccentric orbits: close then far then close again. You are a water sign now, obviously.',
};

// ---- helpers ----
export function seedFrom(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function fill(t, v) { return t.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? '?')); }
export const dirName = az => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8];
export function prettyName(n) { return n.replace(/\s*\[.*?\]\s*$/, '').replace(/\s*\(.*\)$/, '').replace(/^STARLINK-/, 'Starlink-').replace(/^ONEWEB-/, 'OneWeb-').replace(/^GALILEO-/, 'Galileo-').replace(/^NAVSTAR/, 'Navstar').replace(/^COSMOS/, 'Cosmos').replace(/^METEOSAT/, 'Meteosat').replace(/^FLOCK/, 'Flock'); }

export function tagFor(above, expected, conj, zenith) {
  if (conj || zenith) return 'trouble';
  const exp = Math.max(expected, 0.6);
  const ratio = above / exp;
  if (above > 0 && ratio >= 1.25) return 'power';
  if (ratio <= 0.75) return 'pressure';
  return 'neutral';
}

export function buildReport(ctx) {
  // ctx: { name, birth:{date,time}, today, sky:{above,total,sun,moon,rising,dominant,elements}, cats:[{key,above,expected,conj,zenith}], counts:{...} }
  const seed = seedFrom(`${ctx.birth.date}|${ctx.birth.time}|${ctx.name}|${ctx.today}`);
  const r = rng(seed);
  const s = ctx.sky;
  const noRise = !s.rising || s.rising.i < 0;
  const vars = {
    above: s.above, total: s.total, sunSat: s.sun.name, moonSat: s.moon.name, risingSat: noRise ? 'nothing in particular' : s.rising.name, risingDir: dirName(s.rising.az), risingRate: noRise ? '0.0' : (s.rising.rate * 60).toFixed(1),
    phase: s.moon.phase.toLowerCase(), illum: Math.round(s.moon.illum * 100), dominant: DOMINANT[s.dominant] || '', dominantGroup: CATEGORIES.find(c => c.key === s.dominant)?.ruler || 'nothing in particular',
    element: ELEMENT_LINE[s.element], sat: noRise ? s.sun.name : s.rising.name, dir: dirName(s.rising.az), t: s.tNext, t2: s.tNext2, gnss: ctx.counts.routine, starlinks: ctx.counts.social, imaging: ctx.counts.work,
    n: 3 + Math.floor(r() * 9), orbits: 40 + Math.floor(r() * 300), mins: 4 + Math.floor(r() * 20), orbitsLife: ctx.orbitsLife || '—',
  };
  const glance = fill(pick(r, GLANCE), vars);
  const dos = shuffle(r, DO).slice(0, 3).map(t => fill(t, vars));
  const donts = shuffle(r, DONT).slice(0, 3).map(t => fill(t, vars));
  const categories = CATEGORIES.map(c => {
    const d = ctx.cats[c.key];
    const tag = tagFor(d.above, d.expected, d.conj, d.zenith);
    const line = fill(pick(r, LINES[c.key][tag]), { ...vars, n: d.above });
    return { ...c, tag, line, above: d.above, expected: d.expected, conj: d.conj, zenith: d.zenith };
  });
  const zod = zodiacSign(+ctx.birth.date.slice(5, 7), +ctx.birth.date.slice(8, 10));
  return { glance, dos, donts, categories, zodiac: zod };
}
function shuffle(r, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function natalCopy(natal, birth, r) {
  if (!natal || !natal.objects.length) return { lead: 'Nothing was launched anywhere near your birthday. You are, orbitally speaking, self-made.', list: [] };
  const objs = natal.objects;
  const payloads = objs.filter(o => o.type === 'PAY');
  const main = payloads[0] || objs[0];
  const alive = !main.decay;
  const yrs = Math.max(0, (Date.now() - new Date(main.launch)) / (365.25 * 86400000));
  const orbitsLife = main.period ? Math.round(yrs * 365.25 * 1440 / main.period) : null;
  const when = natal.offsetDays === 0 ? 'On the day you were born' : `${Math.abs(natal.offsetDays)} day${Math.abs(natal.offsetDays) > 1 ? 's' : ''} ${natal.offsetDays < 0 ? 'before' : 'after'} you were born`;
  let lead = `${when}, ${objs.length === 1 ? 'one object was' : objs.length + ' objects were'} launched into orbit from ${uniq(objs.map(o => o.siteName)).join(' and ')}. `;
  lead += `Your natal satellite is ${prettyName(main.name)}, a ${main.typeName} launched by ${main.ownerName}. `;
  if (alive) lead += `It is still in orbit ${yrs.toFixed(0)} years later${orbitsLife ? `, ${orbitsLife.toLocaleString()} revolutions in` : ''}. Your capacity for commitment is, frankly, orbital.`;
  else { const dy = Math.max(0, (new Date(main.decay) - new Date(main.launch)) / (365.25 * 86400000)); lead += `It re-entered on ${main.decay}, after ${dy < 1 ? Math.round(dy * 365) + ' days' : dy.toFixed(1) + ' years'}. That is roughly how long you hold a grudge.`; }
  return { lead, list: objs, main, orbitsLife };
}
function uniq(a) { return [...new Set(a)]; }
