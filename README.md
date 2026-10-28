# Marvel Arena – Auction & Manual Battle Game

Node.js + Express + Socket.IO backend (authoritative), **MongoDB persistence**, and a multi-route browser app (no build step).

## Run

```bash
npm install
cp .env.example .env   # then put your MongoDB connection string in MONGODB_URI
npm run demo           # optional: writes sample data (demo admin + 2 demo players) into the database
npm start              # http://localhost:3000   (PORT env to change)
```

Configuration comes from environment variables or `.env` (gitignored; real environment variables win): `MONGODB_URI` (required, e.g. Atlas `mongodb+srv://…`; URL-encode special characters in the password, and allow your IP in Atlas → Network Access), `MONGODB_DB` (default `marvel-arena`), `PORT`, `ADMIN_PASSWORD` / `ADMIN_USER`. While `ADMIN_PASSWORD` is set it is authoritative: it replaces the stored admin password (kept only as a scrypt hash) on every start, so remove it if you want to change the password from the admin area instead. The server will not start without a reachable database.
MongoDB is the only data store: nothing is read from or written to local files (`.env` holds configuration only). _First run on an empty database:_ characters and settings are generated and an admin account is created with a **random password printed once in the console** (or set `ADMIN_PASSWORD` / `ADMIN_USER`).
_Sample data:_ admin `admin` / `Admin#12345` · players `tony`, `charles` / `demo12345`. **These are public demo credentials – change them before real use.**
Play on several devices: open `http://<your-ip>:3000` on each. Tests: `npm test` (backend, 129 checks) and `npm run test:ui` (jsdom UI smoke test). Both start a throwaway in-memory MongoDB (`mongodb-memory-server`, downloaded on first use) and never touch `.env` or your database.

## Database (MongoDB collections)

`characters` catalogue + persistent health/energy/status/level · `teams` rosters, **private balances**, ledgers, points, inventory, ratings · `players` accounts (scrypt hashes) · `sessions` login tokens · `battles` full battle state + turn history · `tournaments` brackets · `history` append-only event log · `meta` three documents: `auction` (queue, current lot, bids, sales), `settings` (all rules), `admin` (credentials, hash only) · `corrupt` copies of damaged documents.
List collections hold one document per item (`_id` = the item id, `_i` = its position). The game state lives in memory and every mutation is synchronous, so two requests can never interleave; changes are written behind it in a serialised queue that sends only the documents that changed (history is insert-only). A failed write is retried every 5 s; on shutdown (Ctrl+C) pending writes are flushed first. A malformed `meta` document is copied to `corrupt` and defaults are restored. State is reloaded on start (live auction timers and unfinished battles resume). Backup/restore in the admin area still exports and imports the whole game as one JSON file.

## Privacy model (enforced server-side)

Public responses are built by projection functions that never include `balance`, `ledger` or valuations. `/api/me` returns only the caller's own team finances; `/api/admin/*` requires an admin token. Locked battle actions are never sent to the opponent or spectators (only `ready: true`); history events carry a visibility (`public` / `team` / `battle` / `admin`) and are filtered per requester. Mystery lots are redacted until sold.

## Auction

Admin configures a pool (**complete / random / custom**), bid step, timer, mystery %, bid-war limit, then starts. Rules enforced on the server: minimum bid, private balance (minus a reserve for each open roster slot), roster limit, per-category limit, no double ownership, leader can't pass/outbid self. **Pass** is final for a lot; the lot sells when every other team has passed (or can't bid), or when the timer ends. Admin extras: pause/resume/end, add/remove/reorder lots, retention, bonus purse (one team or trailing teams), emergency lots for small rosters, audited transaction correction.

## Battles (manual, simultaneous)

Team A challenges team B and sets the **squad size N** (1 … roster limit; default `battle.squadSize`, capped by the roster limit) → B accepts, declines or sends a **counter-offer** with another N (up to 3 times; the invite then goes back to A) → optional **draft**: each side bans one enemy hero (hidden until both lock) → each side locks **exactly N** heroes in secret, in order; the first one starts → each turn both players lock an action (hidden) → the server resolves both together → summary → next turn. Only the squad fights: switches and replacements come from the squad, and the battle ends when a squad is wiped out. A challenge is refused when either team cannot field N heroes (N + 1 for a draft; in campaign mode only healthy, rested heroes count). States: `WaitingForPlayers, BanSelection, SquadSelection, ActionSelection, ResolvingTurn, TurnSummary, CharacterReplacement, Finished (BattleWon/BattleLost derived per viewer), BattleCancelled` (+ `WaitingForOpponent` derived once you are locked; `CharacterSelection` only for battles saved by older versions). Selection timeouts ban/pick the strongest heroes automatically.

