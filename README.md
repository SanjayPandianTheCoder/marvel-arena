# Marvel Arena – Auction & Manual Battle Game

Node.js + Express + Socket.IO backend (authoritative), local **JSON file persistence**, and a multi-route browser app (no build step).

## Run
```bash
npm install
npm run demo      # optional: writes sample data (demo admin + 2 demo players) into ./data
npm start         # http://localhost:3000   (PORT env to change)
```
*First run with an empty `data/` folder:* characters/settings are generated and an admin account is created with a **random password printed once in the console** (or set `ADMIN_PASSWORD` / `ADMIN_USER`).
*Sample data in `data/`:* admin `admin` / `Admin#12345` · players `tony`, `charles` / `demo12345`. **These are public demo credentials – delete `data/` or change them before real use.**
Play on several devices: open `http://<your-ip>:3000` on each. Tests: `npm test` (backend, 63 checks) and `npm i && npm run test:ui` (jsdom UI smoke test).

## Data files (`data/`)
`characters.json` catalogue + persistent health/energy/status · `teams.json` rosters, **private balances**, ledgers, ratings · `players.json` accounts (scrypt hashes) + sessions · `auction.json` queue, current lot, bids, sales · `battles.json` full battle state + turn history · `game-history.json` append-only event log · `settings.json` all rules · `admin.json` admin credentials (hash only).
Writes are atomic (temp file + rename) and serialised; every mutation is synchronous in memory, so two requests can never interleave. A corrupted/malformed file is renamed `*.corrupt-<time>` and defaults are restored. State is reloaded on start (live auction timers and unfinished battles resume).

## Privacy model (enforced server-side)
Public responses are built by projection functions that never include `balance`, `ledger` or valuations. `/api/me` returns only the caller's own team finances; `/api/admin/*` requires an admin token. Locked battle actions are never sent to the opponent or spectators (only `ready: true`); history events carry a visibility (`public` / `team` / `battle` / `admin`) and are filtered per requester. Mystery lots are redacted until sold.

## Auction
Admin configures a pool (**complete / random / custom**), bid step, timer, mystery %, bid-war limit, then starts. Rules enforced on the server: minimum bid, private balance (minus a reserve for each open roster slot), roster limit, per-category limit, no double ownership, leader can't pass/outbid self. **Pass** is final for a lot; the lot sells when every other team has passed (or can't bid), or when the timer ends. Admin extras: pause/resume/end, add/remove/reorder lots, retention, bonus purse (one team or trailing teams), emergency lots for small rosters, audited transaction correction.

## Battles (manual, simultaneous)
Team A challenges team B → B accepts → both lock a starting character (hidden) → each turn both players lock an action (hidden) → the server resolves both together → summary → next turn. States: `WaitingForPlayers, CharacterSelection, ActionSelection, ResolvingTurn, TurnSummary, CharacterReplacement, Finished (BattleWon/BattleLost derived per viewer), BattleCancelled` (+ `WaitingForOpponent` derived once you are locked).
- **Actions:** Basic/Heavy attack, Defensive Stance, Dodge, Recover, Pass, Switch, plus each hero's own abilities (energy cost, cooldown, effects).
- **Resolution order:** switches → costs/cooldowns + self buffs → heals → all attacks computed from the same pre-damage state and applied together → statuses tick, energy regenerates, defeats recorded. Switching consumes the action; the incoming hero takes the hit; health never resets.
- **Damage:** `attack × ability power × 100/(100+defence) × (1±randomness) × crit(×1.5) × (1−guard)`; evasion `5% + speed difference/600 + dodge bonus` (max 75%); rage +30% attack/−25% defence; slow −speed; root blocks dodge/switch; counter halves and reflects; clamped to 1…60% of max health. Faction bonus: +5% attack per teammate beyond 2 sharing a category (max +15%).
- **Persistence:** every resolved turn is saved. *Arena mode* restores everyone to full after the battle; *Campaign mode* writes health/energy/status back to `characters.json` after each turn (winners recover `winRecoveryPct`; admin can heal).
- **Safety:** actions carry the turn number; a resolved turn can't be resolved twice; late/stale/duplicate submissions are rejected or idempotent; timeouts apply `timeoutAction` (default Defend); repeated timeouts forfeit; reconnecting simply reloads the saved battle. Ranked battles use Elo.

## Pages
Landing · Player login/register · Admin login · Lobby · Character catalogue · Auction room · Team dashboard · Battle lobby · Battle arena · Results · Match history · Leaderboard · Admin: dashboard (auction, battles, disputes, corrections) · Characters · Teams & players · Game history (filters) · Settings · Backup/restore/reset.

## API (JSON; send `Authorization: Bearer <token>`)
**Auth:** `POST /api/register {username,password,teamId|teamName}` · `POST /api/login` · `POST /api/admin/login` · `POST /api/logout` · `POST /api/admin/password`
**Public:** `GET /api/state, /characters, /teams, /teams/open, /leaderboard, /analytics, /history?team&char&battle&type&from&to, /auction, /battles, /battles/:id`
**Player:** `GET /api/me` · `POST /api/auction/bid {amount}` · `POST /api/auction/pass` · `POST /api/battles {opponentTeamId,mode,ranked}` · `POST /api/battles/:id/respond {accept}` · `/select {charId}` · `/action {turn,key}` · `/forfeit` · `/dispute {reason}`
**Admin:** `GET /api/admin/overview, /teams, /history, /settings, /characters/export, /backup` · `POST|PUT|DELETE /api/admin/characters[/:id]` (delete = archive; needs `{confirm:true}`) · `POST /api/admin/characters/import` · `POST|PUT|DELETE /api/admin/teams[/:id]`, `/players[/:id]` · `POST /api/admin/auction/{configure,start,pause,resume,end,lots,retain,bonus,emergency,correct,heal}` · `POST /api/admin/battles/:id/{cancel,forfeit,dispute/:d}` · `PUT /api/admin/settings` · `POST /api/admin/restore {confirm,files}` · `POST /api/admin/reset {confirm:"RESET"}`
Errors are `{error: "message"}` with 400/401/403/404/429. Realtime: Socket.IO emits `ev` `{t:'auction'|'battle'|'data'|'presence'}`; clients re-fetch their own filtered view.

## Not implemented
Right-to-match and wildcard auction rounds; Tournament, Survival, Boss, Draft and mid-round tactical switching modes; character images are URL fields only (no uploads). Quick Battle, Campaign, Arena, Ranked, Faction bonuses and Spectator are included.
