// Vercel serverless proxy for football-data.org (v4) -> normalized World Cup 2026 events.
//
// Setup:
//   1. Get a free key at https://www.football-data.org/client/register
//      (free tier: 10 requests/min, World Cup included; scores are lightly delayed)
//   2. In your Vercel project: Settings -> Environment Variables ->
//        Name: FOOTBALL_DATA_KEY   Value: <your token>
//   3. Redeploy. The dashboard calls /api/scores automatically.
//
// Edge-cached (~60s) so the upstream API is hit at most ~once/min — well under 10/min.
//
// Diagnostics: GET /api/scores?debug=1 returns the upstream HTTP status, the
// football-data rate-limit headers, raw vs mapped match counts, and a sample of any
// team names that failed to map — without falling back to cache. Use it to see exactly
// why the feed is empty (throttled 429, restricted 403, or an unmapped-name drop).

const API = 'https://api.football-data.org/v4';
const COMP = 'WC';        // FIFA World Cup competition code
const SEASON = 2026;

// football-data.org team name (normalized) -> TheSportsDB team id (matches the dashboard roster)
const NAME_TO_ID = {
  mexico:134497, southafrica:136482, southkorea:134517, korearepublic:134517,
  czechrepublic:133904, czechia:133904, canada:140073,
  bosniaandherzegovina:134510, bosniaherzegovina:134510, qatar:136472, switzerland:134506,
  brazil:134496, morocco:136139, haiti:140175, scotland:136450,
  usa:134514, unitedstates:134514, unitedstatesofamerica:134514,
  paraguay:136471, australia:134500, turkey:135985, turkiye:135985,
  germany:133907, curacao:140271, ivorycoast:134502, cotedivoire:134502, ecuador:134507,
  netherlands:133905, japan:134503, sweden:133916, tunisia:136142,
  belgium:134515, egypt:136138, saudiarabia:136137, uruguay:134504,
  spain:133909, capeverde:136477, caboverde:136477, capeverdeislands:136477, iran:134511, iriran:134511, irislamicrepublicofiran:134511,
  newzealand:137449, france:133913, senegal:136143, iraq:140148, norway:136516,
  argentina:134509, algeria:134516, austria:135986, jordan:140145,
  england:133914, croatia:133912, ghana:134513, panama:136141,
  portugal:133908, drcongo:136475, congodr:136475, democraticrepublicofcongo:136475,
  uzbekistan:140151, colombia:134501
};

// TheSportsDB team id -> group letter (fallback if the feed omits the group)
const GROUP_OF = {
  134497:'A',136482:'A',134517:'A',133904:'A', 140073:'B',134510:'B',136472:'B',134506:'B',
  134496:'C',136139:'C',140175:'C',136450:'C', 134514:'D',136471:'D',134500:'D',135985:'D',
  133907:'E',140271:'E',134502:'E',134507:'E', 133905:'F',134503:'F',133916:'F',136142:'F',
  134515:'G',136138:'G',134511:'G',137449:'G', 136137:'H',134504:'H',133909:'H',136477:'H',
  133913:'I',136143:'I',140148:'I',136516:'I', 134509:'J',134516:'J',135986:'J',140145:'J',
  133908:'K',136475:'K',140151:'K',134501:'K', 133914:'L',133912:'L',134513:'L',136141:'L'
};

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const idOf = name => NAME_TO_ID[norm(name)] || null;

// football-data stage -> our intRound (group matchdays must be "1","2","3")
function stageRound(stage, matchday) {
  switch ((stage || '').toUpperCase()) {
    case 'GROUP_STAGE': return String(matchday || '');
    case 'LAST_32': return 'R32';
    case 'LAST_16': return 'R16';
    case 'QUARTER_FINALS': return 'QF';
    case 'SEMI_FINALS': return 'SF';
    case 'THIRD_PLACE':
    case 'THIRD_PLACE_FINAL':
    case '3RD_PLACE_FINAL': return 'TP';
    case 'FINAL': return 'FIN';
    default: return 'KO';
  }
}
// football-data status -> dashboard status (FT finished, 2H/HT live, NS upcoming)
function statusMap(s) {
  s = (s || '').toUpperCase();
  if (s === 'FINISHED' || s === 'AWARDED') return 'FT';
  if (s === 'IN_PLAY') return '2H';
  if (s === 'PAUSED') return 'HT';
  return 'NS';
}
const groupLetter = g => { const m = (g || '').match(/group[_ ]?([a-l])/i); return m ? m[1].toUpperCase() : ''; };

