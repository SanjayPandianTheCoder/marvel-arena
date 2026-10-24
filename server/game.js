// Auction, battle state machine, history. Every mutation is synchronous (atomic) and followed by persist().
import { db, persist, uid } from "./store.js";
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
        abilities: c.abilities,
        statusEffects: c.statusEffects,
        ownerTeamId: c.ownerTeamId,
        availability: c.availability,
        isAvailable: c.availability === "available" && !c.ownerTeamId,
        isEliminated: c.isEliminated,
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
      max: Math.max(0, maxBid(t)),
      leading: !!c && c.teamId === t.id,
      passed: !!c && c.passed.includes(t.id),
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
export function challenge(teamId, oppId, o = {}) {
  const A_ = getTeam(teamId),
    B_ = getTeam(oppId);
  if (!A_ || !B_) bad("Unknown team", 404);
  if (teamId === oppId) bad("Pick a different opponent");
  const mode = ["arena", "campaign"].includes(o.mode) ? o.mode : BS().mode;
  for (const t of [A_, B_]) {
    if (!t.roster.length) bad(t.name + " has no characters");
    if (db.battles.some((b) => active(b) && b.teams.includes(t.id)))
      bad(t.name + " is already in a battle");
    if (
      mode === "campaign" &&
      !t.roster.some((id) => getChar(id).currentHealth > 0)
    )
      bad(t.name + " has no healthy characters (campaign mode)");
  }
  const b = {
    id: uid("bt"),
    teams: [teamId, oppId],
    mode,
    ranked: !!(o.ranked !== false && BS().ranked),
    state: "WaitingForPlayers",
    turn: 0,
    created: new Date().toISOString(),
    updated: now(),
    invite: { from: teamId, to: oppId },
    sides: {},
    turns: [],
    winner: null,
    result: null,
    reason: null,
    replace: [],
    deadline: null,
    disputes: [],
  };
  db.battles.push(b);
  logEv("battle.invited", {
    team: teamId,
    battle: b.id,
    d: { to: oppId, mode },
  });
  persist("battles");
  notify("battle", b.id);
  return b;
}
function mkSide(t, mode) {
  const roster = t.roster.map(getChar).filter(Boolean),
    cnt = {};
  roster.forEach((c) => (cnt[c.category] = (cnt[c.category] || 0) + 1));
  const chars = {};
  roster.forEach((c) => {
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
      faction: fb,
      cd: {},
      status: {},
      eliminated: hp <= 0,
    };
  });
  return {
    teamId: t.id,
    chars,
    active: null,
    pending: null,
    locked: null,
    timeouts: 0,
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
  b.teams.forEach((id) => (b.sides[id] = mkSide(getTeam(id), b.mode)));
  for (const id of b.teams)
    if (!living(b.sides[id]).length) bad("A team has no healthy characters");
  b.state = "CharacterSelection";
  setTimer(b, BS().selectTimer * 1000, onDeadline);
  logEv("battle.started", {
    battle: b.id,
    d: { teams: b.teams, mode: b.mode },
  });
  save(b);
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
        x.active = x.pending;
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
    s.active = charId;
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
  setTimer(b, BS().actionTimer * 1000, onDeadline);
  save(b);
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
  (ch?.abilities || []).forEach((a) =>
    add("ab:" + a.id, a.name, a.kind, {
      power: a.power,
      cost: a.cost,
      cd: a.cd,
      self: a.self,
      foe: a.foe,
      heal: a.heal,
      acc: a.acc,
      desc: a.desc,
      noRoot: a.self?.status === "evade",
    }),
  );
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
  if (b.state === "CharacterSelection") {
    b.teams.forEach((id) => {
      const s = b.sides[id];
      if (!s.pending) s.pending = autoPick(s);
    });
    b.teams.forEach((id) => {
      const x = b.sides[id];
      x.active = x.pending;
      x.pending = null;
    });
    beginTurn(b, 1);
  } else if (b.state === "CharacterReplacement") {
    b.replace.forEach((id) => {
      const s = b.sides[id];
      s.active = autoPick(s);
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
      s.active = act[i].charId;
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
  hits.forEach((h) => {
    const at = me[h.i],
      df = me[1 - h.i];
    df.hp = Math.max(0, df.hp - h.d);
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
    if (c.hp > 0)
      c.energy = Math.min(
        c.maxEnergy,
        c.energy + BS().energyRegen + (act[i].gain || 0),
      );
  });
  sides.forEach((s, i) => {
    const c = me[i];
    if (c.hp <= 0 && !c.eliminated) {
      c.eliminated = true;
      ev.push({ k: "defeat", team: T(i), text: `${c.name} is defeated!` });
      logEv("battle.character.defeated", {
        team: T(i),
        battle: b.id,
        char: c.id,
        turn: b.turn,
        d: { name: c.name },
      });
    }
  });
  const snap = sides.map((s) =>
    Object.fromEntries(
      Object.values(s.chars).map((c) => [c.id, { hp: c.hp, energy: c.energy }]),
    ),
  );
  b.turns.push({
    n: b.turn,
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
    Object.values(b.sides[id].chars).forEach((c) => {
      const ch = getChar(c.id);
      if (!ch) return;
      ch.record.battles++;
      if (winner === id) ch.record.wins++;
    }),
  );
  if (b.mode === "arena")
    b.teams.forEach((id) =>
      Object.values(b.sides[id].chars).forEach((c) => {
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
      Object.values(b.sides[winner].chars).forEach((c) => {
        if (!c.eliminated) {
          const ch = getChar(c.id);
          if (ch)
            ch.currentHealth = Math.min(
              ch.maxHealth,
              ch.currentHealth + Math.round(ch.maxHealth * BS().winRecoveryPct),
            );
        }
      });
    b.teams.forEach((id) =>
      Object.values(b.sides[id].chars).forEach((c) => {
        const ch = getChar(c.id);
        if (ch) ch.statusEffects = [];
      }),
    );
  }
  logEv("battle.finished", {
    battle: b.id,
    team: winner,
    d: { winner, reason, teams: b.teams, ratingChange: b.ratingChange || null },
  });
  persist("teams", "characters", "battles");
  save(b);
  notify("data");
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
  });
  logEv("admin.heal", { actor, d: target });
  persist("characters");
  notify("data");
}
export function battleView(b, sess, admin) {
  const tid =
      sess?.teamId && b.teams.includes(sess.teamId) ? sess.teamId : null,
    showSel = b.state !== "CharacterSelection";
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
    replace: b.replace,
    disputes: b.disputes,
    teams: b.teams.map((id) => ({ id, name: getTeam(id)?.name })),
    sides: b.teams.map((id) => {
      const s = b.sides[id];
      return s
        ? {
            teamId: id,
            name: getTeam(id)?.name,
            active: showSel ? s.active : null,
            ready:
              b.state === "ActionSelection"
                ? !!s.locked
                : b.state === "CharacterSelection"
                  ? !!s.pending
                  : null,
            chars: Object.values(s.chars).map((c) => ({
              id: c.id,
              name: c.name,
              hp: c.hp,
              max: c.max,
              energy: c.energy,
              maxEnergy: c.maxEnergy,
              status: c.status,
              eliminated: c.eliminated,
              faction: c.faction,
              active: showSel && s.active === c.id,
            })),
          }
        : { teamId: id, name: getTeam(id)?.name, chars: [] };
    }),
    turns: b.turns.map((t) => t),
    me: tid
      ? {
          teamId: tid,
          locked: b.sides[tid]?.locked ? b.sides[tid].locked.label : null,
          pending: b.sides[tid]?.pending || null,
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
        }
      : undefined,
  };
}
export function bootBattles() {
  db.battles.filter(active).forEach((b) => {
    if (b.state === "TurnSummary") advance(b);
    else if (b.state === "ResolvingTurn") {
      b.state = "ActionSelection";
      if (b.teams.every((id) => b.sides[id].locked)) resolve(b);
      else save(b);
    } else if (
      [
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
