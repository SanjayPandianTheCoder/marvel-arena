import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import {
  db,
  load,
  persist,
  idle,
  close,
  uid,
  VALID,
  KEYS,
} from "./store.js";
import {
  defaults,
  defaultAuction,
  defaultSettings,
  buildChars,
  ITEMS,
} from "./seed.js";
import { hashPw, verifyPw, newToken } from "./auth.js";
import * as G from "./game.js";
const { Err, bad } = G,
  app = express(),
  http = createServer(app),
  io = new Server(http, { cors: { origin: false } });
const PUB = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);
app.use(express.json({ limit: "4mb" }));
app.use(express.static(PUB));
const warnings = await load(defaults).catch((e) => {
  console.error("[db] cannot connect to MongoDB:", e.message);
  process.exit(1);
});
warnings.forEach((w) => console.warn("[data]", w));
// fill in fields added after a save was created (rewards/store settings, team wallets, hero levels)
const fillIn = (o, d) => {
  for (const k in d)
    if (o[k] == null) o[k] = d[k];
    else if (d[k] && typeof d[k] === "object" && typeof o[k] === "object")
      fillIn(o[k], d[k]);
  return o;
};
function upgrade() {
  fillIn(db.settings, defaultSettings());
  delete db.settings.store.exchangeDailyCap; // the exchange has no daily limit any more
  db.teams.forEach((t) => fillIn(t, G.newWallet()));
  db.characters.forEach((c) => (c.level ??= 1));
  persist("settings", "teams", "characters");
}
upgrade();
if (!db.admin) {
  const pw = process.env.ADMIN_PASSWORD || newToken().slice(0, 12);
  db.admin = { username: process.env.ADMIN_USER || "admin", ...hashPw(pw) };
  persist("admin");
  console.log(
    `\n  Admin account created → username: ${db.admin.username}  password: ${pw}\n  (shown once; set ADMIN_PASSWORD to choose your own)\n`,
  );
} else if (
  process.env.ADMIN_PASSWORD &&
  !verifyPw(process.env.ADMIN_PASSWORD, db.admin.salt, db.admin.hash)
) {
  // ADMIN_PASSWORD (e.g. from .env) is authoritative: it replaces the stored admin password on start
  db.admin = { username: db.admin.username, ...hashPw(process.env.ADMIN_PASSWORD) };
  persist("admin");
  console.log("  Admin password set from ADMIN_PASSWORD");
}
G.setNotify((t, id) => io.emit("ev", { t, id }));
G.bootAuction();
G.bootBattles();
G.tickTournaments();
/* ---------------- sessions & helpers ---------------- */
const HOURS = 12,
  online = new Map();
const sessOf = (req) => {
  const tk =
    (req.headers.authorization || "").replace("Bearer ", "") ||
    req.query?.token;
  const s = db.players.sessions[tk];
  if (!s) return null;
  if (s.exp < Date.now()) {
    delete db.players.sessions[tk];
    return null;
  }
  if (s.role === "admin")
    return { role: "admin", id: "admin", name: db.admin.username, token: tk };
  const p = db.players.players.find((x) => x.id === s.id);
  return p
    ? {
        role: "player",
        id: p.id,
        name: p.username,
        teamId: p.teamId,
        token: tk,
      }
    : null;
};
const mkSession = (role, id) => {
  const tk = newToken();
  db.players.sessions[tk] = { role, id, exp: Date.now() + HOURS * 3600e3 };
  persist("players");
  return tk;
};
const tries = new Map(),
  limited = (ip) => {
    const t = tries.get(ip) || { n: 0, ts: Date.now() };
    if (Date.now() - t.ts > 6e5) {
      t.n = 0;
      t.ts = Date.now();
    }
    t.n++;
    tries.set(ip, t);
    return t.n > 15;
  };
