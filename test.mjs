// End-to-end test (starts its own throwaway MongoDB and server; never touches .env or your database): node test.mjs
import { spawn } from "child_process";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
const mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  }),
  M = await new MongoClient(mongo.getUri()).connect(),
  mdb = M.db("arena_test");
const PORT = 3077,
  URL = "http://localhost:" + PORT;
const env = {
  ...process.env,
  MONGODB_URI: mongo.getUri(),
  MONGODB_DB: "arena_test",
  PORT: String(PORT),
  ADMIN_PASSWORD: "TestAdmin#123",
};
let srv;
const start = (port = PORT, e = env) =>
  new Promise((r) => {
    srv = spawn("node", ["server/index.js"], {
      env: { ...e, PORT: String(port) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    srv.stdout.on("data", (d) => /running/.test(d) && r());
  });
const stop = () =>
  new Promise((r) => {
    srv.on("exit", r);
    srv.kill("SIGTERM");
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) {
    fails++;
  }
};
const call = async (m, p, body, tok, base = URL) => {
  const r = await fetch(base + "/api" + p, {
    method: m,
    headers: {
      "content-type": "application/json",
      ...(tok ? { authorization: "Bearer " + tok } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { s: r.status, j };
};
await start();
const adm = (
  await call("POST", "/admin/login", {
    username: "admin",
    password: "TestAdmin#123",
  })
).j.token;
ok(adm, "admin logs in");
ok(
  (await call("POST", "/admin/login", { username: "admin", password: "wrong" }))
    .s === 401,
  "wrong admin password rejected",
);
ok(
  (await call("GET", "/admin/overview")).s === 401,
  "admin API rejects anonymous",
);
const A = (
    await call("POST", "/register", {
      username: "alice",
      password: "password1",
      teamName: "Alpha",
    })
  ).j,
  B = (
    await call("POST", "/register", {
      username: "bobby",
      password: "password2",
      teamName: "Beta",
    })
  ).j;
ok(A.token && B.token, "two players registered");
ok(
  (
    await call("POST", "/register", {
      username: "alice",
      password: "password1",
      teamName: "Gamma",
    })
  ).s === 400,
  "duplicate username rejected",
);
ok(
  (await call("GET", "/admin/overview", null, A.token)).s === 401,
  "player token cannot use admin API",
);
/* privacy */
// the auction room shows the caller their own balance (in `me`); nothing else may carry one
const { me: auMe, ...auPub } = (await call("GET", "/auction", null, B.token)).j;
const pub = JSON.stringify([
  (await call("GET", "/teams", null, B.token)).j,
  auPub,
  (await call("GET", "/leaderboard", null, B.token)).j,
  (await call("GET", "/battles", null, B.token)).j,
]);
ok(
  !/balance|ledger|startingBalance/.test(pub),
  "public/other-player API responses contain no balances",
);
ok(
  auMe.balance === (await call("GET", "/me", null, B.token)).j.team.balance &&
    !/balance|ledger/.test(
      JSON.stringify((await call("GET", "/auction")).j),
    ),
  "the auction shows a player only their own balance (none when logged out)",
);
const meA = (await call("GET", "/me", null, A.token)).j;
ok(meA.team.balance === 1000, "player sees own balance (1000)");
ok((await call("GET", "/me")).s === 401, "/me needs login");
ok(
  (await call("GET", "/admin/teams", null, adm)).j.every(
    (t) => typeof t.balance === "number",
  ),
  "admin sees all balances",
);
/* auction */
await call(
  "PUT",
  "/admin/settings",
  {
    rosterLimit: 2,
    minRoster: 1,
    auction: { timer: 0, lotGapMs: 500 },
    battle: { summaryMs: 500, actionTimer: 30, critChance: 0 },
  },
  adm,
);
// the admin settings form sends every field back; unchanged settings must always save
const full = (await call("GET", "/admin/settings", null, adm)).j,
  saved = await call("PUT", "/admin/settings", full, adm);
ok(saved.s === 200, "saving the full settings form unchanged succeeds" + (saved.j.error ? ": " + saved.j.error : ""));
ok(
  (await call("PUT", "/admin/settings", { startingBudget: 5, rosterLimit: 9999 }, adm)).s === 400 &&
    (await call("GET", "/admin/settings", null, adm)).j.startingBudget === full.startingBudget,
  "a rejected settings save changes nothing",
);
// settings edited directly in MongoDB are picked up by the running server (checked every 5 s)
await wait(300); // let the PUT above reach the database
await mdb
  .collection("meta")
  .updateOne({ _id: "settings" }, { $set: { "value.minRoster": 2 } });
await wait(6000);
ok(
  (await call("GET", "/admin/settings", null, adm)).j.minRoster === 2,
  "settings edited in the database apply without a restart",
);
await mdb
  .collection("meta")
  .updateOne({ _id: "settings" }, { $set: { "value.rosterLimit": 9999 } });
await wait(6000);
ok(
  (await call("GET", "/admin/settings", null, adm)).j.rosterLimit === 2 &&
    (await mdb.collection("meta").findOne({ _id: "settings" })).value
      .rosterLimit === 2,
  "an out-of-range settings edit in the database is rejected and written back",
);
await call("PUT", "/admin/settings", { minRoster: 1 }, adm);
const chars = (await call("GET", "/characters")).j,
  id = (n) => chars.find((c) => c.name.startsWith(n)).id;
const pool = ["Iron Man", "Spider-Man (", "Thor Odinson", "Wolverine"].map(id);
ok(
  (
    await call(
      "POST",
      "/admin/auction/configure",
      { mode: "custom", ids: [...pool, "nope"] },
      adm,
    )
  ).s === 400,
  "custom pool with bad id rejected",
);
ok(
  (
    await call(
      "POST",
      "/admin/auction/configure",
      { mode: "custom", ids: pool },
      adm,
    )
  ).s === 200,
  "auction configured (custom pool)",
);
ok(
  (await call("POST", "/admin/auction/start", {}, adm)).s === 200,
  "auction started",
);
const lot = async (buyer, other) => {
  await wait(700);
  const a = (await call("GET", "/auction")).j;
  const c = a.current;
  const r = await call("POST", "/auction/bid", { amount: c.next }, buyer.token);
  if (r.s !== 200) return r;
  await call("POST", "/auction/pass", {}, other.token);
  return { s: 200, c };
};
let a0 = (await call("GET", "/auction")).j;
ok(
  a0.current && a0.current.char.name.startsWith("Iron Man"),
  "lot 1 is Iron Man",
);
ok(
  (await call("POST", "/auction/bid", { amount: 1 }, A.token)).s === 400,
  "bid below base rejected",
);
ok(
  (await call("POST", "/auction/bid", { amount: 999999 }, B.token)).s === 400,
  "bid above private balance rejected",
);
await call("POST", "/auction/bid", { amount: a0.current.next }, A.token);
ok(
  (
    await call(
      "POST",
      "/auction/bid",
      { amount: a0.current.next + 50 },
      A.token,
    )
  ).s === 400,
  "leader cannot outbid self",
);
ok(
  (await call("POST", "/auction/pass", {}, A.token)).s === 400,
  "leader cannot pass",
);
await call("POST", "/auction/pass", {}, B.token);
await wait(300);
ok(
  (await call("GET", "/me", null, A.token)).j.team.roster.some((c) =>
    c.name.startsWith("Iron Man"),
  ),
  "Iron Man sold to Alpha when Beta passed",
);
ok(
  (await call("GET", "/me", null, A.token)).j.team.balance < 1000,
  "Alpha balance reduced atomically",
);
await lot(B, A);
await lot(A, B);
await lot(B, A);
await wait(800);
const a1 = (await call("GET", "/auction")).j;
ok(a1.status === "ended", "auction ends when rosters are full");
const tA = (await call("GET", "/me", null, A.token)).j.team,
  tB = (await call("GET", "/me", null, B.token)).j.team;
ok(
  tA.roster.length === 2 && tB.roster.length === 2,
  "each team owns 2 characters, none duplicated",
);
/* battle: manual, simultaneous, hidden */
const thor = tA.roster.find((c) => c.name.startsWith("Thor")).id,
  iron = tA.roster.find((c) => c.name.startsWith("Iron")).id,
  wolv = tB.roster.find((c) => c.name.startsWith("Wolverine")).id,
  spid = tB.roster.find((c) => c.name.startsWith("Spider")).id;
ok(
  (
    await call(
      "POST",
      "/battles",
      { opponentTeamId: tB.id, squadSize: 3 },
      A.token,
    )
  ).s === 400 &&
    (
      await call(
        "POST",
        "/battles",
        { opponentTeamId: tB.id, squadSize: 0 },
        A.token,
      )
    ).s === 400,
  "squad size must fit the roster limit and be at least 1",
);
const ch = (
  await call(
    "POST",
    "/battles",
    { opponentTeamId: tB.id, squadSize: 2 },
    A.token,
  )
).j;
ok(ch.id, "Alpha challenges Beta (2v2)");
const invB = (await call("GET", "/battles/invites", null, B.token)).j;
ok(
  invB.length === 1 && invB[0].id === ch.id && invB[0].from === tA.name,
  "the invited team sees the challenge in its invites",
);
ok(
  !(await call("GET", "/battles/invites", null, A.token)).j.length,
  "the challenger has no incoming invite",
);
const lobby = (T) =>
  call("GET", "/battles", null, T.token).then((r) =>
    r.j.find((x) => x.id === ch.id),
  );
ok(
  (await lobby(B)).incoming && !(await lobby(A)).incoming,
  "battle list marks the invite as incoming only for the invited team",
);
ok(
  (await call("POST", `/battles/${ch.id}/respond`, { accept: true }, A.token))
    .s === 403,
  "challenger cannot accept own invite",
);
await call("POST", `/battles/${ch.id}/respond`, { accept: true }, B.token);
const sq = (id, ids, T) =>
  call("POST", `/battles/${id}/squad`, { charIds: ids }, T.token);
ok(
  (await sq(ch.id, [thor, wolv], A)).s === 400,
  "cannot put a hero you do not own in your squad",
);
ok(
  (await sq(ch.id, [thor], A)).s === 400 &&
    (await sq(ch.id, [thor, thor], A)).s === 400,
  "squad must be exactly N different heroes",
);
await sq(ch.id, [thor, iron], A);
let vB = (await call("GET", `/battles/${ch.id}`, null, B.token)).j;
ok(
  vB.state === "SquadSelection" &&
    vB.sides[0].ready === true &&
    !vB.sides[0].active &&
    !JSON.stringify(vB).includes('"squad":["'),
  'opponent squad is hidden (only "ready")',
);
await sq(ch.id, [wolv, spid], B);
vB = (await call("GET", `/battles/${ch.id}`, null, B.token)).j;
ok(
  vB.state === "ActionSelection" &&
    vB.turn === 1 &&
    vB.sides[0].active === thor &&
    vB.sides[1].active === wolv,
  "both squads locked -> ActionSelection turn 1, first picks start",
);
const vA = (await call("GET", `/battles/${ch.id}`, null, A.token)).j;
ok(
  vA.me.options.some((o) => o.label === "Mjolnir Strike") &&
    !vB.me.options.some((o) => o.label === "Mjolnir Strike"),
  "each player only receives their own action options",
);
const opt = (v, l) => v.me.options.find((o) => o.label === l);
ok(
  !opt(vA, "Mjolnir Strike").reason &&
    opt(vA, "Lightning Storm").reason === "Unlocks at Lv 3" &&
    opt(vA, "Asgardian Resilience").reason === "Unlocks at Lv 5" &&
    opt(vA, "God of Thunder").reason === "Unlocks at Lv 8",
  "level 1 hero: first ability open, later ones locked by level (ultimate at 8)",
);
ok(
  (
    await call(
      "POST",
      `/battles/${ch.id}/action`,
      { turn: 1, key: opt(vA, "God of Thunder").key },
      A.token,
    )
  ).s === 400,
  "a locked ability is rejected",
);
ok(
  (
    await call(
      "POST",
      `/battles/${ch.id}/action`,
      { turn: 1, key: "ab:a9" },
      A.token,
    )
  ).s === 400,
  "unknown action rejected",
);
const gk = opt(vA, "Mjolnir Strike").key;
const r1 = await call(
  "POST",
  `/battles/${ch.id}/action`,
  { turn: 1, key: gk },
  A.token,
);
ok(r1.s === 200, "Alpha locks Mjolnir Strike");
const spec = JSON.stringify((await call("GET", `/battles/${ch.id}`)).j),
  vB2 = JSON.stringify(
    (await call("GET", `/battles/${ch.id}`, null, B.token)).j,
  );
ok(
  !/Mjolnir Strike/.test(spec) && !/Mjolnir Strike/.test(vB2),
  "locked action is hidden from opponent and spectators",
);
ok(
  (await call("GET", `/battles/${ch.id}`, null, B.token)).j.sides[0].ready ===
    true,
  "opponent sees only that Alpha is ready",
);
ok(
  (
    await call(
      "POST",
      `/battles/${ch.id}/action`,
      { turn: 1, key: "defend" },
      A.token,
    )
  ).j.already === true,
  "repeat submit is idempotent (action stays locked)",
);
const adminV = JSON.stringify(
  (await call("GET", `/battles/${ch.id}`, null, adm)).j,
);
ok(/Mjolnir Strike/.test(adminV), "admin can inspect locked actions");
await call(
  "POST",
  `/battles/${ch.id}/action`,
  { turn: 1, key: "attack" },
  B.token,
);
let v = (await call("GET", `/battles/${ch.id}`, null, A.token)).j;
ok(
  v.state === "TurnSummary" && v.turns.length === 1,
  "both locked -> turn resolved once",
);
const w1 = v.sides[1].chars.find((c) => c.id === wolv).hp;
ok(
  w1 < v.sides[1].chars.find((c) => c.id === wolv).max,
  "damage applied: Wolverine hp " + w1,
);
ok(
  v.sides.every((s) => s.chars.find((c) => c.active).charge >= 10) &&
    v.sides[0].chars.find((c) => c.id === iron).charge === 0,
  "ultimate charge builds for the heroes on the field: " +
    v.sides.map((s) => s.chars.find((c) => c.active).charge).join("/"),
);
ok(
  (
    await call(
      "POST",
      `/battles/${ch.id}/action`,
      { turn: 1, key: "attack" },
      B.token,
    )
  ).s === 400,
  "late/stale action rejected after resolution",
);
await wait(900);
v = (await call("GET", `/battles/${ch.id}`, null, A.token)).j;
ok(v.state === "ActionSelection" && v.turn === 2, "auto-advanced to turn 2");
/* switching keeps health */
const swKey = (
  await call("GET", `/battles/${ch.id}`, null, B.token)
).j.me.options.find((o) => o.key === "sw:" + spid).key;
await call(
  "POST",
  `/battles/${ch.id}/action`,
  { turn: 2, key: "defend" },
  A.token,
);
await call(
  "POST",
  `/battles/${ch.id}/action`,
  { turn: 2, key: swKey },
  B.token,
);
v = (await call("GET", `/battles/${ch.id}`, null, A.token)).j;
ok(
  v.sides[1].chars.find((c) => c.id === wolv).hp === w1 &&
    v.sides[1].active === spid,
  "switch consumed the action; Wolverine keeps his health",
);
/* play to the end */
let safe = 0;
while (safe++ < 60) {
  await wait(250);
  const V = async (t) => (await call("GET", `/battles/${ch.id}`, null, t)).j;
  let x = await V(A.token);
  if (x.state === "Finished") break;
  for (const [T, own] of [
    [A, "A"],
    [B, "B"],
  ]) {
    x = await V(T.token);
    if (x.state === "ActionSelection" && !x.me.locked) {
      const o = x.me.options.filter((o) => !o.reason && o.kind === "attack");
      const k = (
        o.sort((p, q) => q.power - p.power)[0] ||
        x.me.options.find((o) => !o.reason)
      ).key;
      await call(
        "POST",
        `/battles/${ch.id}/action`,
        { turn: x.turn, key: k },
        T.token,
      );
    }
    if (x.state === "CharacterReplacement" && x.me.needsReplacement) {
      const c = x.sides
        .find((s) => s.teamId === x.me.teamId)
        .chars.find((c) => !c.eliminated);
      await call("POST", `/battles/${ch.id}/select`, { charId: c.id }, T.token);
    }
  }
}
v = (await call("GET", `/battles/${ch.id}`, null, A.token)).j;
ok(
  v.state === "Finished" && v.winner,
  "battle finished with a winner after " + v.turns.length + " turns",
);
ok(
  ["BattleWon", "BattleLost"].includes(v.derived),
  "derived state: " + v.derived,
);
const lb = (await call("GET", "/leaderboard")).j;
ok(
  lb[0].wins === 1 && lb[1].losses === 1 && lb[0].rating > 1000,
  "leaderboard updated: " + lb.map((t) => t.name + " " + t.rating).join(", "),
);
ok(
  (await call("GET", "/characters")).j.every(
    (c) => c.currentHealth === c.maxHealth,
  ),
  "arena mode: health restored after the battle",
);
ok(
  v.turns.every((t) => t.events.length),
  "turn history recorded with events",
);
ok(
  v.start?.chars[tA.id][thor].hp > 0 &&
    v.turns.every((t) => t.active && t.snapshot[tB.id]),
  "replay data stored: starting state, active heroes and snapshots per turn",
);
const xpC = (await call("GET", "/characters")).j;
ok(
  v.turns.length >= 3 &&
    Object.keys(v.xpGained || {}).length === 4 &&
    [thor, iron, wolv, spid].every(
      (i) =>
        xpC.find((c) => c.id === i).xp === v.xpGained[i].xp &&
        v.xpGained[i].xp >= 20,
    ),
  "every hero who fought earned XP: " +
    JSON.stringify(Object.values(v.xpGained || {}).map((g) => g.xp)),
);
/* history visibility */
const hp = JSON.stringify((await call("GET", "/history", null, B.token)).j),
  ha = (await call("GET", "/admin/history", null, adm)).j;
ok(
  !/bid\.rejected|battle\.action\.locked/.test(hp) &&
    ha.events.some((e) => e.type === "bid.rejected") &&
    ha.events.some((e) => e.type === "battle.action.locked"),
  "hidden/private events only in admin history",
);
ok(
  !new RegExp(tA.id).test(
    JSON.stringify(
      (await call("GET", "/history", null, B.token)).j.events.filter(
        (e) => e.type === "balance.changed",
      ),
    ),
  ),
  "other team balance events are not visible",
);
/* rewards: points, store, hero levels, exchange */
const rw = v.rewards,
  kills = v.turns.flatMap((t) => t.events).filter((e) => e.k === "defeat"),
  RP = { Common: 10, Rare: 15, Epic: 25, Legendary: 40 };
ok(
  rw &&
    rw[v.winner].bonus >= 63 &&
    rw[v.winner].total === rw[v.winner].killPts + rw[v.winner].bonus,
  "winner earns kill points + win bonus (×1.25 for 2v2): " + JSON.stringify(rw),
);
ok(
  kills.length &&
    kills.every(
      (e) =>
        e.by !== e.team &&
        e.points === RP[chars.find((c) => e.text.startsWith(c.name)).rarity],
    ),
  "each defeat pays the opposing team 10 × rarity multiplier",
);
const wA = (await call("GET", "/me", null, A.token)).j.team,
  wB = (await call("GET", "/me", null, B.token)).j.team;
ok(
  wA.points === rw[tA.id].total && wB.points === rw[tB.id].total,
  `points credited to both teams (${wA.points} / ${wB.points})`,
);
ok(
  !/"points"|inventory|pointsLedger/.test(
    JSON.stringify([
      (await call("GET", "/teams", null, B.token)).j,
      (await call("GET", "/leaderboard")).j,
    ]),
  ),
  "points and inventory are private",
);
const st0 = (await call("GET", "/store", null, A.token)).j;
ok(
  st0.items.length === 6 &&
    st0.me.points === wA.points &&
    st0.me.heroes.length === 2,
  "store lists 6 kits, own points and heroes",
);
ok(
  (await call("POST", "/store/buy", { item: "med_l", qty: 20 }, B.token)).s ===
    400,
  "cannot buy without enough points",
);
ok(
  (
    await call(
      "PUT",
      "/admin/settings",
      { store: { prices: { med_s: -1 } } },
      adm,
    )
  ).s === 400,
  "store price validation",
);
await call("PUT", "/admin/teams/" + tA.id, { points: 1000 }, adm);
let r = await call("POST", "/store/buy", { item: "med_m", qty: 2 }, A.token);
ok(
  r.s === 200 && r.j.points === 860 && r.j.owned === 2,
  "buy 2 × Med Kit M for 140 points",
);
await call("POST", "/store/buy", { item: "nrg_s" }, A.token);
ok(
  (await call("POST", "/store/use", { item: "med_m", charId: thor }, A.token))
    .s === 400,
  "med kit refused on a full-health hero",
);
ok(
  (await call("POST", "/store/use", { item: "med_m", charId: wolv }, A.token))
    .s === 403,
  "cannot use items on another team's hero",
);
const th0 = (await call("GET", "/characters")).j.find((c) => c.id === thor);
await call(
  "PUT",
  "/admin/characters/" + thor,
  { maxHealth: th0.maxHealth + 100 },
  adm,
);
r = await call("POST", "/store/use", { item: "med_m", charId: thor }, A.token);
ok(
  r.s === 200 && r.j.gain === 100 && r.j.left === 1,
  "med kit heals a damaged hero (+100)",
);
r = await call("POST", "/store/level-up", { charId: thor }, A.token);
const th1 = (await call("GET", "/characters")).j.find((c) => c.id === thor);
ok(
  r.s === 200 &&
    r.j.cost === 200 &&
    r.j.points === 640 &&
    th1.level === 2 &&
    th1.attack > th0.attack &&
    th1.maxHealth > th0.maxHealth + 100 &&
    th1.currentHealth === th1.maxHealth &&
    r.j.unlocked.length === 0,
  "level-up (Legendary, lv1→2) costs 200 and raises stats",
);
ok(
  (await call("POST", "/store/level-up", { charId: wolv }, A.token)).s === 403,
  "cannot level up another team's hero",
);
const bal0 = (await call("GET", "/me", null, A.token)).j.team.balance;
r = await call("POST", "/store/exchange", { points: 150 }, A.token);
ok(
  r.s === 200 && r.j.balance === bal0 + 150 && r.j.points === 490,
  "exchange 150 points for 150 cash",
);
r = await call("POST", "/store/exchange", { points: 60 }, A.token);
ok(
  r.s === 200 && r.j.balance === bal0 + 210 && r.j.points === 430,
  "no daily exchange limit (210 cash in one day)",
);
ok(
  (await call("POST", "/store/exchange", { points: 999999 }, A.token)).s ===
    400,
  "cannot exchange more points than you have",
);
r = await call("POST", "/store/level-up", { charId: thor }, A.token);
const th3 = (await call("GET", "/store", null, A.token)).j.me.heroes.find(
  (c) => c.id === thor,
);
ok(
  r.s === 200 &&
    r.j.level === 3 &&
    r.j.unlocked.includes("Lightning Storm") &&
    th3.abilities.find((a) => a.name === "Lightning Storm").rank === 1 &&
    th3.abilities.find((a) => a.name === "Mjolnir Strike").rank === 1 &&
    th3.nextUnlock?.name === "Asgardian Resilience",
  "level 3 unlocks Lightning Storm; the store shows the next unlock",
);
/* daily gift */
const sg0 = (await call("GET", "/store", null, A.token)).j,
  inv0 = (await call("GET", "/me", null, A.token)).j.team;
ok(
  sg0.gift.available &&
    sg0.gift.day === 1 &&
    sg0.gift.calendar.length === 7 &&
    sg0.gift.calendar[6].item === "med_l" &&
    inv0.giftReady === true &&
    !(await call("GET", "/store")).j.gift,
  "daily gift is ready on day 1 (7-day calendar, only shown to the team)",
);
r = await call("POST", "/store/gift", {}, A.token);
const inv1 = (await call("GET", "/me", null, A.token)).j.team;
ok(
  r.s === 200 &&
    r.j.day === 1 &&
    r.j.points === 20 &&
    inv1.points === inv0.points + 20 &&
    (inv1.inventory.med_s || 0) === (inv0.inventory.med_s || 0) + 1 &&
    inv1.pointsEarned === inv0.pointsEarned &&
    inv1.pointsLedger.at(-1).type === "gift" &&
    !inv1.giftReady,
  "claiming the gift adds 20 points and a Med Kit S",
);
ok(
  (await call("POST", "/store/gift", {}, A.token)).s === 400,
  "the gift can be claimed only once a day",
);
const me2 = (await call("GET", "/me", null, A.token)).j.team;
ok(
  me2.ledger.some((l) => l.type === "exchange") &&
    me2.pointsLedger.some((l) => l.type === "level-up"),
  "exchange and level-up recorded in ledgers",
);
tA.balance = me2.balance;
/* items inside a battle */
const b2 = (await call("POST", "/battles", { opponentTeamId: tB.id }, A.token))
  .j.id;
await call("POST", `/battles/${b2}/respond`, { accept: true }, B.token);
await sq(b2, [thor, iron], A);
await sq(b2, [wolv, spid], B);
let x = (await call("GET", `/battles/${b2}`, null, A.token)).j;
ok(
  x.me.options.find((o) => o.key === "it:nrg_s")?.reason === "Energy is full",
  "energy kit disabled at full energy",
);
ok(
  !(await call("GET", `/battles/${b2}`, null, B.token)).j.me.options.some(
    (o) => o.kind === "item",
  ),
  "team without items gets no item actions",
);
ok(
  (await call("POST", "/store/level-up", { charId: thor }, A.token)).s === 400,
  "cannot level up a hero during a battle",
);
await call(
  "POST",
  `/battles/${b2}/action`,
  { turn: 1, key: opt(x, "Lightning Storm").key },
  A.token,
);
await call(
  "POST",
  `/battles/${b2}/action`,
  { turn: 1, key: "defend" },
  B.token,
);
await wait(900);
x = (await call("GET", `/battles/${b2}`, null, A.token)).j;
const io = x.me?.options.find((o) => o.key === "it:nrg_s"),
  en2 = x.sides[0].chars.find((c) => c.id === thor).energy;
ok(
  x.turn === 2 && io && !io.reason && en2 < 100,
  "energy kit usable after spending energy (" + en2 + ")",
);
await call(
  "POST",
  `/battles/${b2}/action`,
  { turn: 2, key: "it:nrg_s" },
  A.token,
);
await call(
  "POST",
  `/battles/${b2}/action`,
  { turn: 2, key: "defend" },
  B.token,
);
x = (await call("GET", `/battles/${b2}`, null, A.token)).j;
const ie = x.turns[1]?.events.find((e) => e.k === "item");
ok(
  ie &&
    ie.amount === Math.min(20, 100 - en2) &&
    (await call("GET", "/me", null, A.token)).j.team.inventory.nrg_s === 0,
  "in-battle energy kit restores up to 20 energy and is used up",
);
await call("POST", `/battles/${b2}/forfeit`, {}, B.token);
x = (await call("GET", `/battles/${b2}`, null, A.token)).j;
ok(
  x.state === "Finished" && x.rewards[tA.id].bonus === 0,
  "no win bonus when the opponent forfeits before turn 3",
);
const bv = async (id, T) =>
  (await call("GET", `/battles/${id}`, null, T?.token)).j;
/* counter-offer */
const b3 = (
  await call(
    "POST",
    "/battles",
    { opponentTeamId: tB.id, squadSize: 2 },
    A.token,
  )
).j.id;
ok(
  (await call("POST", `/battles/${b3}/counter`, { squadSize: 1 }, A.token))
    .s === 403,
  "only the invited team can counter-offer",
);
ok(
  (await call("POST", `/battles/${b3}/counter`, { squadSize: 1 }, B.token))
    .s === 200,
  "Beta counters with 1v1",
);
x = await bv(b3, A);
ok(
  x.squadSize === 1 && x.invite.to === tA.id && x.invite.counter,
  "counter-offer goes back to the challenger",
);
ok(
  (await call("POST", `/battles/${b3}/respond`, { accept: true }, B.token))
    .s === 403,
  "the countering team cannot accept its own offer",
);
await call("POST", `/battles/${b3}/respond`, { accept: true }, A.token);
ok(
  (await sq(b3, [thor, iron], A)).s === 400 && (await sq(b3, [iron], A)).s === 200,
  "1v1 squad: exactly one hero",
);
await call("POST", `/battles/${b3}/forfeit`, {}, A.token);
/* draft: each side bans one enemy hero */
const b4 = (
  await call(
    "POST",
    "/battles",
    { opponentTeamId: tB.id, squadSize: 1, bans: true, ranked: false },
    A.token,
  )
).j.id;
ok(
  (
    await call(
      "POST",
      "/battles",
      { opponentTeamId: tB.id, squadSize: 2, bans: true },
      B.token,
    )
  ).s === 400,
  "a draft needs squad size + 1 heroes (and teams in a battle cannot be challenged)",
);
await call("POST", `/battles/${b4}/respond`, { accept: true }, B.token);
x = await bv(b4, A);
ok(
  x.state === "BanSelection" &&
    x.draft.find((d) => d.teamId === tB.id).pool.length === 2,
  "draft starts with the ban round",
);
const ban = (id, c, T) =>
  call("POST", `/battles/${id}/ban`, { charId: c }, T.token);
ok((await ban(b4, thor, A)).s === 400, "cannot ban your own hero");
await ban(b4, wolv, A);
x = await bv(b4, B);
ok(
  x.sides[0].ready === true && !/"banned":\{/.test(JSON.stringify(x)),
  "a locked ban stays hidden until both have banned",
);
await ban(b4, thor, B);
x = await bv(b4, A);
ok(
  x.state === "SquadSelection" &&
    x.draft.find((d) => d.teamId === tA.id).banned.id === wolv &&
    !x.draft.find((d) => d.teamId === tA.id).pool.some((c) => c.id === thor),
  "bans revealed; the banned hero leaves its team's pool",
);
ok(
  (await sq(b4, [thor], A)).s === 400 && (await sq(b4, [iron], A)).s === 200,
  "a banned hero cannot be picked",
);
await sq(b4, [spid], B);
x = await bv(b4, A);
ok(
  x.state === "ActionSelection" && x.sides[1].active === spid,
  "draft battle starts after the squads",
);
await call("POST", `/battles/${b4}/forfeit`, {}, B.token);
/* rematch */
const rm = await call("POST", `/battles/${b4}/rematch`, {}, A.token);
x = await bv(rm.j.id, B);
ok(
  rm.s === 200 &&
    x.state === "WaitingForPlayers" &&
    x.squadSize === 1 &&
    x.bans === 1 &&
    x.invite.to === tB.id,
  "rematch sends a new challenge with the same settings",
);
await call("POST", `/battles/${rm.j.id}/respond`, { accept: false }, B.token);
/* matchmaking */
const sg = (await call("GET", "/battles/suggest", null, A.token)).j;
ok(
  sg.length === 1 && sg[0].id === tB.id && sg[0].winChance > 0,
  "suggested opponents with win chance: " + JSON.stringify(sg[0]),
);
/* practice vs bot (+ ultimate charge and team-ups) */
const hulk = id("Hulk ("),
  thorAb = (await call("GET", "/admin/characters/export", null, adm)).j.find(
    (c) => c.id === thor,
  ).abilities;
await call(
  "PUT",
  "/admin/characters/" + thor,
  {
    abilities: thorAb.map((a) =>
      a.ultimate ? { ...a, unlockLevel: 1 } : a,
    ),
  },
  adm,
);
await call(
  "POST",
  "/admin/auction/correct",
  { charId: hulk, toTeamId: tA.id, price: 0, confirm: true },
  adm,
);
const ptsA = (await call("GET", "/me", null, A.token)).j.team,
  pr = (
    await call("POST", "/battles/practice", { squadSize: 2 }, A.token)
  ).j.id;
x = await bv(pr, A);
ok(
  x.practice &&
    x.state === "SquadSelection" &&
    x.teams[1].name === "Training Bot" &&
    x.sides[1].ready === true,
  "practice starts at once; the bot has locked its squad",
);
await sq(pr, [thor, hulk], A);
x = await bv(pr, A);
ok(
  x.state === "ActionSelection" &&
    x.sides[1].ready === true &&
    !x.me.options.some((o) => o.kind === "item"),
  "bot locks its action at once; no items in practice",
);
ok(
  opt(x, "God of Thunder")?.reason === "Charging: 0%",
  "an unlocked ultimate still needs a full charge",
);
ok(
  opt(x, "Thunder & Fury") && !opt(x, "Thunder & Fury").reason,
  "team-up move offered while the partner is in the squad",
);
await call(
  "POST",
  `/battles/${pr}/action`,
  { turn: 1, key: "attack" },
  A.token,
);
x = await bv(pr, A);
ok(
  x.turns.length === 1 && x.sides[0].chars.find((c) => c.id === thor).charge > 0,
  "practice turn resolves against the bot; charge builds",
);
await call("POST", `/battles/${pr}/forfeit`, {}, A.token);
const ptsA2 = (await call("GET", "/me", null, A.token)).j.team;
ok(
  ptsA2.rating === ptsA.rating &&
    ptsA2.points === ptsA.points &&
    ptsA2.losses === ptsA.losses,
  "practice changes no rating, points or record",
);
ok(
  (await call("POST", `/battles/${pr}/rematch`, {}, A.token)).s === 200,
  "practice rematch starts a new practice",
);
await call(
  "POST",
  `/battles/${(await call("GET", "/battles")).j[0].id}/forfeit`,
  {},
  A.token,
);
await call(
  "POST",
  "/admin/auction/correct",
  { charId: hulk, toTeamId: null, confirm: true },
  adm,
);
await call("PUT", "/admin/characters/" + thor, { abilities: thorAb }, adm);
/* tournament */
ok(
  (
    await call(
      "POST",
      "/admin/tournaments",
      { teamIds: [tA.id], squadSize: 1 },
      adm,
    )
  ).s === 400,
  "a tournament needs 2+ teams",
);
const pA0 = (await call("GET", "/me", null, A.token)).j.team.points,
  tn = await call(
    "POST",
    "/admin/tournaments",
    { name: "Test Cup", teamIds: [tA.id, tB.id], squadSize: 1, prize: 40 },
    adm,
  );
const m1 = tn.j.rounds?.[0][0];
x = m1?.battleId && (await bv(m1.battleId, A));
ok(
  tn.s === 200 &&
    m1.status === "playing" &&
    x.state === "SquadSelection" &&
    x.tournament.name === "Test Cup",
  "tournament starts the final at once (both teams free)",
);
await sq(m1.battleId, [iron], A);
await sq(m1.battleId, [spid], B);
await call("POST", `/battles/${m1.battleId}/forfeit`, {}, B.token);
const tl = (await call("GET", "/tournaments")).j[0];
ok(
  tl.status === "finished" &&
    tl.winner === tA.id &&
    (await call("GET", "/me", null, A.token)).j.team.points >= pA0 + 40,
  "tournament winner decided and prize points paid",
);
ok(
  (await call("POST", `/battles/${m1.battleId}/rematch`, {}, A.token)).s ===
    400,
  "tournament matches cannot be rematched",
);
/* campaign: heroes who fought rest */
const cb = (
  await call(
    "POST",
    "/battles",
    { opponentTeamId: tB.id, squadSize: 1, mode: "campaign", ranked: false },
    A.token,
  )
).j.id;
await call("POST", `/battles/${cb}/respond`, { accept: true }, B.token);
await sq(cb, [iron], A);
await sq(cb, [spid], B);
await call("POST", `/battles/${cb}/forfeit`, {}, B.token);
const rs = (await call("GET", "/me", null, A.token)).j.team.roster;
const cr = await call(
  "POST",
  "/battles",
  { opponentTeamId: tB.id, squadSize: 2, mode: "campaign" },
  A.token,
);
ok(
  rs.find((c) => c.id === iron).restUntil &&
    !rs.find((c) => c.id === thor).restUntil &&
    cr.s === 400 &&
    /rested/.test(cr.j.error),
  "campaign heroes who fought must rest: " + cr.j.error,
);
await call("POST", "/admin/auction/heal", { teamId: tA.id }, adm);
await call("POST", "/admin/auction/heal", { teamId: tB.id }, adm);
ok(
  !(await call("GET", "/me", null, A.token)).j.team.roster.some(
    (c) => c.restUntil,
  ),
  "admin heal also ends the rest",
);
/* admin features */
const nc = await call(
  "POST",
  "/admin/characters",
  {
    name: "Test Hero",
    rarity: "Rare",
    category: "Test",
    basePrice: 50,
    maxHealth: 200,
    attack: 50,
    defence: 40,
    speed: 30,
    abilities: [{ name: "Zap", kind: "attack", power: 1.5, cost: 10, cd: 1 }],
  },
  adm,
);
ok(nc.s === 200, "admin creates a character");
ok(
  (await call("POST", "/admin/characters", { name: "", rarity: "Rare" }, adm))
    .s === 400,
  "admin character validation rejects bad data",
);
ok(
  (await call("DELETE", "/admin/characters/" + nc.j.id, {}, adm)).s === 400,
  "delete needs confirmation",
);
ok(
  (
    await call(
      "DELETE",
      "/admin/characters/" + nc.j.id,
      { confirm: true, hard: true },
      adm,
    )
  ).s === 200,
  "confirmed delete works",
);
ok(
  (await call("POST", "/admin/reset", { confirm: "yes" }, adm)).s === 400,
  "reset needs explicit RESET",
);
/* persistence across restart */
await call("GET", "/state");
await wait(300);
const count = async () =>
  Object.fromEntries(
    await Promise.all(
      [
        "characters",
        "teams",
        "players",
        "sessions",
        "battles",
        "tournaments",
        "history",
        "meta",
      ].map(async (c) => [c, await mdb.collection(c).countDocuments()]),
    ),
  );
const nBattles = (await call("GET", "/battles")).j.length,
  cnt = await count();
ok(
  cnt.characters > 100 &&
    cnt.teams === 2 &&
    cnt.players === 2 &&
    cnt.sessions > 0 &&
    cnt.battles === nBattles &&
    cnt.tournaments === 1 &&
    cnt.history > 50 &&
    cnt.meta === 3,
  "all data stored in MongoDB: " + JSON.stringify(cnt),
);
const dA = await mdb.collection("teams").findOne({ _id: tA.id });
ok(
  dA.balance === tA.balance &&
    dA.inventory.med_m === 1 &&
    dA.points === (await call("GET", "/me", null, A.token)).j.team.points,
  "team document is up to date (balance, points, inventory)",
);
const hs = await mdb.collection("history").find().sort({ _i: 1 }).toArray();
ok(
  hs.every((e, i) => e._i === i && e._id === e.id),
  "history stored append-only and in order",
);
const bak = (await call("GET", "/admin/backup", null, adm)).j;
ok(
  bak.files.teams.length === 2 && !bak.files.admin,
  "backup exports data without admin credentials",
);
await stop();
// pretend Alpha claimed day 6 of a streak yesterday: today's gift is day 7
await mdb.collection("teams").updateOne(
  { _id: tA.id },
  {
    $set: {
      gift: {
        last: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
        streak: 6,
      },
    },
  },
);
await start(PORT + 1);
const U2 = "http://localhost:" + (PORT + 1);
const t2 = (await call("GET", "/teams", null, null, U2)).j;
ok(
  t2.length === 2 && t2.every((t) => t.roster.length === 2),
  "after restart rosters are restored",
);
const lg = await call(
  "POST",
  "/login",
  { username: "alice", password: "password1" },
  null,
  U2,
);
ok(lg.s === 200, "player can log in after restart");
r = await call("POST", "/store/gift", {}, lg.j.token, U2);
ok(
  r.s === 200 && r.j.day === 7 && r.j.points === 50 && r.j.item === "med_l",
  "a consecutive-day streak reaches the day-7 gift (50 points + Med Kit L)",
);
ok(
  (await call("GET", "/me", null, lg.j.token, U2)).j.team.balance ===
    tA.balance,
  "private balance persisted",
);
ok(
  (await call("GET", "/battles/" + ch.id, null, null, U2)).j.state ===
    "Finished",
  "battle history persisted",
);
const adm2 = (
  await call(
    "POST",
    "/admin/login",
    { username: "admin", password: "TestAdmin#123" },
    null,
    U2,
  )
).j.token;
ok(
  (
    await call(
      "POST",
      "/admin/restore",
      { confirm: true, files: { teams: 5 } },
      adm2,
      U2,
    )
  ).s === 400,
  "malformed backup rejected",
);
ok(
  (
    await call(
      "POST",
      "/admin/restore",
      { confirm: true, files: bak.files },
      adm2,
      U2,
    )
  ).s === 200,
  "valid backup restores",
);
ok(
  (await call("POST", "/admin/reset", { confirm: "RESET" }, adm2, U2)).s ===
    200 && (await call("GET", "/teams", null, null, U2)).j.length === 0,
  "reset with confirmation clears game state",
);
ok(
  (await call("GET", "/admin/history", null, adm2, U2)).j.events.some(
    (e) => e.type === "admin.game.reset",
  ),
  "history survives the reset and records it",
);
await wait(300);
await stop();
const c2 = await count();
ok(
  c2.teams === 0 &&
    c2.battles === 0 &&
    c2.tournaments === 0 &&
    c2.history > cnt.history,
  "reset is written to MongoDB (teams, battles and tournaments removed, history kept)",
);
/* corrupted document */
await mdb
  .collection("meta")
  .updateOne({ _id: "settings" }, { $set: { value: "garbage" } });
await start(PORT + 2);
const U3 = "http://localhost:" + (PORT + 2);
ok(
  (await call("GET", "/state", null, null, U3)).s === 200 &&
    (await call("GET", "/teams", null, null, U3)).j.length === 0 &&
    (await mdb.collection("corrupt").countDocuments({ part: "settings" })) ===
      1,
  "corrupted settings document is kept aside and defaults restored",
);
await wait(300);
await stop();
ok(
  (await mdb.collection("meta").findOne({ _id: "settings" })).value
    .startingBudget === 1000,
  "restored default settings are saved",
);
/* first start on an empty database: defaults are generated and written to MongoDB (no local files) */
await start(PORT + 3, { ...env, MONGODB_DB: "arena_fresh" });
const ft = (
  await call("GET", "/teams", null, null, "http://localhost:" + (PORT + 3))
).j;
await wait(300);
await stop();
const fdb = M.db("arena_fresh");
ok(
  ft.length === 0 &&
    (await fdb.collection("characters").countDocuments()) > 100 &&
    (await fdb.collection("meta").countDocuments()) === 3,
  "an empty database starts from generated defaults stored in MongoDB",
);
await M.close();
await mongo.stop();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
