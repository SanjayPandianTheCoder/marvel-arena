// Auction, battle state machine, rewards/store, history. Every mutation is synchronous (atomic) and followed by persist().
import { db, persist, uid } from "./store.js";
import { ITEMS, PERKS, TEAMUPS } from "./seed.js";
export class Err extends Error {
  constructor(m, c = 400) {
    super(m);
    this.code = c;
  }
}
export const bad = (m, c = 400) => {
  throw new Err(m, c);
};
let notify = () => {};
export const setNotify = (f) => {
  notify = f;
};
const S = () => db.settings,
  A = () => db.auction,
  BS = () => S().battle,
  now = () => Date.now(),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  rnd = (a, b) => a + Math.random() * (b - a);
export const getTeam = (id) => db.teams.find((t) => t.id === id),
  getChar = (id) => db.characters.find((c) => c.id === id),
  getBattle = (id) => db.battles.find((b) => b.id === id);
// the training bot is the second "team" of practice battles; it has no team record
export const BOT = "bot";
export const teamName = (id) =>
  id === BOT ? "Training Bot" : getTeam(id)?.name;
/* ---------------- hero progression: ability unlocks & ranks, perks, team-ups, XP ---------------- */
// non-ultimates unlock in listed order at 1, 1+unlockEvery, …; ultimates at ultimateLevel; an explicit unlockLevel wins
export function abilitiesOf(c, level = c.level || 1) {
  const s = S().store;
  let n = 0;
  return (c.abilities || []).map((a) => {
    const unlockLevel =
      a.unlockLevel ?? (a.ultimate ? s.ultimateLevel : 1 + s.unlockEvery * n);
    if (!a.ultimate) n++;
    const rank =
      level < unlockLevel
        ? 0
        : Math.min(3, 1 + Math.floor((level - unlockLevel) / s.rankEvery));
    return { ...a, unlockLevel, rank };
  });
}
// each rank above 1 adds rankBonus power/heal; rank 3 also shortens the cooldown
const ranked = (a) => {
  const f = 1 + S().store.rankBonus * Math.max(0, a.rank - 1);
  return {
    ...a,
    power: a.power && +(a.power * f).toFixed(2),
    heal: a.heal && +(a.heal * f).toFixed(3),
    cd: a.rank >= 3 && a.cd ? a.cd - 1 : a.cd,
  };
};
export const perksAt = (level) => PERKS.filter((p) => (level || 1) >= p.level);
const hasPerk = (c, id) => perksAt(c.level).some((p) => p.id === id);
export const teamUpsOf = (name) =>
  TEAMUPS.filter((t) => t.heroes.includes(name)).map((t) => ({
    ...t,
    partner: t.heroes.find((h) => h !== name),
  }));
export const xpNeed = (c) => S().store.xpPerLevel * (c.level || 1);
const resting = (c) => !!c.restUntil && Date.parse(c.restUntil) > now();
const shortName = (n) => String(n).replace(/\s*\(.*\)/, "");
/* ---------------- history (append-only) ---------------- */
export function logEv(type, o = {}) {
  const e = {
    id: uid("ev"),
    ts: new Date().toISOString(),
    type,
    gameId: S().gameId,
    actor: o.actor || { kind: "system" },
    teamId: o.team || null,
    playerId: o.player || null,
    characterId: o.char || null,
    battleId: o.battle || null,
    turn: o.turn ?? null,
    vis: o.vis || "public",
    details: o.d || {},
  };
  db.history.push(e);
  persist("history");
  return e;
}
/* ---------------- public projections (privacy is enforced here, not in CSS) ---------------- */
export const pubChar = (c, hide) =>
  hide
    ? {
        id: c.id,
        name: "Mystery Hero",
        universe: "Marvel",
        rarity: "???",
        category: "???",
        basePrice: c.basePrice,
        mystery: true,
        abilities: [],
      }
    : {
        id: c.id,
        name: c.name,
        short: c.short,
        image: c.image,
        universe: c.universe,
        rarity: c.rarity,
        category: c.category,
        basePrice: c.basePrice,
        maxHealth: c.maxHealth,
        currentHealth: c.currentHealth,
        attack: c.attack,
        defence: c.defence,
        speed: c.speed,
        energy: c.energy,
        maxEnergy: c.maxEnergy,
        abilities: abilitiesOf(c),
        perks: perksAt(c.level).map(({ id, name, desc }) => ({
          id,
          name,
          desc,
        })),
        teamUps: teamUpsOf(c.name).map((t) => ({
          name: t.name,
          partner: t.partner,
          desc: t.desc,
        })),
        xp: c.xp || 0,
        xpNext: xpNeed(c),
        restUntil: resting(c) ? c.restUntil : null,
        statusEffects: c.statusEffects,
        ownerTeamId: c.ownerTeamId,
        availability: c.availability,
        isAvailable: c.availability === "available" && !c.ownerTeamId,
        isEliminated: c.isEliminated,
        level: c.level || 1,
        record: c.record,
        powers: c.powers,
      };
const hiddenId = () =>
  A().current && A().current.mystery ? A().current.charId : null;
export const pubTeam = (t) => ({
  id: t.id,
  name: t.name,
  logo: t.logo || "",
  color: t.color,
  rating: t.rating,
  wins: t.wins,
  losses: t.losses,
  draws: t.draws,
  streak: t.streak,
  bestStreak: t.bestStreak,
  roster: t.roster
    .map((id) => getChar(id))
    .filter(Boolean)
    .map((c) => pubChar(c, c.id === hiddenId())),
});
export const privTeam = (t) => ({
  ...pubTeam(t),
  balance: t.balance,
  startingBalance: t.startingBalance,
  spent: t.startingBalance - t.balance,
  ledger: t.ledger.slice(-100),
  points: t.points,
  pointsEarned: t.pointsEarned,
  inventory: t.inventory,
  pointsLedger: t.pointsLedger.slice(-100),
  giftReady: giftState(t).available,
});
export const adminTeam = (t) => ({
  ...privTeam(t),
  players: db.players.players
    .filter((p) => p.teamId === t.id)
    .map((p) => ({ id: p.id, username: p.username })),
});
const ledger = (t, type, amount, o = {}) => {
  t.ledger.push({
    id: uid("tx"),
    ts: new Date().toISOString(),
    type,
    amount,
    balanceAfter: t.balance,
    ...o,
  });
};
/* ---------------- auction ---------------- */
let aTimer = null,
  gapTimer = null;
const slotsLeft = (t) => S().rosterLimit - t.roster.length;
export const reserve = (t) =>
  Math.max(0, slotsLeft(t) - 1) * S().auction.reservePerSlot;