- **Actions:** Basic/Heavy attack, Defensive Stance, Dodge, Recover, Pass, Switch, plus each hero's own abilities (energy cost, cooldown, effects) as far as its level has unlocked them, and **team-up moves** (12 named pairs, e.g. Iron Man + Captain America, Rocket + Groot): either hero gets the move while the partner is alive in the same squad.
- **Ultimate charge:** ultimates have no cooldown; they need a full charge (0–100), built by the hero on the field each turn (`chargePerTurn`) and by damage dealt/taken (`chargeDealt`/`chargeTaken` per 1% of max health). Using one resets it.
- **Rematch & replay:** a finished battle offers a rematch (same mode, ranked, squad size and draft) and a turn-by-turn replay built from the saved snapshots.
- **Practice vs bot:** an instant battle against a bot squad of catalogue heroes priced like your roster. The bot locks its squad and actions at once (heals when low, fires a charged ultimate, else its strongest attack). Arena rules, no items, and nothing is recorded: no rating, points, XP, records or health changes.
- **Matchmaking:** the lobby suggests the free opponents closest in rating, with the Elo win chance.
- **Tournaments (admin):** single elimination seeded by rating (classic bracket, byes to top seeds), fixed squad size and mode, optional prize points. A match battle starts as soon as both teams are free (no invite); draws and cancelled match battles are replayed; a team that cannot field a full squad loses by walkover. Public bracket page.
- **Campaign rest:** heroes who took the field in a campaign battle rest for `campaignRestMin` minutes (default 30) before they can play campaign again. Admin heal ends the rest.
- **Resolution order:** switches → costs/cooldowns + self buffs → heals → all attacks computed from the same pre-damage state and applied together → statuses tick, energy regenerates, defeats recorded. Switching consumes the action; the incoming hero takes the hit; health never resets.
- **Damage:** `attack × ability power × 100/(100+defence) × (1±randomness) × crit(×1.5) × (1−guard)`; evasion `5% + speed difference/600 + dodge bonus` (max 75%); rage +30% attack/−25% defence; slow −speed; root blocks dodge/switch; counter halves and reflects; clamped to 1…60% of max health. Faction bonus: +5% attack per squad member beyond 2 sharing a category (max +15%).
- **Persistence:** every resolved turn is saved. _Arena mode_ restores everyone to full after the battle; _Campaign mode_ writes health/energy/status back to the `characters` collection after each turn (winners recover `winRecoveryPct`; admin can heal).
- **Safety:** actions carry the turn number; a resolved turn can't be resolved twice; late/stale/duplicate submissions are rejected or idempotent; timeouts apply `timeoutAction` (default Defend); repeated timeouts forfeit; reconnecting simply reloads the saved battle. Ranked battles use Elo.

## Rewards, store & hero levels

Points belong to the **team** and are private like the balance (`/api/me`, `/api/store`; only lifetime `pointsEarned` is public on the leaderboard). All numbers live in `settings.rewards` / `settings.store` and are editable in Admin → Settings.