// Read football-data.org's rate-limit headers (used for automatic throttling).
//   X-Requests-Available-Minute : requests remaining in the current minute window
//   X-RequestCounter-Reset      : seconds until that window resets
function readLimits(r) {
  const get = n => { try { return r.headers.get(n); } catch (e) { return null; } };
  const rem = get('X-Requests-Available-Minute');
  const reset = get('X-RequestCounter-Reset');
  return {
    remaining: rem == null || rem === '' ? null : parseInt(rem, 10),
    reset: reset == null || reset === '' ? null : parseInt(reset, 10)
  };
}

function mapMatches(arr) {
  let dropped = 0;
  const unmapped = [];
  const events = arr.map(m => {
    const hName = m.homeTeam && m.homeTeam.name;
    const aName = m.awayTeam && m.awayTeam.name;
    const hId = idOf(hName), aId = idOf(aName);
    const intRound = stageRound(m.stage, m.matchday);
    const isGroup = ['1', '2', '3'].includes(intRound);
    const ft = (m.score && m.score.fullTime) || {};
    const st = statusMap(m.status);
    if (!hId || !aId) { dropped++; if (unmapped.length < 12) unmapped.push({ home: hName, away: aName, stage: m.stage }); }
    return {
      idEvent: String(m.id),
      strHomeTeam: hName, strAwayTeam: aName,
      idHomeTeam: hId, idAwayTeam: aId,
      strHomeTeamBadge: (m.homeTeam && m.homeTeam.crest) || '',
      strAwayTeamBadge: (m.awayTeam && m.awayTeam.crest) || '',
      intHomeScore: ft.home == null ? null : String(ft.home),
      intAwayScore: ft.away == null ? null : String(ft.away),
      strStatus: st,
      strTimestamp: m.utcDate || null,
      dateEvent: (m.utcDate || '').slice(0, 10),
      intRound: intRound,
      strGroup: isGroup ? (groupLetter(m.group) || GROUP_OF[hId] || GROUP_OF[aId] || '') : '',
      strVenue: m.venue || '', strCity: ''
    };
  }).filter(e => e.idHomeTeam && e.idAwayTeam);
  return { events, dropped, unmapped };
}

// 2026 host stadium -> "City, REGION". The region code feeds the dashboard's VENUE_TZ
// map so the "Next kickoff" card can show the venue-local time. football-data.org's free
// tier returns no venue/city, so we enrich each match with the stadium TheSportsDB lists.
const STADIUM_CITY = {
  'Estadio Azteca':'Mexico City, MX', 'Estadio Akron':'Zapopan, JA', 'Estadio BBVA':'Guadalupe, NL',
  'BMO Field':'Toronto, ON', 'BC Place':'Vancouver, BC',
  'SoFi Stadium':'Inglewood, CA', "Levi's Stadium":'Santa Clara, CA', 'Lumen Field':'Seattle, WA',
  'MetLife Stadium':'East Rutherford, NJ', 'Gillette Stadium':'Foxborough, MA',
  'Lincoln Financial Field':'Philadelphia, PA', 'Hard Rock Stadium':'Miami Gardens, FL',
  'Mercedes-Benz Stadium':'Atlanta, GA', 'AT&T Stadium':'Arlington, TX',
  'Reliant Stadium':'Houston, TX', 'NRG Stadium':'Houston, TX',
  'GEHA Field at Arrowhead Stadium':'Kansas City, MO', 'Arrowhead Stadium':'Kansas City, MO'
};