export const maxBid = (t) => t.balance - reserve(t);
export function bidError(t, amount, charId) {
  const c = getChar(charId);
  if (slotsLeft(t) <= 0) return "Your roster is full";
  if (c.ownerTeamId) return "Character already owned";
  const lim = S().maxPerCategory;
  if (
    lim > 0 &&
    t.roster.filter((id) => getChar(id)?.category === c.category).length >= lim
  )
    return `Category limit reached (${lim} × ${c.category})`;
  if (amount > maxBid(t))
    return `Insufficient funds: your limit for this bid is ${Math.max(0, maxBid(t))}`;
  return "";
}
export const nextBid = () => {
  const c = A().current;
  return c.teamId == null
    ? getChar(c.charId).basePrice
    : c.bid + S().auction.increment;
};
export function configureAuction(cfg, actor) {
  const a = A();
  if (["live", "paused"].includes(a.status))
    bad("Auction is running; end it first");
  const mode = ["complete", "random", "custom"].includes(cfg.mode)
      ? cfg.mode
      : "complete",
    avail = db.characters
      .filter((c) => c.availability === "available" && !c.ownerTeamId)
      .map((c) => c.id);
  let ids;
  if (mode === "complete") ids = avail;
  else if (mode === "random")
    ids = [...avail]
      .sort(() => Math.random() - 0.5)
      .slice(0, clamp(+cfg.count || 60, 1, 500));
  else {
    ids = [...new Set(cfg.ids || [])];
    if (ids.some((i) => !avail.includes(i)))
      bad("Custom pool contains unavailable characters");
  }
  if (!ids.length) bad("Pool is empty");
  Object.assign(S().auction, {
    increment: clamp(+cfg.increment || S().auction.increment, 1, 10000),
    timer: clamp(+(cfg.timer ?? S().auction.timer), 0, 600),
    mysteryPct: clamp(+cfg.mysteryPct || 0, 0, 100),
    maxRaises: clamp(+cfg.maxRaises || 0, 0, 50),
    mode,
  });
  Object.assign(a, {
    status: "ready",
    config: { mode, size: ids.length },
    queue: ids,
    idx: 0,
    current: null,
    sold: [],
    unsold: [],
    lastResult: null,
  });
  logEv("auction.configured", { actor, d: { mode, size: ids.length } });
  persist("auction", "settings");
  notify("auction");
}
export function startAuction(actor) {
  const a = A();
  if (a.status === "live") bad("Already live");
  if (!["ready", "paused", "ended"].includes(a.status) || !a.queue.length)
    bad("Configure an auction first");
  if (a.status === "ended" && a.idx >= a.queue.length)
    bad("Auction finished; configure a new one");
  if (db.teams.length < 2) bad("Need at least 2 teams");
  a.status = "live";
  logEv("auction.started", { actor });
  openLot();
}
export function openLot() {
  const a = A();
  clearTimeout(aTimer);
  clearTimeout(gapTimer);
  if (a.status !== "live") return;
  while (
    a.idx < a.queue.length &&
    (getChar(a.queue[a.idx])?.ownerTeamId ||
      getChar(a.queue[a.idx])?.availability !== "available")
  )
    a.idx++;
  if (a.idx >= a.queue.length || db.teams.every((t) => slotsLeft(t) <= 0)) {
    a.status = "ended";
    a.current = null;
    logEv("auction.completed", {
      d: { sold: a.sold.length, unsold: a.unsold.length },
    });
    persist("auction");
    return notify("auction");
  }
  const s = S().auction,
    c = getChar(a.queue[a.idx]);
  a.current = {
    charId: c.id,
    bid: c.basePrice,
    teamId: null,
    bids: [],
    passed: [],
    raises: {},
    mystery: Math.random() * 100 < s.mysteryPct,
    deadline: s.timer ? now() + s.timer * 1000 : null,
    remaining: null,
  };
  logEv("auction.lot.opened", {
    char: c.id,
    d: { base: c.basePrice, lot: a.idx + 1, mystery: a.current.mystery },
  });
  arm();
  persist("auction");
  notify("auction");
}
function arm() {
  clearTimeout(aTimer);
  const a = A();
  if (a.status !== "live" || !a.current || !a.current.deadline) return;
  aTimer = setTimeout(
    () => {
      try {
        closeLot("timer");
      } catch (e) {
        console.error(e);
      }
    },
    Math.max(0, a.current.deadline - now()),
  );
}
const open = () => {
  const a = A(),
    c = a.current,
    n = nextBid();
  return db.teams.some(
    (t) =>
      t.id !== c.teamId &&
      !c.passed.includes(t.id) &&
      !bidError(t, n, c.charId),
  );
};
export function bid(teamId, amount) {
  const a = A(),
    t = getTeam(teamId);
  if (!t) bad("You do not have a team", 403);
  if (a.status !== "live" || !a.current) bad("No lot is open");
  const c = a.current;
  amount = Math.round(+amount);
  const reject = (m) => {
    logEv("bid.rejected", {
      team: teamId,
      char: c.charId,
      vis: "admin",
      d: { amount, reason: m },
    });
    bad(m);
  };
  if (!Number.isFinite(amount)) reject("Invalid amount");
  if (c.teamId === teamId) reject("You are already the highest bidder");
  if (c.passed.includes(teamId)) reject("You passed on this lot");
  if (amount < nextBid()) reject("Minimum bid is " + nextBid());
  const e = bidError(t, amount, c.charId);
  if (e) reject(e);
  const mr = S().auction.maxRaises;
  if (mr && (c.raises[teamId] || 0) >= mr)
    reject(`Bid-war limit: ${mr} raises per team per lot`);
  c.bid = amount;
  c.teamId = teamId;
  c.raises[teamId] = (c.raises[teamId] || 0) + 1;
  c.bids.push({ teamId, teamName: t.name, amount, ts: now() });
  if (c.deadline) c.deadline = now() + S().auction.timer * 1000;
  logEv("bid.placed", {
    team: teamId,
    char: c.charId,
    d: { amount, teamName: t.name },
  });
  persist("auction");
  arm();
  notify("auction");
  if (!open()) closeLot("all-passed");
}
export function passLot(teamId) {
  const a = A(),
    c = a.current;
  if (!getTeam(teamId)) bad("You do not have a team", 403);
  if (a.status !== "live" || !c) bad("No lot is open");
  if (c.teamId === teamId) bad("The leading bidder cannot pass");
  if (!c.passed.includes(teamId)) c.passed.push(teamId);
  logEv("lot.passed", { team: teamId, char: c.charId });
  persist("auction");
  notify("auction");
  if (!open()) closeLot("all-passed");
}
export function closeLot(reason) {
  const a = A(),
    c = a.current;
  if (!c || a.status !== "live") return;
  clearTimeout(aTimer);
  const ch = getChar(c.charId);
  if (c.teamId) {
    const t = getTeam(c.teamId);
    t.balance -= c.bid;
    t.roster.push(ch.id);
    ch.ownerTeamId = t.id;
    ledger(t, "purchase", -c.bid, { charId: ch.id, charName: ch.name });
    a.sold.push({ charId: ch.id, teamId: t.id, price: c.bid, ts: now() });
    a.lastResult = {
      type: "sold",
      charId: ch.id,
      name: ch.name,
      team: t.name,
      price: c.bid,
    };
    logEv("character.purchased", {
      team: t.id,
      char: ch.id,
      d: { price: c.bid, teamName: t.name, charName: ch.name, reason },
    });
    logEv("balance.changed", {
      team: t.id,
      vis: "team",
      d: { delta: -c.bid, balance: t.balance, why: "purchase" },
    });
    persist("teams", "characters");
  } else {
    a.unsold.push(ch.id);
    a.lastResult = { type: "unsold", charId: ch.id, name: ch.name };
    logEv("lot.unsold", { char: ch.id });
  }
  a.current = null;
  a.idx++;
  persist("auction");
  notify("auction");
  notify("data");
  gapTimer = setTimeout(openLot, S().auction.lotGapMs);
}
export function pauseAuction(actor) {
  const a = A();
  if (a.status !== "live") bad("Not live");
  clearTimeout(aTimer);
  clearTimeout(gapTimer);
  if (a.current && a.current.deadline) {
    a.current.remaining = Math.max(0, a.current.deadline - now());
    a.current.deadline = null;
  }
  a.status = "paused";
  logEv("auction.paused", { actor });
  persist("auction");
  notify("auction");
}
export function resumeAuction(actor) {
  const a = A();
  if (a.status !== "paused") bad("Not paused");
  a.status = "live";
  if (a.current) {
    if (a.current.remaining != null)
      a.current.deadline = now() + a.current.remaining;
    arm();
  } else gapTimer = setTimeout(openLot, 500);
  logEv("auction.resumed", { actor });
  persist("auction");
  notify("auction");
}
export function endAuction(actor) {
  const a = A();
  clearTimeout(aTimer);
  clearTimeout(gapTimer);
  a.status = "ended";
  a.current = null;
  logEv("auction.ended", { actor, d: { cancelled: true } });
  persist("auction");
  notify("auction");
}
export function lots(op, body, actor) {
  const a = A(),
    from = a.idx + (a.current ? 1 : 0);
  if (op === "add") {
    const c = getChar(body.charId);
    if (!c || c.ownerTeamId || c.availability !== "available")
      bad("Character unavailable");
    if (a.queue.indexOf(c.id) >= a.idx && a.queue.includes(c.id))
      bad("Already queued");
    a.queue.splice(clamp(+body.pos ?? from, from, a.queue.length), 0, c.id);
  } else if (op === "remove") {
    const i = a.queue.indexOf(body.charId);
    if (i < from) bad("Lot already played or running");
    a.queue.splice(i, 1);
  } else if (op === "reorder") {
    const rest = a.queue.slice(from);
    if (
      !Array.isArray(body.ids) ||
      body.ids.length !== rest.length ||
      body.ids.some((i) => !rest.includes(i))
    )
      bad("Reorder must list exactly the upcoming lots");
    a.queue = a.queue.slice(0, from).concat(body.ids);
  }
  logEv("admin.lots." + op, { actor, char: body.charId || null, d: body });
  persist("auction");
  notify("auction");
}
export function retain({ teamId, charId, price }, actor) {
  const t = getTeam(teamId),
    c = getChar(charId);
  if (!t || !c) bad("Unknown team or character", 404);
  if (c.ownerTeamId) bad("Already owned");
  price = Math.round(+price);
  if (!(price >= 0)) bad("Invalid price");
  const e = bidError(t, price, charId);
  if (e) bad(e);
  t.balance -= price;
  t.roster.push(c.id);
  c.ownerTeamId = t.id;
  ledger(t, "retention", -price, { charId: c.id, charName: c.name });
  A().queue = A().queue.filter(
    (id, i) => id !== c.id || i < A().idx + (A().current ? 1 : 0),
  );
  logEv("character.retained", {
    actor,
    team: t.id,
    char: c.id,
    d: { price, teamName: t.name, charName: c.name },
  });
  persist("teams", "characters", "auction");
  notify("data");
}
export function bonus({ teamId, amount, trailing }, actor) {
  amount = Math.round(+amount);
  if (!(amount > 0)) bad("Amount must be positive");
  let ts = teamId
    ? [getTeam(teamId)]
    : trailing
      ? (() => {
          const sc = db.teams.map((t) => [
              t,
              t.roster.reduce((s, id) => s + (getChar(id)?.maxHealth || 0), 0),
            ]),
            avg = sc.reduce((s, x) => s + x[1], 0) / Math.max(1, sc.length);
          return sc.filter((x) => x[1] < avg).map((x) => x[0]);
        })()
      : [];
  ts = ts.filter(Boolean);
  if (!ts.length) bad("No eligible teams");
  ts.forEach((t) => {
    t.balance += amount;
    ledger(t, "bonus", amount, { note: "Bonus purse" });
    logEv("balance.changed", {
      actor,
      team: t.id,
      vis: "team",
      d: { delta: amount, balance: t.balance, why: "bonus purse" },
    });
  });
  logEv("admin.bonus", { actor, d: { amount, teams: ts.map((t) => t.name) } });
  persist("teams");
  notify("data");
}
export function emergency(actor) {
  const a = A(),
    need = db.teams.reduce(
      (s, t) => s + Math.max(0, S().minRoster - t.roster.length),
      0,
    );
  if (!need) bad("Every team meets the minimum roster");
  const q = new Set(a.queue.slice(a.idx)),
    pick = db.characters
      .filter(
        (c) => c.availability === "available" && !c.ownerTeamId && !q.has(c.id),
      )
      .sort((x, y) => x.basePrice - y.basePrice)
      .slice(0, need)
      .map((c) => c.id);
  a.queue.splice(a.idx + (a.current ? 1 : 0), 0, ...pick);
  logEv("admin.emergency.lots", { actor, d: { added: pick.length } });
  persist("auction");
  notify("auction");
  return pick.length;
}
export function correctSale({ charId, toTeamId, price }, actor) {
  const c = getChar(charId);
  if (!c) bad("Unknown character", 404);
  const before = { owner: c.ownerTeamId };
  price = Math.round(+price || 0);
  if (c.ownerTeamId) {
    const o = getTeam(c.ownerTeamId),
      p = [...o.ledger]
        .reverse()
        .find((x) => x.charId === c.id && x.amount < 0),
      refund = p ? -p.amount : 0;
    o.balance += refund;
    o.roster = o.roster.filter((i) => i !== c.id);
    ledger(o, "correction", refund, { charId: c.id, note: "Admin refund" });
    before.refund = refund;
  }
  c.ownerTeamId = null;
  if (toTeamId) {
    const t = getTeam(toTeamId);
    if (!t) bad("Unknown team", 404);
    if (price > t.balance) bad("New owner cannot afford that price");
    t.balance -= price;
    t.roster.push(c.id);
    c.ownerTeamId = t.id;
    ledger(t, "correction", -price, { charId: c.id, note: "Admin transfer" });
  }
  logEv("admin.correction", {
    actor,
    char: c.id,
    d: { before, after: { owner: c.ownerTeamId, price } },
  });
  persist("teams", "characters");
  notify("data");
}
export function bootAuction() {
  const a = A();
  if (a.status === "live") {
    if (a.current) arm();
    else gapTimer = setTimeout(openLot, 1000);
  }
}
export function auctionView(sess) {
  const a = A(),
    c = a.current,
    t = sess?.teamId ? getTeam(sess.teamId) : null,
    ch = c ? getChar(c.charId) : null;
  return {
    status: a.status,
    config: a.config,
    increment: S().auction.increment,
    timer: S().auction.timer,
    rosterLimit: S().rosterLimit,
    lot: a.idx + 1,
    total: a.queue.length,
    upcoming: Math.max(0, a.queue.length - a.idx - (c ? 1 : 0)),
    lastResult: a.lastResult,
    unsold: a.unsold.length,
    sold: a.sold
      .slice(-30)
      .reverse()
      .map((s) => ({
        charId: s.charId,
        name: getChar(s.charId)?.name,
        team: getTeam(s.teamId)?.name,
        price: s.price,
      })),
    current: c && {
      char: pubChar(ch, c.mystery),
      bid: c.bid,
      leader: c.teamId ? { id: c.teamId, name: getTeam(c.teamId).name } : null,
      bids: c.bids.slice(-12).reverse(),
      passed: c.passed,
      deadline: c.deadline,
      paused: a.status === "paused",
      next: nextBid(),
      mystery: c.mystery,
    },
    me: t && {
      teamId: t.id,
      balance: t.balance, // the caller's own team only
      max: Math.max(0, maxBid(t)),
      leading: !!c && c.teamId === t.id,
      passed: !!c && c.passed.includes(t.id),
      // why the next bid would be refused (roster full, funds after the slot reserve, …); empty when it would be accepted
      blocked:
        c &&
        a.status === "live" &&
        c.teamId !== t.id &&
        !c.passed.includes(t.id)
          ? bidError(t, nextBid(), c.charId)
          : "",
      canBid:
        !!c &&
        a.status === "live" &&
        c.teamId !== t.id &&
        !c.passed.includes(t.id) &&
        !bidError(t, nextBid(), c.charId),
    },
  };
}
/* ---------------- battles ---------------- */
const timers = new Map(),
  active = (b) =>
    !["Finished", "BattleCancelled", "Declined"].includes(b.state);
