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
  spain:133909, capeverde:136477, caboverde:136477, iran:134511, iriran:134511, irislamicrepublicofiran:134511,
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

let cache = { t: 0, data: null };

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'FOOTBALL_DATA_KEY not set', events: [] }));
  }
  if (cache.data && Date.now() - cache.t < 45 * 1000) {
    return res.end(JSON.stringify(cache.data));
  }

  try {
    const r = await fetch(`${API}/competitions/${COMP}/matches?season=${SEASON}`, {
      headers: { 'X-Auth-Token': key }
    });
    const j = await r.json();
    const arr = Array.isArray(j.matches) ? j.matches : [];

    const events = arr.map(m => {
      const hName = m.homeTeam && m.homeTeam.name;
      const aName = m.awayTeam && m.awayTeam.name;
      const hId = idOf(hName), aId = idOf(aName);
      const intRound = stageRound(m.stage, m.matchday);
      const isGroup = ['1', '2', '3'].includes(intRound);
      const ft = (m.score && m.score.fullTime) || {};
      const st = statusMap(m.status);
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

    const out = { events, source: 'football-data.org', updated: new Date().toISOString(), count: events.length };
    if (events.length) cache = { t: Date.now(), data: out };
    return res.end(JSON.stringify(out));
  } catch (e) {
    if (cache.data) return res.end(JSON.stringify(cache.data));
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: String(e), events: [] }));
  }
};
