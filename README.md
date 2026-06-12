# MDS 2026 World Cup Pool Dashboard

A single self-contained web page (`index.html`) that shows live standings, the pool
leaderboard, each player's squad, group tables, fixtures, and the scoring rules. It pulls
live scores from TheSportsDB and computes everything in the browser. No build step, no server.

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

1. Create a new GitHub repo and add `index.html` (this folder's file). The README is optional.
2. Go to vercel.com, **Add New… → Project**, and import the repo.
3. Framework preset: **Other**. Leave build command empty and output directory as the repo root.
4. **Deploy.** Vercel gives you a URL like `your-pool.vercel.app` to share with the team.

To update later, just edit `index.html` and push to GitHub; Vercel redeploys automatically.

## Editing the pool

- **Players / picks** – edit the `ROSTER` array near the top of the `<script>` in `index.html`.
  Each team is referenced by its TheSportsDB team ID (already filled in and verified).
- **Penalty shootouts** – the bracket resolves automatically. The only case that can't be
  inferred is the Final or third-place match decided on penalties. If that happens, add the
  winner to the `PENALTY_WINNERS` object (instructions are in the comment above it).
- The page caches data briefly and auto-refreshes every 2 minutes; the **Refresh** button forces
  an update.

## Data source

TheSportsDB (free tier), FIFA World Cup league `4429`, season `2026`. If the live feed is ever
unreachable, the page shows the last cached data and keeps retrying.