const living = (s) => Object.values(s.chars).filter((c) => !c.eliminated);
function setTimer(b, ms, fn) {
  clearTimeout(timers.get(b.id));
  b.deadline = ms ? now() + ms : null;
  if (ms)
    timers.set(
      b.id,
      setTimeout(() => {
        try {
          fn(b);
        } catch (e) {
          console.error(e);
        }
      }, ms),
    );
}
// heroes a team can field: everyone in arena mode; healthy, rested heroes in campaign mode
const eligible = (t, mode) =>
  t.roster
    .map(getChar)
    .filter(
      (c) => c && (mode !== "campaign" || (c.currentHealth > 0 && !resting(c))),
    );
const inBattle = (teamId) =>
  db.battles.some((b) => active(b) && b.teams.includes(teamId));
const sizeOf = (v) => {
  const n =
    v == null || v === ""
      ? Math.min(BS().squadSize, S().rosterLimit)
      : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > S().rosterLimit)
    bad(`Squad size must be a whole number from 1 to ${S().rosterLimit}`);
  return n;
};
// every team must be able to field exactly `size` heroes (plus one more per ban the opponent makes)
function checkTeams(ts, mode, size, bans) {
  for (const t of ts) {
    const n = eligible(t, mode).length,
      need = size + bans;
    if (n < need)
      bad(
        `${t.name} has ${n} hero${n === 1 ? "" : "es"} able to fight${mode === "campaign" ? " (healthy and rested)" : ""}; a ${size}v${size}${bans ? " draft" : ""} battle needs ${need}`,
      );
  }
}
const newBattle = (teams, o) => {
  const b = {
    id: uid("bt"),
    teams,
    mode: "arena",
    ranked: false,
    state: null,
    turn: 0,
    created: new Date().toISOString(),
    updated: now(),
    invite: null,
    sides: {},
    turns: [],
    winner: null,
    result: null,
    reason: null,
    replace: [],
    deadline: null,
    disputes: [],
    counters: 0,
    ...o,
  };
  db.battles.push(b);
  return b;
};
export function challenge(teamId, oppId, o = {}) {
  const A_ = getTeam(teamId),
    B_ = getTeam(oppId);
  if (!A_ || !B_) bad("Unknown team", 404);
  if (teamId === oppId) bad("Pick a different opponent");
  const mode = ["arena", "campaign"].includes(o.mode) ? o.mode : BS().mode,
    size = sizeOf(o.squadSize),
    bans = o.bans ? 1 : 0;
  for (const t of [A_, B_])
    if (inBattle(t.id)) bad(t.name + " is already in a battle");
  checkTeams([A_, B_], mode, size, bans);
  const b = newBattle([teamId, oppId], {
    mode,
    ranked: !!(o.ranked !== false && BS().ranked),
    state: "WaitingForPlayers",
    invite: { from: teamId, to: oppId },
    squadSize: size,
    bans,
  });
  logEv("battle.invited", {
    team: teamId,
    battle: b.id,
    d: { to: oppId, mode, squadSize: size, bans },
  });
  persist("battles");
  notify("battle", b.id);
  return b;
}
// the invited team proposes another squad size; the invite then goes back to the challenger
export function counter(b, teamId, squadSize) {
  if (b.state !== "WaitingForPlayers") bad("Not awaiting a response");
  if (b.invite.to !== teamId)
    bad("Only the invited team can propose a change", 403);
  if ((b.counters || 0) >= 3) bad("Too many counter-offers: accept or decline");
  const size = sizeOf(squadSize);
  if (size === b.squadSize) bad(`The challenge is already ${size}v${size}`);
  checkTeams(b.teams.map(getTeam), b.mode, size, b.bans || 0);
  b.squadSize = size;
  b.counters = (b.counters || 0) + 1;
  b.invite = { from: teamId, to: b.invite.from, counter: true };
  logEv("battle.countered", {
    team: teamId,
    battle: b.id,
    d: { squadSize: size },
  });
  save(b);
}
function mkSide(teamId, mode, ids) {
  const squad = ids.map(getChar).filter(Boolean),
    cnt = {};
  squad.forEach((c) => (cnt[c.category] = (cnt[c.category] || 0) + 1));
  const chars = {};
  squad.forEach((c) => {
    const fb =
        BS().factionBonus && cnt[c.category] >= 3
          ? 0.05 * (Math.min(cnt[c.category], 5) - 2)
          : 0,
      hp = mode === "campaign" ? c.currentHealth : c.maxHealth;
    chars[c.id] = {
      id: c.id,
      name: c.name,
      hp,
      max: c.maxHealth,
      energy: mode === "campaign" ? c.energy : c.maxEnergy,
      maxEnergy: c.maxEnergy,
      attack: Math.round(c.attack * (1 + fb)),
      defence: c.defence,
      speed: c.speed,
      level: c.level || 1,
      faction: fb,
      charge: 0,
      entered: false,
      cd: {},
      status: {},
      eliminated: hp <= 0,
    };
  });
  return {
    teamId,
    chars,
    active: null,
    pending: null,
    locked: null,
    timeouts: 0,
    items: 0,
  };
}
export function respond(b, teamId, accept) {
  if (b.state !== "WaitingForPlayers") bad("Not awaiting a response");
  if (b.invite.to !== teamId) bad("Only the invited team can respond", 403);
  if (!accept) {
    b.state = "Declined";
    logEv("battle.declined", { team: teamId, battle: b.id });
    persist("battles");
    return notify("battle", b.id);
  }
  b.squadSize ??= sizeOf(); // invites sent before squad sizes existed
  b.bans ??= 0;
  checkTeams(b.teams.map(getTeam), b.mode, b.squadSize, b.bans);
  logEv("battle.started", {
    battle: b.id,
    d: { teams: b.teams, mode: b.mode, squadSize: b.squadSize },
  });
  openDraft(b);
}
// an accepted battle starts with the optional ban round, then both teams lock their squad in secret
function openDraft(b) {
  b.pool = Object.fromEntries(
    b.teams.map((id) => [
      id,
      id === BOT ? b.pool[BOT] : eligible(getTeam(id), b.mode).map((c) => c.id),
    ]),
  );
  b.picks = Object.fromEntries(
    b.teams.map((id) => [id, { ban: null, squad: null }]),
  );
  b.banned = null;
  b.state = b.bans ? "BanSelection" : "SquadSelection";
  setTimer(b, BS().selectTimer * 1000, onDeadline);
  save(b);
}
const other = (b, id) => b.teams.find((x) => x !== id);
export function ban(b, teamId, charId) {
  const p = b.picks?.[teamId];
  if (!p) bad("You are not in this battle", 403);
  if (b.state !== "BanSelection") bad("The ban round is not open");
  if (p.ban) return { already: true };
  if (!b.pool[other(b, teamId)].includes(charId))
    bad("Ban one of your opponent's heroes");
  p.ban = charId;
  logEv("battle.ban.locked", { team: teamId, battle: b.id, vis: "admin" });
  if (b.teams.every((id) => b.picks[id].ban)) revealBans(b);
  else save(b);
  return {};
}
function revealBans(b) {
  b.banned = {};
  b.teams.forEach((id) => {
    const c = b.picks[id].ban,
      opp = other(b, id);
    b.banned[id] = { id: c, name: getChar(c)?.name };
    b.pool[opp] = b.pool[opp].filter((x) => x !== c);
  });
  logEv("battle.banned", {
    battle: b.id,
    d: {
      bans: b.teams.map((id) => ({
        team: teamName(id),
        hero: b.banned[id].name,
      })),
    },
  });
  b.state = "SquadSelection";
  setTimer(b, BS().selectTimer * 1000, onDeadline);
  save(b);
}
// exactly squadSize heroes from the team's own pool; the first one starts the fight
export function pickSquad(b, teamId, ids) {
  const p = b.picks?.[teamId];
  if (!p) bad("You are not in this battle", 403);
  if (b.state !== "SquadSelection") bad("Squad selection is not open");
  if (p.squad) return { already: true };
  const n = b.squadSize;
  if (
    !Array.isArray(ids) ||
    new Set(ids).size !== ids.length ||
    ids.length !== n
  )
    bad(`Pick exactly ${n} different hero${n === 1 ? "" : "es"}`);
  if (ids.some((id) => !b.pool[teamId].includes(id)))
    bad("Pick heroes from your own available roster");
  p.squad = ids;
  logEv("battle.squad.locked", { team: teamId, battle: b.id, vis: "admin" });
  if (b.teams.every((id) => b.picks[id].squad)) startFight(b);
  else save(b);
  return {};
}
// strongest first: level, then stats (and current health in campaign mode)
const strongest = (ids, mode) =>
  ids
    .map(getChar)
    .filter(Boolean)
    .map((c) => [
      c.id,
      ((c.level || 1) * 100 + c.attack + c.defence + c.maxHealth / 5) *
        (mode === "campaign" ? c.currentHealth / c.maxHealth : 1),
    ])
    .sort((x, y) => y[1] - x[1])
    .map((x) => x[0]);
const snapOf = (s) =>
  Object.fromEntries(
    Object.values(s.chars).map((c) => [
      c.id,
      { hp: c.hp, energy: c.energy, charge: c.charge },
    ]),
  );
