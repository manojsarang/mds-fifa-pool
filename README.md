# MDS 2026 World Cup Pool Dashboard

A web dashboard (`index.html`) that shows live standings, the pool leaderboard, each player's
squad, group tables, fixtures, and the scoring rules. Live scores come from football-data.org via
a small Vercel serverless function (`api/scores.js`); the browser computes all the pool maths.

## What it does

- **Overview** – current leader, top-3 podium, key stats, and the full pool leaderboard
  (total / group / knockout points, teams still alive, predicted pool winner).
- **Teams & Picks** – a card per player with each of their four teams, group record, points
  contributed, and an In / Out / Champion status.
- **Group Tables** – all 12 group standings (P, W, D, L, GD, Pts) with the pool owner of each team.
- **Fixtures & Results** – live and upcoming matches plus recent results, with owner tags.
- **Scoring Rules** – the pool's point system.

Scoring is automatic: group win = 1, draw = 0.5, loss = 0; knockout win bonuses of
+1 / +2 / +3 / +4 / +3.5 / +5 for R32 / R16 / QF / SF / 3rd place / Final. Picks are matched to
teams by ID, groups are derived from the fixtures, and knockout winners (including penalty
shootouts) are detected automatically by who advances.

## Deploy to Vercel (via GitHub)

1. Get a free token at **https://www.football-data.org/client/register** (free tier: 10 req/min, World Cup included).
2. Create a GitHub repo and add **both** `index.html` and the `api/` folder (`api/scores.js`).
3. Go to vercel.com, **Add New… → Project**, and import the repo. Framework preset: **Other**;
   leave the build command empty and output directory as the repo root.
4. In the Vercel project: **Settings → Environment Variables**, add
   `FOOTBALL_DATA_KEY` = your token, then **Deploy**.
5. Vercel gives you a URL like `your-pool.vercel.app` to share with the team.

To update later, edit the files and push to GitHub; Vercel redeploys automatically. The token
lives only in Vercel's settings — never in the code or repo.

## Editing the pool

- **Players / picks** – edit the `ROSTER` array near the top of the `<script>` in `index.html`.
  Each team is referenced by its TheSportsDB team ID (already filled in and verified).
- **Penalty shootouts** – the bracket resolves automatically. The only case that can't be
  inferred is the Final or third-place match decided on penalties. If that happens, add the
  winner to the `PENALTY_WINNERS` object (instructions are in the comment above it).
- The page caches data briefly and auto-refreshes every minute; the **Refresh** button forces
  an update.

## Data source

Primary: **football-data.org** (free tier), FIFA World Cup competition `WC`, `season=2026`, proxied
through `api/scores.js`. The function maps football-data teams to the dashboard's roster IDs, labels
group matches, maps stages/statuses, and normalizes everything to the shape the page expects. It's
edge-cached (~60s) so the upstream API is hit at most ~once/min — well within the free 10/min limit.
The token is read from the `FOOTBALL_DATA_KEY` environment variable.

The proxy checks the upstream HTTP status instead of assuming success: on a rate-limit (HTTP 429)
or restricted/error response it serves the last good data and reads football-data's throttling
headers (`X-Requests-Available-Minute`, `X-RequestCounter-Reset`) to back off automatically,
rather than silently returning an empty feed.

Venue enrichment: football-data's free tier returns no venue/city, so the proxy fills each match's
venue and city from TheSportsDB (joined by team-pair, cached ~6h). That's what lets the **Next
kickoff** card show the venue-local time alongside the viewer's local time.

Fallback: if the proxy or token is unavailable (e.g. opening the file locally), the page
automatically falls back to TheSportsDB direct via its **season feed** (`eventsseason.php`, free,
no key) — the season feed carries live scores, whereas the per-round feed does not. If everything
is unreachable, it shows the last cached data and keeps retrying.

Diagnostics: open `/api/scores?debug=1` to see the upstream HTTP status, the rate-limit headers,
`raw` (matches received) vs `count` (kept), `dropped`, `venued`, and an `unmappedSample` of any team
names that failed to map.

Notes:
- Free-tier scores can be lightly delayed (not second-by-second), which is fine for a pool.
- Live (`IN_PLAY`) matches are supported, so the **"live now"** indicator does light up.
- "Matches played" counts against a fixed tournament total of **104** (72 group + 32 knockout),
  not however many fixtures the feed has loaded so far.
- If a team name doesn't map (e.g. football-data calls Cape Verde "Cape Verde Islands"), add its
  normalized form to the `NAME_TO_ID` map in `api/scores.js`. The `?debug=1` `unmappedSample` lists
  any current offenders.