const actor = (s) => ({ kind: s.role, id: s.id, name: s.name });
function route(method, p, role, fn) {
  app[method]("/api" + p, (req, res) => {
    try {
      const s = sessOf(req);
      if (role === "admin" && s?.role !== "admin")
        bad("Admin login required", 401);
      if (role === "player" && s?.role !== "player")
        bad("Player login required", 401);
      const out = fn(req, s);
      Promise.resolve(out)
        .then((o) => res.json(o ?? { ok: true }))
        .catch((e) =>
          res
            .status(e.code || 500)
            .json({ error: e.code ? e.message : "Server error" }),
        );
    } catch (e) {
      if (!e.code) console.error(e);
      res
        .status(e.code || 500)
        .json({ error: e.code ? e.message : "Server error" });
    }
  });
}
const str = (v, min, max, name) => {
  v = String(v ?? "").trim();
  if (v.length < min || v.length > max)
    bad(`${name} must be ${min}–${max} characters`);
  return v;
};
const num = (v, min, max, name) => {
  v = +v;
  if (!Number.isFinite(v) || v < min || v > max)
    bad(`${name} must be a number between ${min} and ${max}`);
  return v;
};
const COLORS = [
  "#ec1d24",
  "#f6c343",
  "#2e86de",
  "#27ae60",
  "#9b59b6",
  "#e67e22",
  "#1abc9c",
  "#e84393",
  "#95a5a6",
  "#ff7675",
];
function newTeam(name, balance) {
  if (db.teams.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    bad("Team name already taken");
  const b = balance ?? db.settings.startingBudget;
  const t = {
    id: uid("tm"),
    name,
    logo: "",
    color: COLORS[db.teams.length % COLORS.length],
    balance: b,
    startingBalance: b,
    roster: [],
    ledger: [],
    rating: db.settings.battle.startRating,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    bestStreak: 0,
    ...G.newWallet(),
    createdAt: new Date().toISOString(),
  };
  db.teams.push(t);
  return t;
}
const seeEv = (e, s) =>
  s?.role === "admin" ||
  e.vis === "public" ||
  (e.vis === "team" && s?.teamId && e.teamId === s.teamId) ||
  (e.vis === "battle" && s?.teamId && e.details?.teams?.includes(s.teamId));
/* ---------------- auth ---------------- */
route("post", "/register", null, (req) => {
  const { username, password, teamId, teamName } = req.body || {};
  const u = str(username, 3, 20, "Username");
  if (!/^[A-Za-z0-9_]+$/.test(u))
    bad("Username may contain letters, numbers and _ only");
  if (String(password || "").length < 8)
    bad("Password must be at least 8 characters");
  if (
    db.players.players.some((p) => p.username.toLowerCase() === u.toLowerCase())
  )
    bad("Username already taken");
  let t;
  if (teamId) {
    t = G.getTeam(teamId);
    if (!t) bad("Unknown team", 404);
    if (db.players.players.some((p) => p.teamId === t.id))
      bad("That team already has a player");
  } else {
    if (!db.settings.auction.allowSelfTeam)
      bad("Creating teams is disabled; ask the admin");
    if (db.teams.length >= db.settings.auction.maxTeams)
      bad("Maximum number of teams reached");
    t = newTeam(str(teamName, 2, 24, "Team name"));
  }
  const p = {
    id: uid("pl"),
    username: u,
    ...hashPw(password),
    teamId: t.id,
    createdAt: new Date().toISOString(),
  };
  db.players.players.push(p);
  G.logEv("player.registered", {
    player: p.id,
    team: t.id,
    d: { username: u, team: t.name },
  });
  persist("players", "teams");
  io.emit("ev", { t: "data" });
  return {
    token: mkSession("player", p.id),
    role: "player",
    name: u,
    teamId: t.id,
  };
});
route("post", "/login", null, (req) => {
  if (limited(req.ip)) bad("Too many attempts; try again later", 429);
  const { username, password } = req.body || {};
  const p = db.players.players.find(
    (x) => x.username.toLowerCase() === String(username || "").toLowerCase(),
  );
  if (!p || !verifyPw(password, p.salt, p.hash))
    bad("Wrong username or password", 401);
  G.logEv("player.login", { player: p.id, team: p.teamId, vis: "admin" });
  return {
    token: mkSession("player", p.id),
    role: "player",
    name: p.username,
    teamId: p.teamId,
  };
});
route("post", "/admin/login", null, (req) => {
  if (limited(req.ip)) bad("Too many attempts; try again later", 429);
  const { username, password } = req.body || {};
  if (
    username !== db.admin.username ||
    !verifyPw(password, db.admin.salt, db.admin.hash)
  )
    bad("Wrong admin credentials", 401);
  G.logEv("admin.login", {
    actor: { kind: "admin", name: username },
    vis: "admin",
  });
  return { token: mkSession("admin", "admin"), role: "admin", name: username };
});
route("post", "/logout", null, (req, s) => {
  if (s) {
    delete db.players.sessions[s.token];
    persist("players");
  }
});
route("post", "/admin/password", "admin", (req, s) => {
  const { current, next } = req.body || {};
  if (!verifyPw(current, db.admin.salt, db.admin.hash))
    bad("Current password is wrong", 403);
  if (String(next || "").length < 10)
    bad("New password must be at least 10 characters");
  db.admin = { username: db.admin.username, ...hashPw(next) };
  persist("admin");
  G.logEv("admin.password.changed", { actor: actor(s), vis: "admin" });
});
/* ---------------- public & player reads ---------------- */
route("get", "/state", null, (req, s) => ({
  session: s ? { role: s.role, name: s.name, teamId: s.teamId || null } : null,
  auction: { status: db.auction.status },
  teams: db.teams.length,
  battlesActive: db.battles.filter(
    (b) => !["Finished", "BattleCancelled", "Declined"].includes(b.state),
  ).length,
  settings: {
    rosterLimit: db.settings.rosterLimit,
    squadSize: Math.min(db.settings.battle.squadSize, db.settings.rosterLimit),
    allowSelfTeam: db.settings.auction.allowSelfTeam,
    battleMode: db.settings.battle.mode,
    actionTimer: db.settings.battle.actionTimer,
  },
}));
route("get", "/characters", null, (req, s) => {
  const h = G.auctionView(null).current?.mystery
    ? db.auction.current.charId
    : null;
  return db.characters
    .filter((c) => c.availability !== "archived" || s?.role === "admin")
    .map((c) => G.pubChar(c, c.id === h));
});
route("get", "/teams", null, () => db.teams.map(G.pubTeam));
route("get", "/teams/open", null, () =>
  db.teams
    .filter((t) => !db.players.players.some((p) => p.teamId === t.id))
    .map((t) => ({ id: t.id, name: t.name })),
);
route("get", "/me", "player", (req, s) => {
  const t = G.getTeam(s.teamId);
  return { player: { id: s.id, username: s.name }, team: G.privTeam(t) };
});
route("get", "/leaderboard", null, () =>
  [...db.teams]
    .sort((a, b) => b.rating - a.rating)
    .map((t, i) => ({
      rank: i + 1,
      id: t.id,
      name: t.name,
      color: t.color,
      rating: t.rating,
      wins: t.wins,
      losses: t.losses,
      draws: t.draws,
      streak: t.streak,
      bestStreak: t.bestStreak,
      pointsEarned: t.pointsEarned,
      winRate:
        t.wins + t.losses + t.draws
          ? Math.round((t.wins / (t.wins + t.losses + t.draws)) * 100)
          : 0,
      characters: t.roster.length,
    }))
    .concat([])
    .map((r) => r),
);
route("get", "/analytics", null, () => ({
  characters: db.characters
    .filter((c) => c.record.battles)
    .map((c) => ({
      id: c.id,
      name: c.name,
      battles: c.record.battles,
      wins: c.record.wins,
      winRate: Math.round((c.record.wins / c.record.battles) * 100),
    }))
    .sort((a, b) => b.winRate - a.winRate || b.battles - a.battles)
    .slice(0, 20),
  spending: db.auction.sold
    .map((x) => ({
      name: G.getChar(x.charId)?.name,
      team: G.getTeam(x.teamId)?.name,
      price: x.price,
    }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 10),
}));
route("get", "/history", null, (req, s) => {
  const q = req.query;
  let ev = db.history.filter((e) => seeEv(e, s));
  if (q.team) ev = ev.filter((e) => e.teamId === q.team);
  if (q.player) ev = ev.filter((e) => e.playerId === q.player);
  if (q.char) ev = ev.filter((e) => e.characterId === q.char);
  if (q.battle) ev = ev.filter((e) => e.battleId === q.battle);
  if (q.type) ev = ev.filter((e) => e.type.startsWith(q.type));
  if (q.auction === "1")
    ev = ev.filter((e) =>
      /^(auction|bid|lot|character\.(purchased|retained))/.test(e.type),
    );
  if (q.from) ev = ev.filter((e) => e.ts >= q.from);
  if (q.to) ev = ev.filter((e) => e.ts <= q.to);
  return {
    total: ev.length,
    events: ev.slice(-Math.min(+q.limit || 100, 500)).reverse(),
  };
});
route("get", "/auction", null, (req, s) => G.auctionView(s));
/* ---------------- auction actions ---------------- */
route("post", "/auction/bid", "player", (req, s) => {
  G.bid(s.teamId, req.body?.amount);
});
route("post", "/auction/pass", "player", (req, s) => {
  G.passLot(s.teamId);
});
/* ---------------- store, hero levels, exchange ---------------- */
route("get", "/store", null, (req, s) =>
  G.storeView(s?.role === "player" ? s.teamId : null),
);
route("post", "/store/buy", "player", (req, s) =>
  G.buyItem(s.teamId, req.body?.item, req.body?.qty ?? 1),
);
route("post", "/store/use", "player", (req, s) =>
  G.useItem(s.teamId, req.body?.item, req.body?.charId),
);
route("post", "/store/level-up", "player", (req, s) =>
  G.levelUp(s.teamId, req.body?.charId),
);
route("post", "/store/gift", "player", (req, s) => G.claimGift(s.teamId));
route("post", "/store/exchange", "player", (req, s) =>
  G.exchange(s.teamId, req.body?.points),
);
/* ---------------- battles ---------------- */
const bt = (id) => G.getBattle(id) || bad("Battle not found", 404);
route("get", "/battles", null, (req, s) =>
  db.battles
    .slice()
    .reverse()
    .map((b) => ({
      id: b.id,
      state: b.state,
      mode: b.mode,
      ranked: b.ranked,
      turn: b.turn,
      created: b.created,
      teams: b.teams.map((id) => ({ id, name: G.teamName(id) })),
      winner: b.winner,
      result: b.result,
      invite: b.invite,
      squadSize: b.squadSize || null,
      bans: b.bans || 0,
      practice: !!b.practice,
      tournament: b.tournament?.name || null,
      mine: !!s?.teamId && b.teams.includes(s.teamId),
      disputes: b.disputes.length,
    })),
);
route("get", "/battles/suggest", "player", (req, s) => G.suggest(s.teamId));
route("get", "/battles/:id", null, (req, s) => {
  const b = bt(req.params.id),
    v = G.battleView(b, s, s?.role === "admin");
  v.online = Object.fromEntries(
    b.teams.map((id) => [id, (online.get(id) || 0) > 0]),
  );
  return v;
});
route("post", "/battles", "player", (req, s) => {
  const b = G.challenge(s.teamId, req.body?.opponentTeamId, req.body || {});
  return { id: b.id };
});
route("post", "/battles/practice", "player", (req, s) => ({
  id: G.practice(s.teamId, req.body || {}).id,
}));
route("post", "/battles/:id/respond", "player", (req, s) => {
  G.respond(bt(req.params.id), s.teamId, !!req.body?.accept);
});
route("post", "/battles/:id/counter", "player", (req, s) => {
  G.counter(bt(req.params.id), s.teamId, req.body?.squadSize);
});
route("post", "/battles/:id/ban", "player", (req, s) =>
  G.ban(bt(req.params.id), s.teamId, req.body?.charId),
);
route("post", "/battles/:id/squad", "player", (req, s) =>
  G.pickSquad(bt(req.params.id), s.teamId, req.body?.charIds),
);
route("post", "/battles/:id/rematch", "player", (req, s) => ({
  id: G.rematch(bt(req.params.id), s.teamId).id,
}));
route("post", "/battles/:id/select", "player", (req, s) =>
  G.selectChar(bt(req.params.id), s.teamId, req.body?.charId),
);
route("post", "/battles/:id/action", "player", (req, s) =>
  G.submit(bt(req.params.id), s.teamId, req.body || {}),
);
route("post", "/battles/:id/forfeit", "player", (req, s) => {
  G.forfeit(bt(req.params.id), s.teamId, actor(s));
});
route("post", "/battles/:id/dispute", "player", (req, s) => {
  G.dispute(bt(req.params.id), s.teamId, req.body?.reason);
});
route("get", "/tournaments", null, () =>
  db.tournaments.slice().reverse().map(G.tournamentView),
);
/* ---------------- admin ---------------- */
const abilityOk = (a, i) => {
  const k = ["attack", "buff", "heal"];
  if (!a || !k.includes(a.kind))
    bad("Ability kind must be attack, buff or heal");
  return {
    id: a.id || "a" + (i + 1),
    name: str(a.name, 1, 40, "Ability name"),
    kind: a.kind,
    power: num(a.power ?? 0, 0, 10, "Ability power"),
    cost: num(a.cost ?? 0, 0, 100, "Ability cost"),
    cd: num(a.cd ?? 0, 0, 10, "Ability cooldown"),
    ...(a.heal != null ? { heal: num(a.heal, 0, 1, "Heal") } : {}),
    ...(a.acc != null ? { acc: num(a.acc, 0.1, 1, "Accuracy") } : {}),
    ...(a.self
      ? {
          self: {
            status: a.self.status,
            turns: num(a.self.turns ?? 1, 1, 10, "Turns"),
            mag: num(a.self.mag ?? 0.3, 0, 1, "Magnitude"),
          },
        }
      : {}),
    ...(a.foe
      ? {
          foe: {
            status: a.foe.status,
            turns: num(a.foe.turns ?? 1, 1, 10, "Turns"),
            mag: num(a.foe.mag ?? 0.4, 0, 1, "Magnitude"),
            chance: num(a.foe.chance ?? 1, 0, 1, "Chance"),
          },
        }
      : {}),
    desc: String(a.desc || "").slice(0, 160),
    ultimate: !!a.ultimate,
    // optional: otherwise the level comes from the ability's position and the unlock settings
    ...(a.unlockLevel != null
      ? { unlockLevel: num(a.unlockLevel, 1, 50, "Unlock level") }
      : {}),
  };
};
function cleanChar(b, old) {
  const mh = num(b.maxHealth, 10, 5000, "Max health"),
    c = {
      ...(old || {
        id: uid("ch"),
        currentHealth: mh,
        energy: 100,
        maxEnergy: 100,
        statusEffects: [],
        ownerTeamId: null,
        isEliminated: false,
        level: 1,
        record: { battles: 0, wins: 0 },
        powers: [],
        archetype: "S",
      }),
      name: str(b.name, 1, 60, "Name"),
      short: String(b.short || b.name).slice(0, 40),
      image: String(b.image || "").slice(0, 500),
      universe: str(b.universe || "Marvel", 1, 40, "Universe"),
      rarity: ["Common", "Rare", "Epic", "Legendary"].includes(b.rarity)
        ? b.rarity
        : bad("Rarity must be Common, Rare, Epic or Legendary"),
      category: str(b.category || "Other", 1, 60, "Category"),
      basePrice: num(b.basePrice, 1, 100000, "Base price"),
      maxHealth: mh,
      attack: num(b.attack, 1, 500, "Attack"),
      defence: num(b.defence, 1, 500, "Defence"),
      speed: num(b.speed, 1, 500, "Speed"),
      availability: [
        "available",
        "unavailable",
        "reserved",
        "archived",
      ].includes(b.availability || "available")
        ? b.availability || "available"
        : bad("Bad availability"),
      abilities: (b.abilities || old?.abilities || []).map(abilityOk),
    };
  c.currentHealth = Math.min(c.currentHealth, mh);
  return c;
}
route("get", "/admin/overview", "admin", () => ({
  teams: db.teams.map(G.adminTeam),
  auction: G.auctionView(null),
  battles: db.battles
    .slice(-15)
    .reverse()
    .map((b) => ({
      id: b.id,
      state: b.state,
      teams: b.teams.map(G.teamName),
      turn: b.turn,
      disputes: b.disputes.filter((d) => !d.resolution).length,
    })),
  events: db.history.slice(-15).reverse(),
  players: db.players.players.map((p) => ({
    id: p.id,
    username: p.username,
    teamId: p.teamId,
  })),
  warnings,
}));
route("post", "/admin/characters", "admin", (req, s) => {
  const c = cleanChar(req.body || {});
  db.characters.push(c);
  G.logEv("admin.character.created", {
    actor: actor(s),
    char: c.id,
    d: { name: c.name },
  });
  persist("characters");
  io.emit("ev", { t: "data" });
  return c;
});
route("put", "/admin/characters/:id", "admin", (req, s) => {
  const o = G.getChar(req.params.id) || bad("Not found", 404),
    before = { ...o, abilities: undefined };
  const c = cleanChar({ ...o, ...req.body }, o);
  Object.assign(o, c);
  G.logEv("admin.character.updated", {
    actor: actor(s),
    char: o.id,
    d: {
      before: {
        name: before.name,
        basePrice: before.basePrice,
        attack: before.attack,
        defence: before.defence,
        speed: before.speed,
        maxHealth: before.maxHealth,
        availability: before.availability,
      },
      after: {
        name: o.name,
        basePrice: o.basePrice,
        attack: o.attack,
        defence: o.defence,
        speed: o.speed,
        maxHealth: o.maxHealth,
        availability: o.availability,
      },
    },
  });
  persist("characters");
  io.emit("ev", { t: "data" });
  return o;
});
route("delete", "/admin/characters/:id", "admin", (req, s) => {
  const c = G.getChar(req.params.id) || bad("Not found", 404);
  if (req.body?.confirm !== true)
    bad('Confirmation required (send {"confirm":true})');
  if (c.ownerTeamId || req.body.hard !== true) {
    c.availability = "archived";
    G.logEv("admin.character.archived", {
      actor: actor(s),
      char: c.id,
      d: { name: c.name },
    });
  } else {
    db.characters.splice(db.characters.indexOf(c), 1);
    G.logEv("admin.character.deleted", {
      actor: actor(s),
      char: c.id,
      d: { name: c.name },
    });
  }
  persist("characters");
  io.emit("ev", { t: "data" });
});
route("get", "/admin/characters/export", "admin", () => db.characters);
route("post", "/admin/characters/import", "admin", (req, s) => {
  const L = req.body?.characters;
  if (!Array.isArray(L) || !L.length) bad('Provide {"characters":[...]}');
  const out = L.map((c) => {
    const o = db.characters.find((x) => x.id === c.id);
    return o ? { ...o, ...cleanChar({ ...o, ...c }, o) } : cleanChar(c);
  });
  out.forEach((c) => {
    const i = db.characters.findIndex((x) => x.id === c.id);
    i < 0 ? db.characters.push(c) : (db.characters[i] = c);
  });
  G.logEv("admin.characters.imported", {
    actor: actor(s),
    d: { count: out.length },
  });
  persist("characters");
  io.emit("ev", { t: "data" });
  return { imported: out.length };
});
route("get", "/admin/teams", "admin", () => db.teams.map(G.adminTeam));
route("post", "/admin/teams", "admin", (req, s) => {
  const t = newTeam(
    str(req.body?.name, 2, 24, "Team name"),
    req.body?.balance != null
      ? num(req.body.balance, 0, 1e7, "Balance")
      : undefined,
  );
  G.logEv("admin.team.created", {
    actor: actor(s),
    team: t.id,
    d: { name: t.name },
  });
  persist("teams");
  io.emit("ev", { t: "data" });
  return G.adminTeam(t);
});
route("put", "/admin/teams/:id", "admin", (req, s) => {
  const t = G.getTeam(req.params.id) || bad("Not found", 404),
    b = req.body || {},
    before = { name: t.name, balance: t.balance, points: t.points };
  if (b.name != null) {
    const n = str(b.name, 2, 24, "Team name");
    if (
      db.teams.some(
        (x) => x.id !== t.id && x.name.toLowerCase() === n.toLowerCase(),
      )
    )
      bad("Team name already taken");
    t.name = n;
  }
  if (b.logo != null) t.logo = String(b.logo).slice(0, 500);
  if (b.balance != null) {
    const nb = num(b.balance, 0, 1e7, "Balance");
    t.ledger.push({
      id: uid("tx"),
      ts: new Date().toISOString(),
      type: "admin-adjust",
      amount: nb - t.balance,
      balanceAfter: nb,
      note: "Admin set balance",
    });
    t.balance = nb;
  }
  if (b.points != null) G.setPoints(t, num(b.points, 0, 1e7, "Points"));
  G.logEv("admin.team.updated", {
    actor: actor(s),
    team: t.id,
    d: {
      before,
      after: { name: t.name, balance: t.balance, points: t.points },
    },
  });
  persist("teams");
  io.emit("ev", { t: "data" });
  return G.adminTeam(t);
});
route("delete", "/admin/teams/:id", "admin", (req, s) => {
  const t = G.getTeam(req.params.id) || bad("Not found", 404);
  if (req.body?.confirm !== true) bad("Confirmation required");
  if (
    db.battles.some(
      (b) =>
        !["Finished", "BattleCancelled", "Declined"].includes(b.state) &&
        b.teams.includes(t.id),
    )
  )
    bad("Team is in an active battle");
  t.roster.forEach((id) => {
    const c = G.getChar(id);
    if (c) {
      c.ownerTeamId = null;
    }
  });
  db.teams.splice(db.teams.indexOf(t), 1);
  db.players.players.forEach((p) => {
    if (p.teamId === t.id) p.teamId = null;
  });
  G.logEv("admin.team.deleted", {
    actor: actor(s),
    team: t.id,
    d: { name: t.name, released: t.roster.length },
  });
  persist("teams", "characters", "players");
  io.emit("ev", { t: "data" });
});
route("post", "/admin/players", "admin", (req, s) => {
  const b = req.body || {},
    u = str(b.username, 3, 20, "Username");
  if (
    db.players.players.some((p) => p.username.toLowerCase() === u.toLowerCase())
  )
    bad("Username taken");
  if (String(b.password || "").length < 8)
    bad("Password must be at least 8 characters");
  if (b.teamId && !G.getTeam(b.teamId)) bad("Unknown team", 404);
  const p = {
    id: uid("pl"),
    username: u,
    ...hashPw(b.password),
    teamId: b.teamId || null,
    createdAt: new Date().toISOString(),
  };
  db.players.players.push(p);
  G.logEv("admin.player.created", {
    actor: actor(s),
    player: p.id,
    team: p.teamId,
    d: { username: u },
  });
  persist("players");
  return { id: p.id };
});
route("put", "/admin/players/:id", "admin", (req, s) => {
  const p =
    db.players.players.find((x) => x.id === req.params.id) ||
    bad("Not found", 404);
  if (req.body.teamId !== undefined) {
    if (req.body.teamId && !G.getTeam(req.body.teamId))
      bad("Unknown team", 404);
    p.teamId = req.body.teamId || null;
  }
  if (req.body.password) {
    if (String(req.body.password).length < 8)
      bad("Password must be at least 8 characters");
    Object.assign(p, hashPw(req.body.password));
  }
  G.logEv("admin.player.updated", {
    actor: actor(s),
    player: p.id,
    team: p.teamId,
  });
  persist("players");
});
route("delete", "/admin/players/:id", "admin", (req, s) => {
  const p =
    db.players.players.find((x) => x.id === req.params.id) ||
    bad("Not found", 404);
  if (req.body?.confirm !== true) bad("Confirmation required");
  db.players.players.splice(db.players.players.indexOf(p), 1);
  for (const k in db.players.sessions)
    if (db.players.sessions[k].id === p.id) delete db.players.sessions[k];
  G.logEv("admin.player.deleted", {
    actor: actor(s),
    d: { username: p.username },
  });
  persist("players");
});
const A_ = (p, f) =>
  route("post", "/admin/auction/" + p, "admin", (req, s) =>
    f(req.body || {}, actor(s)),
  );
A_("configure", (b, a) => G.configureAuction(b, a));
A_("start", (b, a) => G.startAuction(a));
A_("pause", (b, a) => G.pauseAuction(a));
A_("resume", (b, a) => G.resumeAuction(a));
A_("end", (b, a) => {
  if (b.confirm !== true) bad("Confirmation required");
  G.endAuction(a);
});
A_("lots", (b, a) => G.lots(b.op, b, a));
A_("retain", (b, a) => G.retain(b, a));
A_("bonus", (b, a) => G.bonus(b, a));
A_("emergency", (b, a) => ({ added: G.emergency(a) }));
A_("correct", (b, a) => {
  if (b.confirm !== true) bad("Confirmation required");
  G.correctSale(b, a);
});
A_("heal", (b, a) => G.heal(b, a));
route("post", "/admin/battles/:id/cancel", "admin", (req, s) => {
  if (req.body?.confirm !== true) bad("Confirmation required");
  G.cancel(bt(req.params.id), actor(s), req.body.reason);
});
route("post", "/admin/battles/:id/forfeit", "admin", (req, s) => {
  if (req.body?.confirm !== true) bad("Confirmation required");
  G.forfeit(bt(req.params.id), req.body.teamId, actor(s));
});
route("post", "/admin/battles/:id/dispute/:d", "admin", (req, s) => {
  G.resolveDispute(bt(req.params.id), req.params.d, req.body?.note, actor(s));
});
const tr = (id) => G.getTour(id) || bad("Tournament not found", 404);
route("post", "/admin/tournaments", "admin", (req, s) =>
  G.tournamentView(G.createTournament(req.body || {}, actor(s))),
);
route("post", "/admin/tournaments/:id/cancel", "admin", (req, s) => {
  if (req.body?.confirm !== true) bad("Confirmation required");
  G.cancelTournament(tr(req.params.id), actor(s));
});
// starts matches that were waiting (e.g. after the admin cancelled a match's battle)
route("post", "/admin/tournaments/:id/tick", "admin", (req) => {
  tr(req.params.id);
  G.tickTournaments();
});
route("get", "/admin/settings", "admin", () => db.settings);
route("put", "/admin/settings", "admin", (req, s) => {
  const b = req.body || {},
    st = db.settings,
    before = JSON.stringify(st);
  if (b.startingBudget != null)
    st.startingBudget = num(b.startingBudget, 0, 1e7, "Starting budget");
  if (b.rosterLimit != null)
    st.rosterLimit = num(b.rosterLimit, 1, 30, "Roster limit");
  if (b.minRoster != null)
    st.minRoster = num(b.minRoster, 0, 30, "Minimum roster");
  if (b.maxPerCategory != null)
    st.maxPerCategory = num(b.maxPerCategory, 0, 30, "Category limit");
  const A = b.auction || {};
  for (const [k, [lo, hi]] of Object.entries({
    increment: [1, 10000],
    timer: [0, 600],
    mysteryPct: [0, 100],
    maxRaises: [0, 50],
    reservePerSlot: [0, 10000],
    maxTeams: [2, 10],
    lotGapMs: [500, 30000],
  }))
    if (A[k] != null) st.auction[k] = num(A[k], lo, hi, k);
  if (A.allowSelfTeam != null) st.auction.allowSelfTeam = !!A.allowSelfTeam;
  const B = b.battle || {};
  for (const [k, [lo, hi]] of Object.entries({
    actionTimer: [5, 600],
    selectTimer: [5, 600],
    forfeitAfterTimeouts: [1, 20],
    energyRegen: [0, 100],
    critChance: [0, 1],
    randomness: [0, 0.5],
    winRecoveryPct: [0, 1],
    kFactor: [1, 100],
    summaryMs: [500, 20000],
    squadSize: [1, 30],
    chargePerTurn: [0, 100],
    chargeDealt: [0, 10],
    chargeTaken: [0, 10],
    campaignRestMin: [0, 1440],
  }))
    if (B[k] != null) st.battle[k] = num(B[k], lo, hi, k);
  for (const k of ["allowSwitch", "allowPass", "factionBonus", "ranked"])
    if (B[k] != null) st.battle[k] = !!B[k];
  if (B.mode != null)
    st.battle.mode = ["arena", "campaign"].includes(B.mode)
      ? B.mode
      : bad("Mode must be arena or campaign");
  if (B.timeoutAction != null)
    st.battle.timeoutAction = ["defend", "pass", "attack", "dodge"].includes(
      B.timeoutAction,
    )
      ? B.timeoutAction
      : bad("Bad timeout action");
  if (B.actions) {
    for (const k of Object.keys(st.battle.actions))
      if (B.actions[k])
        for (const f of Object.keys(st.battle.actions[k]))
          if (B.actions[k][f] != null)
            st.battle.actions[k][f] = num(B.actions[k][f], 0, 10, k + "." + f);
  }
  const RW = b.rewards || {};
  for (const [k, [lo, hi]] of Object.entries({
    killBase: [0, 10000],
    levelBonus: [0, 10],
    winBonus: [0, 1e5],
    drawBonus: [0, 1e5],
    flawlessBonus: [0, 1e5],
    minTurnsForBonus: [0, 100],
    repeatWindowHours: [0, 720],
    repeatFactor: [0, 1],
    dailyCap: [0, 1e7],
    squadBonus: [0, 5],
  }))
    if (RW[k] != null) st.rewards[k] = num(RW[k], lo, hi, "rewards." + k);
  for (const k of ["battle", "kill", "win"])
    if (RW.xp?.[k] != null)
      st.rewards.xp[k] = num(RW.xp[k], 0, 1e4, "rewards.xp." + k);
  for (const r of ["Common", "Rare", "Epic", "Legendary"])
    if (RW.rarityMult?.[r] != null)
      st.rewards.rarityMult[r] = num(RW.rarityMult[r], 0, 100, r);
  const SO = b.store || {};
  for (const [k, [lo, hi]] of Object.entries({
    maxItemsPerBattle: [0, 20],
    levelCost: [0, 1e6],
    maxLevel: [1, 50],
    exchangeRate: [0, 100],
    giftPoints: [0, 1e5],
    giftStreakBonus: [0, 1e4],
    xpPerLevel: [0, 1e6],
    unlockEvery: [1, 20],
    ultimateLevel: [1, 50],
    rankEvery: [1, 50],
    rankBonus: [0, 2],
  }))
    if (SO[k] != null) st.store[k] = num(SO[k], lo, hi, "store." + k);
  if (SO.exchangeDuringAuction != null)
    st.store.exchangeDuringAuction = !!SO.exchangeDuringAuction;
  if (SO.giftKits != null) st.store.giftKits = !!SO.giftKits;
  for (const id of Object.keys(ITEMS))
    if (SO.prices?.[id] != null)
      st.store.prices[id] = num(SO.prices[id], 0, 1e6, ITEMS[id].name + " price");
  for (const k of ["attack", "defence", "maxHealth"])
    if (SO.levelGain?.[k] != null)
      st.store.levelGain[k] = num(SO.levelGain[k], 0, 1, "levelGain." + k);
  G.logEv("admin.settings.updated", {
    actor: actor(s),
    vis: "admin",
    d: { changed: before !== JSON.stringify(st) },
  });
  persist("settings");
});
route("get", "/admin/history", "admin", (req) => {
  const q = req.query;
  let ev = db.history;
  if (q.team) ev = ev.filter((e) => e.teamId === q.team);
  if (q.player) ev = ev.filter((e) => e.playerId === q.player);
  if (q.char) ev = ev.filter((e) => e.characterId === q.char);
  if (q.battle) ev = ev.filter((e) => e.battleId === q.battle);
  if (q.type) ev = ev.filter((e) => e.type.startsWith(q.type));
  if (q.from) ev = ev.filter((e) => e.ts >= q.from);
  if (q.to) ev = ev.filter((e) => e.ts <= q.to);
  return {
    total: ev.length,
    events: ev.slice(-Math.min(+q.limit || 200, 1000)).reverse(),
  };
});
/* ---- backup / restore / reset ---- */
route("get", "/admin/backup", "admin", (req, s) => {
  G.logEv("admin.backup.exported", { actor: actor(s), vis: "admin" });
  const files = {};
  for (const k of KEYS)
    if (k !== "admin" && k !== "players") files[k] = db[k];
  files.players = db.players.players.map((p) => ({ ...p }));
  return {
    app: "marvel-arena",
    version: 1,
    exportedAt: new Date().toISOString(),
    files,
  };
});
route("post", "/admin/restore", "admin", (req, s) => {
  const f = req.body?.files;
  if (req.body?.confirm !== true) bad("Confirmation required");
  if (!f || typeof f !== "object") bad("Not a valid backup file");
  const ok = {
    characters: Array.isArray,
    teams: Array.isArray,
    battles: Array.isArray,
    history: Array.isArray,
    auction: VALID.auction,
    settings: VALID.settings,
    players: Array.isArray,
  };
  for (const k of Object.keys(ok))
    if (!(k in f) || !ok[k](f[k]))
      bad(`Backup is missing or has an invalid "${k}" section`);
  if (
    f.characters.some(
      (c) => !c.id || !c.name || typeof c.maxHealth !== "number",
    )
  )
    bad("Backup characters are malformed");
  if (f.teams.some((t) => !t.id || typeof t.balance !== "number"))
    bad("Backup teams are malformed");
  Object.assign(db, {
    characters: f.characters,
    teams: f.teams,
    battles: f.battles,
    tournaments: Array.isArray(f.tournaments) ? f.tournaments : [], // older backups have none
    history: f.history,
    auction: f.auction,
    settings: f.settings,
  });
  db.players.players = f.players;
  upgrade();
  for (const k in db.players.sessions)
    if (db.players.sessions[k].role === "player") delete db.players.sessions[k];
  G.logEv("admin.backup.restored", {
    actor: actor(s),
    d: { characters: f.characters.length, teams: f.teams.length },
  });
  G.bootAuction();
  G.bootBattles();
  G.tickTournaments();
  KEYS.forEach((k) => persist(k));
  io.emit("ev", { t: "data" });
  io.emit("ev", { t: "auction" });
});
route("post", "/admin/reset", "admin", (req, s) => {
  if (req.body?.confirm !== "RESET") bad("Type RESET to confirm");
  G.endAuction(actor(s));
  db.battles
    .filter(
      (b) => !["Finished", "BattleCancelled", "Declined"].includes(b.state),
    )
    .forEach((b) => G.cancel(b, actor(s), "game reset"));
  const keep = db.settings;
  db.characters = buildChars();
  db.teams = [];
  db.battles = [];
  db.tournaments = [];
  db.auction = defaultAuction();
  db.settings = {
    ...defaultSettings(),
    startingBudget: keep.startingBudget,
    rosterLimit: keep.rosterLimit,
    auction: keep.auction,
    battle: keep.battle,
    rewards: keep.rewards,
    store: keep.store,
  };
  db.players.players.forEach((p) => {
    p.teamId = null;
  });
  for (const k in db.players.sessions)
    if (db.players.sessions[k].role === "player") delete db.players.sessions[k];
  G.logEv("admin.game.reset", {
    actor: actor(s),
    d: { newGameId: db.settings.gameId },
  });
  KEYS.forEach((k) => persist(k));
  io.emit("ev", { t: "data" });
  io.emit("ev", { t: "auction" });
});
app.use("/api", (q, r) => r.status(404).json({ error: "Unknown endpoint" }));
app.use((q, r) => r.sendFile(path.join(PUB, "index.html")));
/* ---------------- sockets: realtime notifications only; clients re-fetch authoritative, privacy-filtered data over REST ---------------- */
io.use((s, next) => {
  const tk = s.handshake.auth?.token,
    x = db.players.sessions[tk];
  if (x && x.exp > Date.now()) {
    s.data.role = x.role;
    if (x.role === "player") {
      const p = db.players.players.find((p) => p.id === x.id);
      s.data.teamId = p?.teamId;
    }
  }
  next();
});
io.on("connection", (sock) => {
  const t = sock.data.teamId;
  if (t) {
    online.set(t, (online.get(t) || 0) + 1);
    io.emit("ev", { t: "presence" });
  }
  sock.on("disconnect", () => {
    if (t) {
      online.set(t, Math.max(0, (online.get(t) || 1) - 1));
      io.emit("ev", { t: "presence" });
    }
  });
});
const PORT = process.env.PORT || 3000;
if (!process.env.NO_LISTEN)
  http.listen(PORT, () =>
    console.log(`Marvel Arena running on http://localhost:${PORT}`),
  );
process.on("SIGINT", async () => {
  await close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await close();
  process.exit(0);
});
export { http, io, idle };