// Venue/city by team-pair, sourced from TheSportsDB (which has the venue football-data omits).
// Cached for 6h since fixtures/venues don't change mid-tournament; failures are non-fatal.
// Use the per-round endpoint, NOT eventsseason: on the free tier eventsseason returns only the
// few most recently played matches, so it never has the (upcoming) match shown in "Next kickoff".
// eventsround returns every fixture in the round — including upcoming ones — with strCity present.
const VENUE_ROUNDS = [1, 2, 3]; // group matchdays; KO venues join automatically once teams are drawn
const GROUP_MATCH_COUNT = 72;   // all 72 group fixtures must be present before we trust/cache the map
let venueCache = { t: 0, byPair: null };
async function getVenues() {
  if (venueCache.byPair && Date.now() - venueCache.t < 6 * 3600 * 1000) return venueCache.byPair;
  try {
    // Fetch the rounds in parallel; a single round failing must not poison the whole map.
    const results = await Promise.all(VENUE_ROUNDS.map(rnd =>
      fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsround.php?id=4429&s=2026&r=${rnd}`)
        .then(r => r.json()).catch(() => null)
    ));
    const byPair = {};
    for (const j of results) {
      const arr = j && Array.isArray(j.events) ? j.events : [];
      for (const e of arr) {
        if (!e.idHomeTeam || !e.idAwayTeam) continue;
        const venue = e.strVenue || '';
        const city = e.strCity || STADIUM_CITY[venue] || '';
        if (city) byPair[`${e.idHomeTeam}-${e.idAwayTeam}`] = { strVenue: venue, strCity: city };
      }
    }
    // Only cache once the set is complete; a partial fetch is used for THIS response but not
    // frozen for 6h, so the next request retries instead of leaving some games without a city.
    if (Object.keys(byPair).length >= GROUP_MATCH_COUNT) venueCache = { t: Date.now(), byPair };
    return Object.keys(byPair).length ? byPair : (venueCache.byPair || {});
  } catch (e) { return venueCache.byPair || {}; }
}

let cache = { t: 0, data: null };                 // last good payload (events present)
let limitState = { remaining: null, reset: null, at: 0 }; // last seen rate-limit state

module.exports = async (req, res) => {
  const debug = !!(req.url && /[?&]debug=1\b/.test(req.url));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'FOOTBALL_DATA_KEY not set', events: [] }));
  }

  // Serve fresh in-memory cache (within 45s) to spare the upstream quota.
  if (!debug && cache.data && Date.now() - cache.t < 45 * 1000) {
    res.setHeader('X-Cache', 'hit');
    return res.end(JSON.stringify(cache.data));
  }

  // Automatic throttling: if the last upstream call reported zero requests left and the
  // reset window hasn't elapsed, don't call upstream again — serve the last good data.
  if (!debug && limitState.remaining === 0 && cache.data) {
    const elapsed = (Date.now() - limitState.at) / 1000;
    const window = limitState.reset || 60;
    if (elapsed < window) {
      res.setHeader('X-Cache', 'stale-throttled');
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(window - elapsed))));
      return res.end(JSON.stringify(cache.data));
    }
  }

  try {
    const r = await fetch(`${API}/competitions/${COMP}/matches?season=${SEASON}`, {
      headers: { 'X-Auth-Token': key }
    });
    const limits = readLimits(r);
    limitState = { remaining: limits.remaining, reset: limits.reset, at: Date.now() };
    if (limits.remaining != null) res.setHeader('X-Requests-Available-Minute', String(limits.remaining));
    if (limits.reset != null) res.setHeader('X-RequestCounter-Reset', String(limits.reset));

    const text = await r.text();
    let j = {};
    try { j = JSON.parse(text); } catch (e) {}

    // Upstream error (429 throttled / 403 restricted / 4xx-5xx) — surface it instead of
    // silently returning empty, which is what made the dashboard fall back to TheSportsDB.
    if (!r.ok) {
      if (r.status === 429 && limits.reset) res.setHeader('Retry-After', String(limits.reset));
      const info = {
        error: 'football-data.org returned HTTP ' + r.status,
        upstreamStatus: r.status,
        upstreamMessage: (j && j.message) || text.slice(0, 300),
        rateLimit: limits,
        events: (cache.data && cache.data.events) || []
      };
      if (cache.data && !debug) { res.setHeader('X-Cache', 'stale-error'); return res.end(JSON.stringify(cache.data)); }
      res.statusCode = debug ? 200 : 502;
      return res.end(JSON.stringify(info));
    }

    const arr = Array.isArray(j.matches) ? j.matches : [];
    const { events, dropped, unmapped } = mapMatches(arr);

    // Enrich with venue/city from TheSportsDB so the "Next kickoff" card can show the
    // venue-local time (football-data omits venue). Joined by team-pair; non-fatal.
    const venues = await getVenues();
    let venued = 0;
    for (const ev of events) {
      const v = venues[`${ev.idHomeTeam}-${ev.idAwayTeam}`] || venues[`${ev.idAwayTeam}-${ev.idHomeTeam}`];
      if (v) { if (v.strVenue) ev.strVenue = v.strVenue; if (v.strCity) ev.strCity = v.strCity; if (v.strCity) venued++; }
    }

    const out = {
      events, source: 'football-data.org', updated: new Date().toISOString(),
      count: events.length, raw: arr.length, dropped, venued, rateLimit: limits
    };
    if (events.length) cache = { t: Date.now(), data: out };

    if (debug) {
      res.setHeader('X-Cache', 'miss');
      return res.end(JSON.stringify({ ...out, unmappedSample: unmapped }, null, 2));
    }
    // Got a 200 but nothing usable (e.g. all names unmapped, or no matches yet):
    // fall back to last good data rather than returning an empty feed.
    if (!events.length && cache.data) { res.setHeader('X-Cache', 'stale-empty'); return res.end(JSON.stringify(cache.data)); }
    return res.end(JSON.stringify(out));
  } catch (e) {
    if (cache.data) { res.setHeader('X-Cache', 'stale-exception'); return res.end(JSON.stringify(cache.data)); }
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: String(e), events: [] }));
  }
};