function startFight(b) {
  b.teams.forEach((id) => {
    const sq = b.picks[id].squad,
      s = (b.sides[id] = mkSide(id, b.mode, sq));
    enter(s, sq[0]);
    logEv("battle.character.selected", {
      team: id === BOT ? null : id,
      battle: b.id,
      char: s.active,
      d: {
        name: s.chars[s.active].name,
        squad: sq.map((c) => s.chars[c].name),
      },
    });
  });
  b.start = {
    active: Object.fromEntries(b.teams.map((id) => [id, b.sides[id].active])),
    chars: Object.fromEntries(b.teams.map((id) => [id, snapOf(b.sides[id])])),
  };
  b.kills = {};
  if (!b.practice) {
    b.rewardFactor = rewardFactor(b);
    b.rewards = Object.fromEntries(
      b.teams.map((id) => [id, { kills: 0, killPts: 0, bonus: 0, total: 0 }]),
    );
  }
  beginTurn(b, 1);
}
// a hero takes the field; a Veteran's first entry comes with a shield
function enter(s, id) {
  s.active = id;
  const c = s.chars[id];
  if (c.entered) return;
  c.entered = true;
  if (hasPerk(c, "veteran")) c.status.guard = { turns: 1, mag: 0.3 };
}
const save = (b) => {
  b.updated = now();
  persist("battles");
  notify("battle", b.id);
};
function autoPick(s) {
  return living(s).sort((x, y) => y.hp - x.hp)[0].id;
}
export function selectChar(b, teamId, charId) {
  const s = b.sides[teamId];
  if (!s) bad("You are not in this battle", 403);
  if (b.state === "CharacterSelection") {
    if (s.pending) return { already: true };
    if (!s.chars[charId] || s.chars[charId].eliminated)
      bad("Pick a living character");
    s.pending = charId;
    logEv("battle.character.locked", {
      team: teamId,
      battle: b.id,
      vis: "admin",
    });
    if (b.teams.every((id) => b.sides[id].pending))
      (b.teams.forEach((id) => {
        const x = b.sides[id];
        enter(x, x.pending);
        x.pending = null;
        logEv("battle.character.selected", {
          team: id,
          battle: b.id,
          char: x.active,
          d: { name: x.chars[x.active].name },
        });
      }),
        beginTurn(b, 1));
    else save(b);
    return {};
  }
  if (b.state === "CharacterReplacement") {
    if (!b.replace.includes(teamId)) bad("You do not need a replacement");
    if (!s.chars[charId] || s.chars[charId].eliminated)
      bad("Pick a living character");
    enter(s, charId);
    b.replace = b.replace.filter((i) => i !== teamId);
    logEv("battle.character.selected", {
      team: teamId,
      battle: b.id,
      char: charId,
      d: { name: s.chars[charId].name, replacement: true },
    });
    if (!b.replace.length) beginTurn(b, b.turn + 1);
    else save(b);
    return {};
  }
  bad("Character selection is not open");
}
function beginTurn(b, n) {
  b.turn = n;
  b.state = "ActionSelection";
  b.teams.forEach((id) => (b.sides[id].locked = null));
  if (b.practice) b.sides[BOT].locked = botChoice(b);
  setTimer(b, BS().actionTimer * 1000, onDeadline);
  save(b);
}
// the training bot: heals when low, fires its ultimate when charged, otherwise its strongest affordable attack
function botChoice(b) {
  const s = b.sides[BOT],
    c = s.chars[s.active],
    opts = catalog(b, BOT),
    ok = opts.filter((o) => !o.reason && !["switch", "pass"].includes(o.kind)),
    best = (f) =>
      ok.filter(f).sort((x, y) => (y.power || 0) - (x.power || 0))[0];
  return (
    (c.hp < c.max * 0.3 && best((o) => o.kind === "heal")) ||
    best((o) => o.ultimate) ||
    (Math.random() < 0.2 && best((o) => o.kind === "buff")) ||
    best((o) => o.kind === "attack") ||
    opts.find((o) => o.key === "defend")
  );
}
export function catalog(b, tid) {
  const s = b.sides[tid],
    c = s.chars[s.active],
    U = BS().actions,
    ch = getChar(s.active),
    out = [];
  const add = (key, label, kind, o) => {
    let reason = "";
    if ((o.cost || 0) > c.energy) reason = "Needs " + o.cost + " energy";
    else if (c.cd[key] > 0) reason = "Cooldown: " + c.cd[key] + " turn(s)";
    else if (c.status.root && o.noRoot) reason = "Rooted";
    out.push({ key, label, kind, reason, ...o });
  };
  add("attack", "Basic Attack", "attack", {
    power: U.attack.power,
    cost: U.attack.cost,
    desc: "Reliable strike",
  });
  add("heavy", "Heavy Attack", "attack", {
    power: U.heavy.power,
    cost: U.heavy.cost,
    cd: U.heavy.cd,
    acc: U.heavy.acc,
    desc: "Big damage, may miss",
  });
  add("defend", "Defensive Stance", "buff", {
    self: { status: "guard", turns: 1, mag: U.defend.mag },
    gain: U.defend.gain,
    cost: 0,
    desc: "Take " + Math.round(U.defend.mag * 100) + "% less damage",
  });
  add("dodge", "Dodge", "buff", {
    self: { status: "evade", turns: 1, mag: U.dodge.mag },
    cost: U.dodge.cost,
    noRoot: 1,
    desc: "Much harder to hit",
  });
  add("recover", "Recover", "heal", {
    heal: U.recover.heal,
    cost: U.recover.cost,
    cd: U.recover.cd,
    desc: "Restore " + Math.round(U.recover.heal * 100) + "% health",
  });
  // abilities above the hero's level are listed but locked; ultimates need a full charge instead of a cooldown
  (ch ? abilitiesOf(ch, c.level ?? ch.level) : []).forEach((a0) => {
    const a = ranked(a0),
      why = !a.rank
        ? `Unlocks at Lv ${a.unlockLevel}`
        : a.ultimate && (c.charge ?? 100) < 100
          ? `Charging: ${c.charge}%`
          : "";
    add("ab:" + a.id, a.name, a.kind, {
      power: a.power,
      cost: a.cost,
      cd: a.ultimate ? 0 : a.cd,
      self: a.self,
      foe: a.foe,
      heal: a.heal,
      acc: a.acc,
      desc: a.desc,
      noRoot: a.self?.status === "evade",
      rank: a.rank,
      unlockLevel: a.unlockLevel,
      ultimate: !!a.ultimate,
      ...(why ? { reason: why } : {}),
    });
  });
  teamUpsOf(c.name).forEach((t) => {
    const mate = Object.values(s.chars).find(
      (x) => x.name === t.partner && !x.eliminated && x.id !== c.id,
    );
    if (mate)
      add("tu:" + t.id, t.name, t.kind, {
        power: t.power,
        cost: t.cost,
        cd: t.cd,
        self: t.self,
        foe: t.foe,
        heal: t.heal,
        desc: `${t.desc} (team-up with ${shortName(mate.name)})`,
        teamUp: true,
      });
  });
  const maxItems = b.practice ? 0 : ST().maxItemsPerBattle;
  if (maxItems)
    Object.entries(getTeam(tid)?.inventory || {}).forEach(([id, n]) => {
      const it = ITEMS[id];
      if (!it || !(n > 0)) return;
      const hpK = it.kind === "hp";
      add("it:" + id, `${it.name} (×${n})`, "item", {
        item: id,
        cost: 0,
        desc: `Restore ${Math.round(it.pct * 100)}% ${hpK ? "health" : "energy"}`,
        reason:
          (s.items || 0) >= maxItems
            ? `Item limit reached (${maxItems} per battle)`
            : hpK && c.hp >= c.max
              ? "Health is full"
              : !hpK && c.energy >= c.maxEnergy
                ? "Energy is full"
                : "",
      });
    });
  if (BS().allowPass)
    add("pass", "Pass Turn", "pass", {
      cost: 0,
      gain: 5,
      desc: "Do nothing, recover a little energy",
    });
  if (BS().allowSwitch)
    Object.values(s.chars).forEach((x) => {
      if (x.id !== s.active && !x.eliminated)
        add("sw:" + x.id, "Switch to " + x.name, "switch", {
          cost: 0,
          charId: x.id,
          noRoot: 1,
          desc: `HP ${x.hp}/${x.max}`,
        });
    });
  return out;
}
export function submit(b, teamId, { turn, key }) {
  const s = b.sides[teamId];
  if (!s) bad("You are not in this battle", 403);
  if (b.state !== "ActionSelection") bad("Actions are not open");
  if (+turn !== b.turn) bad("Stale turn; refresh");
  if (s.locked) return { already: true };
  const a = catalog(b, teamId).find((x) => x.key === key);
  if (!a) bad("Unknown action");
  if (a.reason) bad(a.reason);
  s.locked = a;
  s.timeouts = 0;
  logEv("battle.action.locked", {
    team: teamId,
    battle: b.id,
    turn: b.turn,
    vis: "admin",
    d: { key },
  });
  if (b.teams.every((id) => b.sides[id].locked)) resolve(b);
  else save(b);
  return {};
}
function onDeadline(b) {
  if (!active(b)) return;
  if (b.state === "BanSelection") {
    b.teams.forEach((id) => {
      const p = b.picks[id];
      if (!p.ban) p.ban = strongest(b.pool[other(b, id)], b.mode)[0];
    });
    revealBans(b);
  } else if (b.state === "SquadSelection") {
    b.teams.forEach((id) => {
      const p = b.picks[id];
      if (!p.squad)
        p.squad = strongest(b.pool[id], b.mode).slice(0, b.squadSize);
    });
    startFight(b);
  } else if (b.state === "CharacterSelection") {
    b.teams.forEach((id) => {
      const s = b.sides[id];
      if (!s.pending) s.pending = autoPick(s);
    });
    b.teams.forEach((id) => {
      const x = b.sides[id];
      enter(x, x.pending);
      x.pending = null;
    });
    beginTurn(b, 1);
  } else if (b.state === "CharacterReplacement") {
    b.replace.forEach((id) => {
      const s = b.sides[id];
      enter(s, autoPick(s));
    });
    b.replace = [];
    beginTurn(b, b.turn + 1);
  } else if (b.state === "ActionSelection") {
    for (const id of b.teams) {
      const s = b.sides[id];
      if (!s.locked) {
        s.timeouts++;
        if (s.timeouts >= BS().forfeitAfterTimeouts)
          return finish(
            b,
            b.teams.find((x) => x !== id),
            "forfeit: repeated timeouts",
          );
        const cat = catalog(b, id);
        s.locked =
          cat.find((x) => x.key === BS().timeoutAction && !x.reason) ||
          cat.find((x) => x.key === "defend");
        s.locked = { ...s.locked, defaulted: true };
        logEv("battle.action.timeout", {
          team: id,
          battle: b.id,
          turn: b.turn,
          d: { default: s.locked.key },
        });
      }
    }
    resolve(b);
  }
}
function resolve(b) {
  if (b.state !== "ActionSelection" || b.turns.some((t) => t.n === b.turn))
    return;
  b.state = "ResolvingTurn";
  clearTimeout(timers.get(b.id));
  const [ia, ib] = b.teams,
    sides = [b.sides[ia], b.sides[ib]],
    act = sides.map((s) => s.locked),
    me = sides.map((s) => s.chars[s.active]),
    ev = [],
    R = BS().randomness;
  const T = (i) => sides[i].teamId;
  sides.forEach((s, i) => {
    if (act[i].kind === "switch") {
      const from = me[i];
      enter(s, act[i].charId);
      me[i] = s.chars[s.active];
      ev.push({
        k: "switch",
        team: T(i),
        text: `${from.name} swaps out for ${me[i].name}`,
      });
    }
  });
  sides.forEach((s, i) => {
    const a = act[i],
      c = me[i];
    c.energy -= a.cost || 0;
    if (a.cd) c.cd[a.key] = a.cd + 1;
    if (a.ultimate) c.charge = 0;
    if (a.self)
      c.status[a.self.status] = { turns: a.self.turns, mag: a.self.mag };
    if (a.kind === "buff")
      ev.push({ k: "buff", team: T(i), text: `${c.name} uses ${a.label}` });
    if (a.kind === "pass")
      ev.push({ k: "pass", team: T(i), text: `${c.name} holds position` });
  });
  sides.forEach((s, i) => {
    const a = act[i],
      c = me[i];
    if (a.kind === "heal") {
      const h = Math.min(Math.round(c.max * (a.heal || 0)), c.max - c.hp);
      c.hp += h;
      ev.push({
        k: "heal",
        team: T(i),
        amount: h,
        text: `${c.name} uses ${a.label} and restores ${h} health`,
      });
    }
    if (a.kind === "item") {
      const t = getTeam(T(i)),
        it = ITEMS[a.item];
      if (!(t?.inventory[a.item] > 0))
        return ev.push({
          k: "item",
          team: T(i),
          text: `${c.name} reaches for a ${it.name}, but none are left`,
        });
      t.inventory[a.item]--;
      s.items = (s.items || 0) + 1;
      const hpK = it.kind === "hp",
        g = hpK
          ? itemGain(it, c.hp, c.max)
          : itemGain(it, c.energy, c.maxEnergy);
      if (hpK) c.hp += g;
      else c.energy += g;
      ev.push({
        k: hpK ? "heal" : "item",
        team: T(i),
        amount: g,
        text: `${c.name} uses ${it.name} and restores ${g} ${hpK ? "health" : "energy"}`,
      });
      logEv("store.item.used", {
        team: T(i),
        char: c.id,
        battle: b.id,
        turn: b.turn,
        vis: "team",
        d: { item: a.item, gain: g },
      });
      persist("teams");
    }
  });
  const eff = (c) => ({
      atk: c.attack * (1 + (c.status.rage ? c.status.rage.mag : 0)),
      def: c.defence * (c.status.rage ? 0.75 : 1),
      spd: c.speed * (c.status.slow ? 1 - c.status.slow.mag : 1),
    }),
    hits = [];
  sides.forEach((s, i) => {
    const a = act[i];
    if (a.kind !== "attack") return;
    const at = me[i],
      df = me[1 - i],
      x = eff(at),
      y = eff(df);
    const evade = clamp(
      0.05 +
        (y.spd - x.spd) / 600 +
        (df.status.evade ? df.status.evade.mag : 0),
      0,
      0.75,
    );
    if (Math.random() > (a.acc ?? 1) || Math.random() < evade) {
      ev.push({
        k: "miss",
        team: T(i),
        text: `${at.name}'s ${a.label} misses ${df.name}!`,
      });
      return;
    }
    let d =
        x.atk * a.power * (100 / (100 + Math.max(0, y.def))) * (1 + rnd(-R, R)),
      crit = Math.random() < BS().critChance;
    if (crit) d *= 1.5;
    if (df.status.guard) d *= 1 - df.status.guard.mag;
    let reflect = 0;
    if (df.status.counter) {
      reflect = d * (df.status.counter.mag || 0.5);
      d -= reflect;
    }
    hits.push({
      i,
      d: Math.round(clamp(d, 1, df.max * 0.6)),
      reflect: Math.round(reflect),
      crit,
      a,
    });
  });
  const charge = (c, x) =>
    (c.charge = Math.min(100, Math.round((c.charge || 0) + x)));
  hits.forEach((h) => {
    const at = me[h.i],
      df = me[1 - h.i],
      pct = (h.d / df.max) * 100;
    df.hp = Math.max(0, df.hp - h.d);
    charge(at, pct * BS().chargeDealt);
    charge(df, pct * BS().chargeTaken);
    ev.push({
      k: "damage",
      team: T(h.i),
      target: T(1 - h.i),
      amount: h.d,
      crit: h.crit,
      text: `${at.name} uses ${h.a.label} on ${df.name} for ${h.d}${h.crit ? " (CRITICAL)" : ""}`,
    });
    if (h.reflect) {
      at.hp = Math.max(0, at.hp - h.reflect);
      ev.push({
        k: "counter",
        team: T(1 - h.i),
        target: T(h.i),
        amount: h.reflect,
        text: `${df.name} counters, reflecting ${h.reflect} damage`,
      });
    }
    if (h.a.foe && Math.random() < (h.a.foe.chance ?? 1)) {
      df.status[h.a.foe.status] = {
        turns: h.a.foe.turns + 1,
        mag: h.a.foe.mag ?? 0.4,
      };
      ev.push({
        k: "status",
        team: T(h.i),
        target: T(1 - h.i),
        text: `${df.name} is ${h.a.foe.status === "root" ? "rooted" : h.a.foe.status}`,
      });
    }
  });
  sides.forEach((s, i) => {
    Object.values(s.chars).forEach((c) => {
      for (const k in c.cd) c.cd[k] = Math.max(0, c.cd[k] - 1);
    });
    const c = me[i];
    for (const k of Object.keys(c.status)) {
      c.status[k].turns--;
      if (c.status[k].turns <= 0) delete c.status[k];
    }
    if (c.hp > 0) {
      c.energy = Math.min(
        c.maxEnergy,
        c.energy +
          BS().energyRegen +
          (act[i].gain || 0) +
          (hasPerk(c, "hardened") ? 5 : 0),
      );
      charge(c, BS().chargePerTurn);
    }
  });
  sides.forEach((s, i) => {
    const c = me[i];
    if (c.hp <= 0 && !c.eliminated) {
      c.eliminated = true;
      // the opposing team earns the kill (also when the hero falls to a counter)
      const by = T(1 - i),
        pts = b.rewards ? killPoints(b, c.id) : 0;
      if (b.rewards) {
        b.rewards[by].kills++;
        b.rewards[by].killPts += pts;
        b.rewards[by].total += pts;
      }
      if (b.kills) b.kills[me[1 - i].id] = (b.kills[me[1 - i].id] || 0) + 1;
      ev.push({
        k: "defeat",
        team: T(i),
        by,
        points: pts,
        text: `${c.name} is defeated!`,
      });
      logEv("battle.character.defeated", {
        team: T(i),
        battle: b.id,
        char: c.id,
        turn: b.turn,
        d: { name: c.name, by, points: pts },
      });
    }
  });
  const snap = sides.map(snapOf);
  b.turns.push({
    n: b.turn,
    active: Object.fromEntries(b.teams.map((id, i) => [id, sides[i].active])),
    actions: Object.fromEntries(
      b.teams.map((id, i) => [
        id,
        {
          key: act[i].key,
          label: act[i].label,
          kind: act[i].kind,
          defaulted: !!act[i].defaulted,
          character: me[i].name,
        },
      ]),
    ),
    events: ev,
    snapshot: Object.fromEntries(b.teams.map((id, i) => [id, snap[i]])),
  });
  logEv("battle.turn.resolved", {
    battle: b.id,
    turn: b.turn,
    d: { teams: b.teams, events: ev.map((e) => e.text) },
  });
  if (b.mode === "campaign") syncCampaign(b);
  b.state = "TurnSummary";
  save(b);
  setTimer(b, BS().summaryMs, advance);
}
function syncCampaign(b) {
  b.teams.forEach((id) => {
    const s = b.sides[id];
    Object.values(s.chars).forEach((c) => {
      const ch = getChar(c.id);
      if (!ch) return;
      ch.currentHealth = c.hp;
      ch.energy = c.energy;
      ch.isEliminated = c.hp <= 0;
      ch.statusEffects =
        c.id === s.active
          ? Object.entries(c.status).map(([status, v]) => ({ status, ...v }))
          : [];
    });
  });
  persist("characters");
}
export function advance(b) {
  if (b.state !== "TurnSummary") return;
  const [ia, ib] = b.teams,
    la = living(b.sides[ia]).length,
    lb = living(b.sides[ib]).length;
  if (!la || !lb)
    return finish(
      b,
      !la && !lb ? null : la ? ia : ib,
      !la && !lb ? "draw: both teams eliminated" : "all characters defeated",
    );
  b.replace = b.teams.filter(
    (id) => b.sides[id].chars[b.sides[id].active].eliminated,
  );
  if (b.practice && b.replace.includes(BOT)) {
    enter(b.sides[BOT], autoPick(b.sides[BOT]));
    b.replace = b.replace.filter((id) => id !== BOT);
  }
  if (b.replace.length) {
    b.state = "CharacterReplacement";
    setTimer(b, BS().selectTimer * 1000, onDeadline);
    save(b);
  } else beginTurn(b, b.turn + 1);
}
export function finish(b, winner, reason) {
  clearTimeout(timers.get(b.id));
  b.state = "Finished";
  b.winner = winner;
  b.result = winner ? "win" : "draw";
  b.reason = reason;
  b.deadline = null;
  b.finishedAt = new Date().toISOString();
  // practice battles change nothing outside the battle: no rating, record, rewards, XP or health
  if (b.practice) {
    logEv("battle.finished", {
      battle: b.id,
      team: b.teams[0],
      d: { winner, reason, teams: b.teams, practice: true },
    });
    save(b);
    return afterBattle(b);
  }
  const [ia, ib] = b.teams,
    ta = getTeam(ia),
    tb = getTeam(ib);
  if (b.ranked) {
    const k = BS().kFactor,
      ea = 1 / (1 + Math.pow(10, (tb.rating - ta.rating) / 400)),
      sa = winner === ia ? 1 : winner === ib ? 0 : 0.5;
    const da = Math.round(k * (sa - ea));
    ta.rating += da;
    tb.rating -= da;
    b.ratingChange = { [ia]: da, [ib]: -da };
  }
  [ta, tb].forEach((t) => {
    if (!winner) t.draws++;
    else if (winner === t.id) {
      t.wins++;
      t.streak = Math.max(1, t.streak + 1);
      t.bestStreak = Math.max(t.bestStreak, t.streak);
    } else {
      t.losses++;
      t.streak = 0;
    }
  });
  b.teams.forEach((id) =>
    sideChars(b, id).forEach((c) => {
      const ch = getChar(c.id);
      if (!ch) return;
      ch.record.battles++;
      if (winner === id) ch.record.wins++;
    }),
  );
  if (b.mode === "arena")
    b.teams.forEach((id) =>
      sideChars(b, id).forEach((c) => {
        const ch = getChar(c.id);
        if (ch) {
          ch.currentHealth = ch.maxHealth;
          ch.energy = ch.maxEnergy;
          ch.statusEffects = [];
          ch.isEliminated = false;
        }
      }),
    );
  else {
    if (winner)
      sideChars(b, winner).forEach((c) => {
        if (!c.eliminated) {
          const ch = getChar(c.id);
          if (ch)
            ch.currentHealth = Math.min(
              ch.maxHealth,
              ch.currentHealth + Math.round(ch.maxHealth * BS().winRecoveryPct),
            );
        }
      });
    // heroes who took the field need rest before their next campaign battle
    const rest = BS().campaignRestMin
      ? new Date(now() + BS().campaignRestMin * 60e3).toISOString()
      : null;
    b.teams.forEach((id) =>
      sideChars(b, id).forEach((c) => {
        const ch = getChar(c.id);
        if (!ch) return;
        ch.statusEffects = [];
        if (rest && c.entered) ch.restUntil = rest;
      }),
    );
  }
  payRewards(b, winner);
  b.xpGained = grantXp(b, winner);
  logEv("battle.finished", {
    battle: b.id,
    team: winner,
    d: { winner, reason, teams: b.teams, ratingChange: b.ratingChange || null },
  });
  persist("teams", "characters", "battles");
  save(b);
  notify("data");
  afterBattle(b);
}
// sides only exist once both squads are locked (a forfeit can come earlier)
const sideChars = (b, id) => Object.values(b.sides[id]?.chars || {});
// a finished or cancelled battle frees both teams: tournament matches may be waiting for them
function afterBattle(b) {
  if (b.tournament) tournamentResult(b);
  tickTournaments();
}
// a battle's custom settings, offered again to the same opponent (or a new bot)
export function rematch(b, teamId) {
  if (!b.teams.includes(teamId)) bad("Not in this battle", 403);
  if (b.state !== "Finished") bad("Only finished battles can be rematched");
  if (b.tournament) bad("Tournament matches cannot be rematched");
  const o = {
    mode: b.mode,
    ranked: b.ranked,
    squadSize: b.squadSize,
    bans: b.bans,
  };
  return b.practice
    ? practice(teamId, o)
    : challenge(teamId, other(b, teamId), o);
}
// practice: an instant battle against a bot squad of catalogue heroes priced like the player's roster
export function practice(teamId, o = {}) {
  const t = getTeam(teamId);
  if (!t) bad("You do not have a team", 403);
  if (inBattle(t.id)) bad(t.name + " is already in a battle");
  const size = sizeOf(o.squadSize);
  checkTeams([t], "arena", size, 0);
  const mine = t.roster.map(getChar).filter(Boolean),
    price = mine.reduce((s, c) => s + c.basePrice, 0) / mine.length,
    bot = db.characters
      .filter((c) => c.availability !== "archived" && !t.roster.includes(c.id))
      .sort(
        (x, y) => Math.abs(x.basePrice - price) - Math.abs(y.basePrice - price),
      )
      .slice(0, Math.max(10, size * 3))
      .sort(() => Math.random() - 0.5)
      .slice(0, size)
      .map((c) => c.id);
  if (bot.length < size) bad("Not enough heroes for a training bot");
  const b = newBattle([teamId, BOT], {
    practice: true,
    squadSize: size,
    bans: 0,
    invite: { from: teamId, to: BOT },
    pool: { [BOT]: bot },
  });
  logEv("battle.started", {
    team: teamId,
    battle: b.id,
    d: { teams: b.teams, mode: "arena", practice: true },
  });
  openDraft(b);
  b.picks[BOT].squad = bot;
  save(b);
  return b;
}
// opponents closest in rating first; busy teams and teams without heroes last
export function suggest(teamId) {
  const me = getTeam(teamId);
  if (!me) bad("You do not have a team", 403);
  return db.teams
    .filter((t) => t.id !== teamId)
    .map((t) => ({
      id: t.id,
      name: t.name,
      rating: t.rating,
      diff: t.rating - me.rating,
      winChance: Math.round(100 / (1 + 10 ** ((t.rating - me.rating) / 400))),
      heroes: t.roster.length,
      busy: inBattle(t.id),
    }))
    .sort(
      (x, y) =>
        (x.busy || !x.heroes) - (y.busy || !y.heroes) ||
        Math.abs(x.diff) - Math.abs(y.diff),
    )
    .slice(0, 5);
}
export function forfeit(b, teamId, actor) {
  if (!active(b) || b.state === "WaitingForPlayers")
    bad("Battle is not in progress");
  if (!b.teams.includes(teamId)) bad("Not in this battle", 403);
  logEv("battle.forfeit", { actor, team: teamId, battle: b.id });
  finish(
    b,
    b.teams.find((x) => x !== teamId),
    "forfeit",
  );
}
export function cancel(b, actor, why) {
  if (!active(b)) bad("Already over");
  clearTimeout(timers.get(b.id));
  b.state = "BattleCancelled";
  b.reason = why || "cancelled by admin";
  b.deadline = null;
  logEv("battle.cancelled", { actor, battle: b.id, d: { why: b.reason } });
  save(b);
  if (b.tournament) tournamentResult(b);
}
export function dispute(b, teamId, reason) {
  if (!b.teams.includes(teamId)) bad("Not in this battle", 403);
  if (b.state !== "Finished") bad("Only finished battles can be disputed");
  b.disputes.push({
    id: uid("dp"),
    teamId,
    reason: String(reason || "").slice(0, 500),
    ts: new Date().toISOString(),
    resolution: null,
  });
  logEv("battle.disputed", {
    team: teamId,
    battle: b.id,
    vis: "admin",
    d: { reason },
  });
  save(b);
}
export function resolveDispute(b, id, note, actor) {
  const d = b.disputes.find((x) => x.id === id);
  if (!d) bad("Unknown dispute", 404);
  d.resolution = {
    note: String(note || "").slice(0, 500),
    by: actor.name,
    ts: new Date().toISOString(),
  };
  logEv("battle.dispute.resolved", { actor, battle: b.id, d: { note } });
  save(b);
}
export function heal(target, actor) {
  const cs = target.charId
    ? [getChar(target.charId)]
    : target.teamId
      ? getTeam(target.teamId)?.roster.map(getChar) || []
      : db.characters;
  if (cs.some((c) => !c)) bad("Unknown target", 404);
  if (
    db.battles.some(
      (b) =>
        active(b) &&
        b.mode === "campaign" &&
        cs.some(
          (c) =>
            b.sides[b.teams[0]]?.chars[c.id] ||
            b.sides[b.teams[1]]?.chars[c.id],
        ),
    )
  )
    bad("Cannot heal characters in an active campaign battle");
  cs.forEach((c) => {
    c.currentHealth = c.maxHealth;
    c.energy = c.maxEnergy;
    c.statusEffects = [];
    c.isEliminated = false;
    c.restUntil = null;
  });
  logEv("admin.heal", { actor, d: target });
  persist("characters");
  notify("data");
}
export function battleView(b, sess, admin) {
  const tid =
      sess?.teamId && b.teams.includes(sess.teamId) ? sess.teamId : null,
    showSel = b.state !== "CharacterSelection",
    ready = (id) => readyIn(b, id);
  const derived =
    b.state === "ActionSelection" && tid && b.sides[tid].locked
      ? "WaitingForOpponent"
      : b.state === "Finished"
        ? tid
          ? b.winner === tid
            ? "BattleWon"
            : b.winner
              ? "BattleLost"
              : "Draw"
          : "Finished"
        : b.state;
  return {
    id: b.id,
    state: b.state,
    derived,
    mode: b.mode,
    ranked: b.ranked,
    turn: b.turn,
    deadline: b.deadline,
    invite: b.invite,
    created: b.created,
    winner: b.winner,
    result: b.result,
    reason: b.reason,
    ratingChange: b.ratingChange || null,
    rewards: b.rewards || null,
    replace: b.replace,
    disputes: b.disputes,
    squadSize: b.squadSize || null,
    bans: b.bans || 0,
    counters: b.counters || 0,
    practice: !!b.practice,
    tournament: b.tournament || null,
    xpGained: b.xpGained || null,
    start: b.start || null,
    // the pools are public (rosters are public); bans and squads stay hidden until both teams have locked
    draft: b.pool
      ? b.teams.map((id) => ({
          teamId: id,
          pool: b.pool[id].map(brief(b.mode)).filter(Boolean),
          banned: b.banned?.[id] || null,
        }))
      : null,
    teams: b.teams.map((id) => ({ id, name: teamName(id) })),
    sides: b.teams.map((id) => {
      const s = b.sides[id];
      return s
        ? {
            teamId: id,
            name: teamName(id),
            active: showSel ? s.active : null,
            ready: ready(id),
            chars: Object.values(s.chars).map((c) => ({
              id: c.id,
              name: c.name,
              hp: c.hp,
              max: c.max,
              energy: c.energy,
              maxEnergy: c.maxEnergy,
              level: c.level || 1,
              charge: c.charge ?? null,
              perks: perksAt(c.level).map((p) => p.name),
              status: c.status,
              eliminated: c.eliminated,
              faction: c.faction,
              active: showSel && s.active === c.id,
            })),
          }
        : { teamId: id, name: teamName(id), ready: ready(id), chars: [] };
    }),
    turns: b.turns.map((t) => t),
    me: tid
      ? {
          teamId: tid,
          locked: b.sides[tid]?.locked ? b.sides[tid].locked.label : null,
          pending: b.sides[tid]?.pending || null,
          ban: b.picks?.[tid]?.ban || null,
          squad: b.picks?.[tid]?.squad || null,
          needsReplacement: b.replace.includes(tid),
          options:
            b.state === "ActionSelection" &&
            b.sides[tid] &&
            !b.sides[tid].locked
              ? catalog(b, tid)
              : [],
        }
      : null,
    admin: admin
      ? {
          locked: Object.fromEntries(
            b.teams.map((id) => [id, b.sides[id]?.locked?.label || null]),
          ),
          picks: b.picks || null,
        }
      : undefined,
  };
}
// who has locked in the current step (only "ready", never what)
const readyIn = (b, id) =>
  b.state === "ActionSelection"
    ? !!b.sides[id]?.locked
    : b.state === "CharacterSelection"
      ? !!b.sides[id]?.pending
      : b.state === "BanSelection"
        ? !!b.picks?.[id]?.ban
        : b.state === "SquadSelection"
          ? !!b.picks?.[id]?.squad
          : null;