- **Earning:** each enemy hero defeated pays `killBase (10) × rarity (Common 1 · Rare 1.5 · Epic 2.5 · Legendary 4) × (1 + 10% per level above 1)` to the opposing team. At the end: +50 win, +15 draw, +25 flawless win (only for battles of 3+ turns, so a quick forfeit earns no bonus), × (1 + `squadBonus` 25% per hero above 1 per side), so a 3v3 bonus is ×1.5. Points are paid when the battle finishes (forfeit included; admin-cancelled battles pay nothing). Every earlier battle between the same two teams in the last 24 h halves the payout; an optional `dailyCap` limits points per team per day.
- **Store:** Med Kit S/M/L (20 / 50 / 100 % health, 30 / 70 / 120 pts) and Energy Kit S/M/L (20 / 50 / 100 % energy, 20 / 45 / 80 pts) go into the team inventory. In battle a kit is an action (it takes the turn, resolves in the heal phase, max 2 per battle). Out of battle a kit can be used on any hero not in a battle (useful in campaign mode; a med kit also revives an eliminated hero).
- **Level up:** cost `50 × rarity × current level` (max level 10). Each level raises attack +4 %, max health +4 % (current health rises by the same amount) and defence +3 %. Not possible while the hero is in a battle. The level stays with the hero.
- **Hero XP:** every hero in a finished battle earns XP: 20 per battle of 3+ turns, 15 per enemy it defeated, 20 per win (scaled down for repeat battles like points). At `xpPerLevel (100) × level` XP it levels up for free. Practice battles give none.
- **Unlocks:** abilities unlock in listed order at levels 1, 3, 5, 7… (`unlockEvery` 2) and ultimates at level 8 (`ultimateLevel`); an ability's own `unlockLevel` overrides this. Locked abilities appear disabled in battle ("Unlocks at Lv 5"). Every 3 levels after unlocking (`rankEvery`), an ability ranks up (rank II/III: +15% power/heal each; rank III also has 1 turn less cooldown).
- **Perks:** level 5 *Battle-hardened* (+5 energy every turn), level 10 *Veteran* (enters the fight behind a 30% shield for one turn).
- **Exchange:** 1 point = 1 cash added to the private balance, no daily limit (any amount up to the team's points), closed while an auction is live or paused (`exchangeDuringAuction`).
- **Daily gift:** each team claims one free gift per day (UTC) in the store. Consecutive days build a 7-day streak: day k gives `giftPoints + giftStreakBonus × (k − 1)` points (20 … 50) plus a kit (Med Kit S on odd days, Energy Kit S on even days, Med Kit L on day 7; `giftKits` to turn off); after day 7, or after a missed day, it starts again at day 1. Gift points are spendable but don't count towards the public `pointsEarned`.

## Pages

Landing · Player login/register · Admin login · Lobby · Character catalogue · Auction room · Team dashboard · Store & upgrades · Battle lobby · Battle arena · Results · Replay · Tournaments · Match history · Leaderboard · Admin: dashboard (auction, battles, disputes, corrections) · Characters · Teams & players · Tournaments · Game history (filters) · Settings · Backup/restore/reset.

## API (JSON; send `Authorization: Bearer <token>`)

**Auth:** `POST /api/register {username,password,teamId|teamName}` · `POST /api/login` · `POST /api/admin/login` · `POST /api/logout` · `POST /api/admin/password`
**Public:** `GET /api/state, /characters, /teams, /teams/open, /leaderboard, /analytics, /history?team&char&battle&type&from&to, /auction, /battles, /battles/:id, /tournaments`
**Store:** `GET /api/store` (public prices; own points, heroes and inventory when logged in as a player) · `POST /api/store/buy {item,qty}` · `/store/use {item,charId}` · `/store/level-up {charId}` · `/store/gift` · `/store/exchange {points}`
**Player:** `GET /api/me` · `POST /api/auction/bid {amount}` · `POST /api/auction/pass` · `POST /api/battles {opponentTeamId,mode,ranked,squadSize,bans}` · `POST /api/battles/practice {squadSize}` · `GET /api/battles/suggest` · `POST /api/battles/:id/respond {accept}` · `/counter {squadSize}` · `/ban {charId}` · `/squad {charIds}` (exactly N, first starts) · `/select {charId}` (replacement) · `/action {turn,key}` · `/forfeit` · `/rematch` · `/dispute {reason}`
**Admin:** `GET /api/admin/overview, /teams, /history, /settings, /characters/export, /backup` · `POST|PUT|DELETE /api/admin/characters[/:id]` (delete = archive; needs `{confirm:true}`) · `POST /api/admin/characters/import` · `POST|PUT|DELETE /api/admin/teams[/:id]` (PUT accepts `balance`, `points`), `/players[/:id]` · `POST /api/admin/auction/{configure,start,pause,resume,end,lots,retain,bonus,emergency,correct,heal}` · `POST /api/admin/battles/:id/{cancel,forfeit,dispute/:d}` · `POST /api/admin/tournaments {name,teamIds,squadSize,mode,ranked,prize}`, `/admin/tournaments/:id/{cancel,tick}` · `PUT /api/admin/settings` · `POST /api/admin/restore {confirm,files}` · `POST /api/admin/reset {confirm:"RESET"}`
Errors are `{error: "message"}` with 400/401/403/404/429. Realtime: Socket.IO emits `ev` `{t:'auction'|'battle'|'data'|'presence'}`; clients re-fetch their own filtered view.

## Not implemented

Right-to-match and wildcard auction rounds; Survival, Boss and mid-round tactical switching modes; character images are URL fields only (no uploads). Quick Battle (any squad size), Draft, Tournament, Practice, Campaign, Arena, Ranked, Faction bonuses, Team-ups, Spectator and Replay are included.
