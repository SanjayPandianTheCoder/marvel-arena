import { RAW } from "./lib/data.js";
import { statsFor, priceFor } from "./lib/balance.js";
import { avg } from "./lib/util.js";
import { uid } from "./store.js";
const U = {
  // universal actions (configurable in settings.json)
  attack: { power: 1, cost: 0 },
  heavy: { power: 1.6, cost: 20, cd: 1, acc: 0.9 },
  defend: { mag: 0.5, gain: 10 },
  dodge: { mag: 0.4, cost: 10 },
  recover: { heal: 0.12, cost: 25, cd: 3 },
};
const A = (name, kind, power, cost, cd, o = {}) => ({
  name,
  kind,
  power,
  cost,
  cd,
  ...o,
});
const T = {
  B: [
    A("Crushing Blow", "attack", 1.6, 25, 1),
    A("Unstoppable", "attack", 2.4, 60, 3, {
      self: { status: "rage", turns: 2, mag: 0.3 },
      ultimate: true,
    }),
  ],
  A: [
    A("Acrobatic Strike", "attack", 1.4, 15, 0, {
      self: { status: "evade", turns: 1, mag: 0.25 },
    }),
    A("Blur of Motion", "attack", 2.2, 55, 3, { ultimate: true }),
  ],
  G: [
    A("Gadget Barrage", "attack", 1.4, 20, 1, {
      foe: { status: "slow", turns: 2, mag: 0.4, chance: 0.5 },
    }),
    A("Masterplan", "attack", 2.3, 60, 3, { ultimate: true }),
  ],
  M: [
    A("Mystic Bolt", "attack", 1.5, 20, 1),
    A("Dark Rift", "attack", 2.5, 65, 3, {
      foe: { status: "root", turns: 1, chance: 0.6 },
      ultimate: true,
    }),
  ],
  C: [
    A("Cosmic Blast", "attack", 1.7, 30, 1),
    A("Power Surge", "attack", 2.6, 70, 3, { ultimate: true }),
  ],
  T: [
    A("Tech Barrage", "attack", 1.5, 20, 1),
    A("Overload", "attack", 2.4, 60, 3, { ultimate: true }),
  ],
  E: [
    A("Energy Surge", "attack", 1.6, 25, 1),
    A("Critical Mass", "attack", 2.5, 65, 3, { ultimate: true }),
  ],
  S: [
    A("Precision Strike", "attack", 1.5, 15, 1),
    A("Finishing Move", "attack", 2.3, 55, 3, { ultimate: true }),
  ],
};
const SPEC = {
  "Iron Man (Tony Stark)": [
    A("Repulsor Blast", "attack", 1.2, 5, 0, {
      desc: "Standard ranged attack",
    }),
    A("Unibeam", "attack", 2.4, 60, 2, {
      ultimate: true,
      desc: "High damage, high energy cost",
    }),
    A("Armour Shield", "buff", 0, 15, 1, {
      self: { status: "guard", turns: 1, mag: 0.5 },
      desc: "Reduces incoming damage",
    }),
    A("Flight Evasion", "buff", 0, 10, 0, {
      self: { status: "evade", turns: 1, mag: 0.45 },
      desc: "Harder to hit",
    }),
  ],
  "Spider-Man (Peter Parker)": [
    A("Web Shot", "attack", 0.7, 10, 0, {
      foe: { status: "root", turns: 1, chance: 1 },
      desc: "Roots the opponent: no dodge or switch next turn",
    }),
    A("Spider-Sense", "buff", 0, 10, 1, {
      self: { status: "evade", turns: 2, mag: 0.35 },
      desc: "Improves dodge chance for 2 turns",
    }),
    A("Web Swing", "buff", 0, 15, 0, {
      self: { status: "evade", turns: 1, mag: 0.5 },
      desc: "Evasive action",
    }),
    A("Web Trap", "attack", 0.5, 15, 1, {
      foe: { status: "slow", turns: 2, mag: 0.4, chance: 1 },
      desc: "Slows the enemy",
    }),
  ],
  "Thor Odinson": [
    A("Mjolnir Strike", "attack", 1.8, 25, 1, { desc: "High-damage attack" }),
    A("Lightning Storm", "attack", 1.5, 30, 1, {
      foe: { status: "slow", turns: 1, mag: 0.3, chance: 0.5 },
      desc: "Storm of lightning",
    }),
    A("Asgardian Resilience", "buff", 0, 15, 1, {
      self: { status: "guard", turns: 1, mag: 0.5 },
      desc: "Defensive ability",
    }),
    A("God of Thunder", "attack", 2.8, 70, 3, {
      ultimate: true,
      desc: "Ultimate: needs lots of energy",
    }),
  ],
  "Wolverine (Logan)": [
    A("Adamantium Slash", "attack", 1.3, 10, 0, {
      desc: "Reliable physical attack",
    }),
    A("Regeneration", "heal", 0, 25, 3, {
      heal: 0.18,
      desc: "Restores health",
    }),
    A("Berserker Rage", "buff", 0, 20, 2, {
      self: { status: "rage", turns: 3, mag: 0.3 },
      desc: "More damage, less defence",
    }),
  ],
  "Captain America (Steve Rogers)": [
    A("Shield Throw", "attack", 1.3, 10, 0, { desc: "Ranged attack" }),
    A("Shield Guard", "buff", 0, 10, 1, {
      self: { status: "guard", turns: 1, mag: 0.5 },
      desc: "Reduces incoming damage",
    }),
    A("Tactical Counter", "buff", 0, 20, 2, {
      self: { status: "counter", turns: 1, mag: 0.5 },
      desc: "Counters attacks: halves damage and reflects it",
    }),
  ],
  Groot: [
    A("Root Snare", "attack", 0.6, 15, 0, {
      foe: { status: "root", turns: 2, chance: 1 },
      desc: "Reduces opponent mobility",
    }),
    A("Wooden Shield", "buff", 0, 15, 1, {
      self: { status: "guard", turns: 1, mag: 0.5 },
      desc: "Defensive",
    }),
    A("Regrowth", "heal", 0, 25, 3, { heal: 0.15, desc: "Limited healing" }),
  ],
};
export function buildChars() {
  const out = [];
  let cat = "";
  RAW.split("\n").forEach((l) => {
    l = l.trim();
    if (!l) return;
    if (l[0] == "#") {
      cat = l.slice(1).trim();
      return;
    }
    const [name, t, a, p] = l.split("|"),
      s = statsFor(name, +t, a),
      [P, Sp, D, I, F, E] = s,
      pw = p.split(","),
      hp = D * 3 + P * 2 + 100;
    let ab = SPEC[name] || T[a].map((x) => ({ ...x }));
    if (!SPEC[name]) {
      const f = p.toLowerCase();
      if (/regen|heal|immortal/.test(f))
        ab.push(A("Regeneration", "heal", 0, 25, 3, { heal: 0.15 }));
      if (/armor|shield|invuln|rock|steel|diamond/.test(f))
        ab.push(
          A("Hardened Guard", "buff", 0, 15, 1, {
            self: { status: "guard", turns: 1, mag: 0.5 },
          }),
        );
    }
    ab = ab.map((x, i) => ({
      id: "a" + (i + 1),
      desc: x.desc || "Draws on " + pw[0],
      ...x,
    }));
    const r = avg(s);
    out.push({
      id: "ch_" + String(out.length + 1).padStart(3, "0"),
      name,
      short: name.replace(/\s*\(.*\)/, "").replace(/\s*–.*/, ""),
      image: "",
      universe: "Marvel",
      rarity:
        +t >= 9 ? "Legendary" : +t >= 7 ? "Epic" : +t >= 5 ? "Rare" : "Common",
      category: cat,
      archetype: a,
      powers: pw,
      basePrice: priceFor(r),
      maxHealth: hp,
      currentHealth: hp,
      attack: Math.round((P * 0.4 + F * 0.4 + E * 0.2) * 1.6),
      defence: D,
      speed: Sp,
      energy: 100,
      maxEnergy: 100,
      abilities: ab,
      statusEffects: [],
      ownerTeamId: null,
      availability: "available",
      isEliminated: false,
      record: { battles: 0, wins: 0 },
    });
  });
  return out;
}
export const defaultSettings = () => ({
  gameId: uid("game"),
  startingBudget: 1000,
  rosterLimit: 5,
  minRoster: 3,
  maxPerCategory: 0,
  auction: {
    increment: 5,
    timer: 20,
    mode: "complete",
    poolSize: 60,
    mysteryPct: 0,
    maxRaises: 0,
    reservePerSlot: 10,
    allowSelfTeam: true,
    maxTeams: 10,
    lotGapMs: 3000,
  },
  battle: {
    mode: "arena",
    actionTimer: 30,
    selectTimer: 30,
    timeoutAction: "defend",
    forfeitAfterTimeouts: 3,
    energyRegen: 15,
    allowSwitch: true,
    allowPass: true,
    critChance: 0.08,
    randomness: 0.1,
    factionBonus: true,
    winRecoveryPct: 0.25,
    ranked: true,
    startRating: 1000,
    kFactor: 24,
    summaryMs: 3500,
    actions: U,
  },
});
export const defaultAuction = () => ({
  status: "idle",
  config: null,
  queue: [],
  idx: 0,
  current: null,
  sold: [],
  unsold: [],
  lastResult: null,
});
export const defaults = (k) =>
  ({
    characters: buildChars,
    teams: () => [],
    players: () => ({ players: [], sessions: {} }),
    auction: defaultAuction,
    battles: () => [],
    history: () => [],
    settings: defaultSettings,
    admin: () => null,
  })[k]();