const brief = (mode) => (id) => {
  const c = getChar(id);
  return (
    c && {
      id,
      name: c.name,
      short: c.short,
      rarity: c.rarity,
      category: c.category,
      level: c.level || 1,
      hp: mode === "campaign" ? c.currentHealth : c.maxHealth,
      max: c.maxHealth,
      attack: c.attack,
      defence: c.defence,
      speed: c.speed,
    }
  );
};
export function bootBattles() {
  db.battles.filter(active).forEach((b) => {
    if (b.state === "TurnSummary") advance(b);
    else if (b.state === "ResolvingTurn") {
      b.state = "ActionSelection";
      if (b.teams.every((id) => b.sides[id].locked)) resolve(b);
      else save(b);
    } else if (
      [
        "BanSelection",
        "SquadSelection",
        "CharacterSelection",
        "CharacterReplacement",
        "ActionSelection",
      ].includes(b.state)
    ) {
      const ms = Math.max(0, (b.deadline || now()) - now());
      setTimer(b, ms, onDeadline);
    }
  });
}
/* ---------------- rewards: points, store, hero levels, exchange (points are team-wide and private like balance) ---------------- */
const RW = () => S().rewards,
  ST = () => S().store,
  day = () => new Date().toISOString().slice(0, 10),
  rarityMult = (c) => RW().rarityMult[c?.rarity] ?? 1,
  itemGain = (it, cur, max) =>
    Math.max(0, Math.min(Math.round(max * it.pct), max - cur)),
  today = (t, k) => (t.daily?.day === day() ? t.daily[k] : 0);
export const newWallet = () => ({
  points: 0,
  pointsEarned: 0,
  inventory: {},
  pointsLedger: [],
  daily: null,
  gift: null,
});
const daily = (t) => {
  if (t.daily?.day !== day()) t.daily = { day: day(), earned: 0 };
  return t.daily;
};
/* daily gift: one claim per team per (UTC) day; consecutive days build a 7-day streak that then starts again */
// day k: giftPoints + giftStreakBonus × (k − 1) points, plus (if giftKits) a small kit, alternating med/energy, and a Med Kit L on day 7
const giftReward = (k) => {
  const s = ST();
  return {
    day: k,
    points: s.giftPoints + s.giftStreakBonus * (k - 1),
    item: !s.giftKits ? null : k === 7 ? "med_l" : k % 2 ? "med_s" : "nrg_s",
  };
};
// `day` is the streak day that today's gift is (or was) for
export const giftState = (t) => {
  const yesterday = new Date(now() - 864e5).toISOString().slice(0, 10),
    last = t.gift?.last,
    available = last !== day();
  return {
    available,
    day: !available
      ? t.gift.streak
      : last === yesterday
        ? (t.gift.streak % 7) + 1
        : 1,
  };
};
export function claimGift(teamId) {
  const t = getTeam(teamId);
  if (!t) bad("You do not have a team", 403);
  const g = giftState(t);
  if (!g.available) bad("Today's gift is already claimed. Come back tomorrow!");
  const r = giftReward(g.day);
  t.gift = { last: day(), streak: g.day };
  if (r.points)
    pointsTx(t, "gift", r.points, { note: `Daily gift · day ${g.day}` });
  if (r.item) t.inventory[r.item] = (t.inventory[r.item] || 0) + 1;
  logEv("store.gift.claimed", {
    team: t.id,
    vis: "team",
    d: { day: g.day, points: r.points, item: r.item },
  });
  persist("teams");
  notify("data");
  return {
    ...r,
    itemName: r.item ? ITEMS[r.item].name : null,
    total: t.points,
  };
}
const pointsTx = (t, type, amount, o = {}) => {
  t.points += amount;
  t.pointsLedger.push({
    id: uid("px"),
    ts: new Date().toISOString(),
    type,
    amount,
    pointsAfter: t.points,
    ...o,
  });
};
// (the training bot borrows catalogue heroes; that does not make them busy for their owners)
const busy = (charId) =>
  db.battles.some(
    (b) =>
      active(b) &&
      b.teams.some((id) => id !== BOT && b.sides[id]?.chars[charId]),
  );
export const levelCost = (c) =>
  Math.round(ST().levelCost * rarityMult(c) * (c.level || 1));
function killPoints(b, charId) {
  const c = getChar(charId);
  return Math.round(
    RW().killBase *
      rarityMult(c) *
      (1 + RW().levelBonus * ((c?.level || 1) - 1)) *
      (b.rewardFactor ?? 1),
  );
}
// repeat battles between the same two teams inside the window earn less
function rewardFactor(b) {
  const since = now() - RW().repeatWindowHours * 3600e3,
    n = db.battles.filter(
      (x) =>
        x !== b &&
        x.state === "Finished" &&
        x.teams.every((id) => b.teams.includes(id)) &&
        Date.parse(x.finishedAt || x.created) >= since,
    ).length;
  return Math.pow(RW().repeatFactor, n);
}
function payRewards(b, winner) {
  const r = b.rewards;
  if (!r) return;
  // bigger squads pay a bigger win/draw/flawless bonus
  const long = b.turns.length >= RW().minTurnsForBonus,
    f =
      (b.rewardFactor ?? 1) * (1 + RW().squadBonus * ((b.squadSize || 1) - 1));
  b.teams.forEach((id) => {
    const x = r[id],
      t = getTeam(id),
      flawless = sideChars(b, id).every((c) => !c.eliminated);
    x.bonus = !long
      ? 0
      : Math.round(
          f *
            (winner === id
              ? RW().winBonus + (flawless ? RW().flawlessBonus : 0)
              : !winner
                ? RW().drawBonus
                : 0),
        );
    x.total = x.killPts + x.bonus;
    if (!t) return;
    const cap = RW().dailyCap,
      d = daily(t);
    x.paid = cap ? Math.max(0, Math.min(x.total, cap - d.earned)) : x.total;
    d.earned += x.paid;
    if (!x.paid) return;
    t.pointsEarned += x.paid;
    pointsTx(t, "battle", x.paid, {
      battleId: b.id,
      note: `${x.kills} defeat(s)${x.bonus ? ` + ${x.bonus} bonus` : ""}`,
    });
    logEv("points.earned", {
      team: id,
      battle: b.id,
      vis: "team",
      d: { earned: x.paid, kills: x.kills, bonus: x.bonus, points: t.points },
    });
  });
}
// every hero who fought earns XP (scaled down for repeat battles like points) and levels up for free at xpNeed
function grantXp(b, winner) {
  const X = RW().xp,
    long = b.turns.length >= RW().minTurnsForBonus,
    f = b.rewardFactor ?? 1,
    out = {};
  if (!ST().xpPerLevel) return out;
  b.teams.forEach((id) =>
    sideChars(b, id).forEach((sc) => {
      const c = getChar(sc.id);
      if (!c || c.ownerTeamId !== id) return;
      const xp = Math.round(
        f *
          ((long ? X.battle : 0) +
            (b.kills?.[sc.id] || 0) * X.kill +
            (long && winner === id ? X.win : 0)),
      );
      if (!xp) return;
      const from = c.level || 1,
        unlocked = gainXp(c, xp, id);
      out[c.id] = { name: c.name, xp, from, to: c.level, unlocked };
    }),
  );
  if (Object.keys(out).length) persist("characters");
  return out;
}
function gainXp(c, xp, teamId) {
  const max = ST().maxLevel,
    unlocked = [];
  if ((c.level || 1) >= max) return unlocked;
  c.xp = (c.xp || 0) + xp;
  while ((c.level || 1) < max && c.xp >= xpNeed(c)) {
    c.xp -= xpNeed(c);
    unlocked.push(...levelHero(c, teamId, { via: "xp" }));
  }
  if (c.level >= max) c.xp = 0;
  return unlocked;
}
// one level: stats scale by the level ratio (so admin edits and other stat changes are kept); returns what it unlocked
function levelHero(c, teamId, d = {}) {
  const s = ST(),
    L = c.level || 1,
    up = (k) =>
      Math.round(
        (c[k] * (1 + s.levelGain[k] * L)) / (1 + s.levelGain[k] * (L - 1)),
      ),
    before = { attack: c.attack, defence: c.defence, maxHealth: c.maxHealth },
    mh = up("maxHealth");
  c.attack = up("attack");
  c.defence = up("defence");
  if (!c.isEliminated)
    c.currentHealth = Math.min(mh, c.currentHealth + mh - c.maxHealth);
  c.maxHealth = mh;
  c.level = L + 1;
  const unlocked = [
    ...abilitiesOf(c)
      .filter((a) => a.unlockLevel === c.level)
      .map((a) => a.name),
    ...PERKS.filter((p) => p.level === c.level).map((p) => p.name + " (perk)"),
  ];
  logEv("character.levelled", {
    team: teamId,
    char: c.id,
    d: {
      name: c.name,
      level: c.level,
      before,
      after: { attack: c.attack, defence: c.defence, maxHealth: c.maxHealth },
      unlocked,
      ...d,
    },
  });
  return unlocked;
}
export const setPoints = (t, n) =>
  pointsTx(t, "admin-adjust", n - t.points, { note: "Admin set points" });
const exchangeBlocked = () =>
  !ST().exchangeRate
    ? "The exchange is closed"
    : !ST().exchangeDuringAuction && ["live", "paused"].includes(A().status)
      ? "The exchange is closed while the auction is running"
      : "";
export function storeView(teamId) {
  const t = teamId ? getTeam(teamId) : null,
    s = ST(),
    rw = RW();
  return {
    items: Object.entries(ITEMS).map(([id, x]) => ({
      id,
      ...x,
      price: s.prices[id],
      owned: t?.inventory[id] || 0,
    })),
    maxItemsPerBattle: s.maxItemsPerBattle,
    level: {
      cost: s.levelCost,
      max: s.maxLevel,
      gain: s.levelGain,
      xpPerLevel: s.xpPerLevel,
      unlockEvery: s.unlockEvery,
      ultimateLevel: s.ultimateLevel,
      rankEvery: s.rankEvery,
      rankBonus: s.rankBonus,
      xp: rw.xp,
    },
    perks: PERKS,
    rewards: {
      killBase: rw.killBase,
      rarityMult: rw.rarityMult,
      levelBonus: rw.levelBonus,
      winBonus: rw.winBonus,
      drawBonus: rw.drawBonus,
      flawlessBonus: rw.flawlessBonus,
      minTurnsForBonus: rw.minTurnsForBonus,
      dailyCap: rw.dailyCap,
      squadBonus: rw.squadBonus,
    },
    exchange: {
      rate: s.exchangeRate,
      blocked: exchangeBlocked(),
    },
    gift: t && {
      ...giftState(t),
      calendar: [1, 2, 3, 4, 5, 6, 7].map(giftReward),
    },
    me: t && {
      points: t.points,
      pointsEarned: t.pointsEarned,
      balance: t.balance,
      earnedToday: today(t, "earned"),
      pointsLedger: t.pointsLedger.slice(-50),
      heroes: t.roster
        .map(getChar)
        .filter(Boolean)
        .map((c) => ({
          ...pubChar(c),
          nextUnlock:
            abilitiesOf(c)
              .filter((a) => !a.rank)
              .sort((x, y) => x.unlockLevel - y.unlockLevel)[0] || null,
          levelCost: levelCost(c),
          maxed: (c.level || 1) >= s.maxLevel,
          busy: busy(c.id),
        })),
    },
  };
}
export function buyItem(teamId, itemId, qty = 1) {
  const t = getTeam(teamId),
    it = ITEMS[itemId];
  if (!t) bad("You do not have a team", 403);
  if (!it) bad("Unknown item", 404);
  qty = Math.round(+qty);
  if (!(qty >= 1 && qty <= 20)) bad("Quantity must be between 1 and 20");
  const cost = ST().prices[itemId] * qty;
  if (cost > t.points)
    bad(`Not enough points: ${cost} needed, you have ${t.points}`);
  pointsTx(t, "store", -cost, { item: itemId, note: `${qty} × ${it.name}` });
  t.inventory[itemId] = (t.inventory[itemId] || 0) + qty;
  logEv("store.purchased", {
    team: t.id,
    vis: "team",
    d: { item: itemId, qty, cost },
  });
  persist("teams");
  notify("data");
  return { points: t.points, owned: t.inventory[itemId] };
}
// out-of-battle use (matters in campaign mode, where health persists); in battle, items are actions (see catalog)
export function useItem(teamId, itemId, charId) {
  const t = getTeam(teamId),
    it = ITEMS[itemId],
    c = getChar(charId);
  if (!t) bad("You do not have a team", 403);
  if (!it) bad("Unknown item", 404);
  if (!c || !t.roster.includes(c.id)) bad("That hero is not on your team", 403);
  if (!(t.inventory[itemId] > 0)) bad("You have no " + it.name);
  if (busy(c.id))
    bad("This hero is in a battle: use items from the battle screen");
  const hpK = it.kind === "hp",
    g = hpK
      ? itemGain(it, c.currentHealth, c.maxHealth)
      : itemGain(it, c.energy, c.maxEnergy);
  if (!g)
    bad(`${c.short || c.name} already has full ${hpK ? "health" : "energy"}`);
  t.inventory[itemId]--;
  if (hpK) {
    c.currentHealth += g;
    c.isEliminated = false;
  } else c.energy += g;
  logEv("store.item.used", {
    team: t.id,
    char: c.id,
    vis: "team",
    d: { item: itemId, gain: g },
  });
  persist("teams", "characters");
  notify("data");
  return { gain: g, left: t.inventory[itemId] };
}
export function levelUp(teamId, charId) {
  const t = getTeam(teamId),
    c = getChar(charId),
    s = ST();
  if (!t) bad("You do not have a team", 403);
  if (!c || !t.roster.includes(c.id)) bad("That hero is not on your team", 403);
  const L = c.level || 1;
  if (L >= s.maxLevel)
    bad(`${c.short || c.name} is already at the max level (${s.maxLevel})`);
  if (busy(c.id)) bad("Cannot level up a hero during a battle");
  const cost = levelCost(c);
  if (cost > t.points)
    bad(`Not enough points: ${cost} needed, you have ${t.points}`);
  const unlocked = levelHero(c, t.id, { cost });
  if (c.level >= s.maxLevel) c.xp = 0;
  pointsTx(t, "level-up", -cost, {
    charId: c.id,
    note: `${c.name} → level ${c.level}`,
  });
  persist("teams", "characters");
  notify("data");
  return { level: c.level, cost, points: t.points, unlocked };
}
export function exchange(teamId, points) {
  const t = getTeam(teamId),
    s = ST();
  if (!t) bad("You do not have a team", 403);
  const why = exchangeBlocked();
  if (why) bad(why);
  points = Math.round(+points);
  if (!(points >= 1)) bad("Enter how many points to exchange");
  if (points > t.points) bad(`Not enough points: you have ${t.points}`);
  const cash = Math.floor(points * s.exchangeRate);
  if (!cash) bad("That is worth less than 1 cash");
  pointsTx(t, "exchange", -points, { note: `→ ${cash} cash` });
  t.balance += cash;
  ledger(t, "exchange", cash, { note: `${points} points exchanged` });
  logEv("balance.changed", {
    team: t.id,
    vis: "team",
    d: { delta: cash, balance: t.balance, why: "points exchange" },
  });
  persist("teams");
  notify("data");
  return { cash, balance: t.balance, points: t.points };
}
/* ---------------- tournaments: single elimination seeded by rating; a match starts as soon as both teams are free ---------------- */
export const getTour = (id) => db.tournaments.find((t) => t.id === id);
// classic bracket order (1 v 8, 4 v 5, 2 v 7, 3 v 6) so the top seeds can only meet late
const seedOrder = (n) => {
  let o = [1];
  while (o.length < n) {
    const m = o.length * 2 + 1;
    o = o.flatMap((s) => [s, m - s]);
  }
  return o;
};
export function createTournament(o, actor) {
  const ids = [...new Set(o.teamIds || [])];
  if (ids.length < 2) bad("Pick at least 2 teams");
  const teams = ids.map((id) => getTeam(id) || bad("Unknown team", 404)),
    mode = ["arena", "campaign"].includes(o.mode) ? o.mode : "arena",
    size = sizeOf(o.squadSize);
  checkTeams(teams, mode, size, 0);
  const seeds = [...teams].sort((a, b) => b.rating - a.rating).map((t) => t.id),
    P = 2 ** Math.ceil(Math.log2(seeds.length)),
    order = seedOrder(P),
    first = [];
  for (let i = 0; i < P; i += 2) {
    const a = seeds[order[i] - 1] || null,
      b = seeds[order[i + 1] - 1] || null;
    first.push({
      id: "r1m" + (i / 2 + 1),
      a,
      b,
      winner: a && b ? null : a || b,
      battleId: null,
      status: a && b ? "pending" : "bye",
    });
  }
  const t = {
    id: uid("tr"),
    name:
      String(o.name || "")
        .trim()
        .slice(0, 40) || "Tournament",
    status: "running",
    created: new Date().toISOString(),
    mode,
    squadSize: size,
    ranked: !!o.ranked,
    prize: Math.max(0, Math.round(+o.prize || 0)),
    seeds,
    rounds: [first],
    winner: null,
  };
  db.tournaments.push(t);
  logEv("tournament.created", {
    actor,
    d: {
      tournament: t.id,
      name: t.name,
      teams: seeds.map(teamName),
      squadSize: size,
      mode,
    },
  });
  progress(t);
  return t;
}
// start every waiting match whose teams are free; when a round is complete, pair its winners
function progress(t) {
  if (t.status !== "running") return;
  const r = t.rounds.at(-1);
  r.forEach((m) => m.status === "pending" && startMatch(t, m));
  if (r.every((m) => m.winner)) {
    if (r.length === 1) return endTournament(t, r[0].winner);
    const n = t.rounds.length + 1,
      next = [];
    for (let i = 0; i < r.length; i += 2)
      next.push({
        id: `r${n}m${i / 2 + 1}`,
        a: r[i].winner,
        b: r[i + 1].winner,
        winner: null,
        battleId: null,
        status: "pending",
      });
    t.rounds.push(next);
    return progress(t);
  }
  persist("tournaments");
  notify("data");
}
function startMatch(t, m) {
  if (inBattle(m.a) || inBattle(m.b)) return;
  const ok = [m.a, m.b].map((id) => {
    const x = getTeam(id);
    return !!x && eligible(x, t.mode).length >= t.squadSize;
  });
  if (!ok[0] || !ok[1]) {
    // walkover: a team that cannot field a full squad goes out (if neither can, the higher seed goes through)
    m.winner = ok[1] && !ok[0] ? m.b : m.a;
    m.status = "walkover";
    logEv("tournament.walkover", {
      team: m.winner,
      d: { tournament: t.id, name: t.name, winner: teamName(m.winner) },
    });
    return;
  }
  const b = newBattle([m.a, m.b], {
    mode: t.mode,
    ranked: t.ranked,
    squadSize: t.squadSize,
    bans: 0,
    tournament: { id: t.id, name: t.name, round: t.rounds.length, match: m.id },
  });
  m.battleId = b.id;
  m.status = "playing";
  logEv("battle.started", {
    battle: b.id,
    d: { teams: b.teams, mode: b.mode, tournament: t.name },
  });
  openDraft(b);
}
// a won match advances its winner; a draw or a cancelled battle is played again
function tournamentResult(b) {
  const t = getTour(b.tournament.id),
    m = t?.rounds[b.tournament.round - 1]?.find(
      (x) => x.id === b.tournament.match,
    );
  if (!m || m.battleId !== b.id || t.status !== "running") return;
  if (b.state === "Finished" && b.winner) {
    m.winner = b.winner;
    m.status = "done";
  } else {
    m.battleId = null;
    m.status = "pending";
    m.replays = (m.replays || 0) + 1;
  }
  persist("tournaments");
}
function endTournament(t, winner) {
  t.status = "finished";
  t.winner = winner;
  t.finishedAt = new Date().toISOString();
  const w = getTeam(winner);
  if (w && t.prize) {
    w.pointsEarned += t.prize;
    pointsTx(w, "tournament", t.prize, { note: `Won ${t.name}` });
    persist("teams");
  }
  logEv("tournament.finished", {
    team: winner,
    d: {
      tournament: t.id,
      name: t.name,
      winner: teamName(winner),
      prize: t.prize,
    },
  });
  persist("tournaments");
  notify("data");
}
export function tickTournaments() {
  db.tournaments.filter((t) => t.status === "running").forEach(progress);
}
export function cancelTournament(t, actor) {
  if (t.status !== "running") bad("Tournament is not running");
  t.status = "cancelled";
  t.rounds.flat().forEach((m) => {
    const b = m.battleId && getBattle(m.battleId);
    if (b && active(b)) cancel(b, actor, "tournament cancelled");
  });
  logEv("tournament.cancelled", {
    actor,
    d: { tournament: t.id, name: t.name },
  });
  persist("tournaments");
  notify("data");
}
export const tournamentView = (t) => ({
  ...t,
  names: Object.fromEntries(t.seeds.map((id) => [id, teamName(id) || "?"])),
});
