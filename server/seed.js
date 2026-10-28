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
// store items: effects are fixed here, prices live in settings.store.prices
export const ITEMS = {
  med_s: { name: "Med Kit S", kind: "hp", pct: 0.2 },
  med_m: { name: "Med Kit M", kind: "hp", pct: 0.5 },
  med_l: { name: "Med Kit L", kind: "hp", pct: 1 },
  nrg_s: { name: "Energy Kit S", kind: "energy", pct: 0.2 },
  nrg_m: { name: "Energy Kit M", kind: "energy", pct: 0.5 },
  nrg_l: { name: "Energy Kit L", kind: "energy", pct: 1 },
};
// passive perks a hero gains at a level (effects are applied in game.js)
export const PERKS = [
  {
    id: "hardened",
    level: 5,
    name: "Battle-hardened",
    desc: "+5 energy every turn",
  },
  {
    id: "veteran",
    level: 10,
    name: "Veteran",
    desc: "Enters the fight behind a 30% shield for one turn",
  },
];
// team-up moves: either hero gets the move while the other is alive in the same squad (matched by name)
const TU = (id, a, b, name, kind, power, cost, cd, o = {}) => ({
  id,
  heroes: [a, b],
  name,
  kind,
  power,
  cost,
  cd,
  ...o,
});
export const TEAMUPS = [
  TU("assemble", "Iron Man (Tony Stark)", "Captain America (Steve Rogers)", "Avengers Assemble", "attack", 2.2, 35, 4, { desc: "Repulsors and shield strike together" }),
  TU("thunder", "Thor Odinson", "Hulk (Bruce Banner)", "Thunder & Fury", "attack", 2.4, 40, 4, { desc: "Lightning-charged smash" }),
  TU("endofline", "Captain America (Steve Rogers)", "Winter Soldier (Bucky Barnes)", "End of the Line", "attack", 2, 30, 4, { desc: "Old friends fight as one" }),
  TU("budapest", "Black Widow (Natasha Romanoff)", "Hawkeye (Clint Barton)", "Budapest Protocol", "attack", 1.8, 30, 4, { foe: { status: "slow", turns: 2, mag: 0.4, chance: 1 }, desc: "Arrows and bites: slows the enemy" }),
  TU("groot", "Rocket Raccoon", "Groot", "We Are Groot", "attack", 2.2, 35, 4, { desc: "Rocket rides Groot into battle" }),
  TU("guardians", "Star-Lord (Peter Quill)", "Gamora", "Guardians' Gambit", "attack", 2, 30, 4, { desc: "A plan, of sorts" }),
  TU("fastball", "Wolverine (Logan)", "Colossus (Piotr Rasputin)", "Fastball Special", "attack", 2.5, 40, 4, { desc: "Colossus throws Wolverine" }),
  TU("phoenix", "Cyclops (Scott Summers)", "Jean Grey / Phoenix", "Psychic Link", "attack", 2.3, 35, 4, { desc: "Optic blast guided by telepathy" }),
  TU("clobber", "Human Torch (Johnny Storm)", "The Thing (Ben Grimm)", "Flame On, Clobberin' Time", "attack", 2.2, 35, 4, { desc: "Fire and stone" }),
  TU("formation", "Mister Fantastic (Reed Richards)", "Invisible Woman (Sue Storm)", "Fantastic Formation", "buff", 0, 25, 4, { self: { status: "guard", turns: 2, mag: 0.6 }, desc: "Force field wrapped in elastic armour" }),
  TU("hire", "Luke Cage (Power Man)", "Iron Fist (Danny Rand)", "Heroes for Hire", "attack", 2.2, 35, 4, { desc: "Unbreakable skin, iron fist" }),
  TU("mystic", "Doctor Strange (Stephen Strange)", "Wong", "Mystic Arts", "heal", 0, 30, 4, { heal: 0.25, desc: "Sorcerers mend wounds together" }),
];
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
      level: 1,
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
    squadSize: 3, // default heroes per side; the challenger picks the actual number
    chargePerTurn: 10, // ultimate charge (0–100) gained by the active hero each turn
    chargeDealt: 0.6, // charge per 1% of the target's max health dealt
    chargeTaken: 0.4, // charge per 1% of own max health taken
    campaignRestMin: 30, // campaign: heroes who fought rest this many minutes; 0 = off
    actions: U,
  },
  rewards: {
    killBase: 10,
    rarityMult: { Common: 1, Rare: 1.5, Epic: 2.5, Legendary: 4 },
    levelBonus: 0.1, // +10% kill points per level of the defeated hero above 1
    winBonus: 50,
    drawBonus: 15,
    flawlessBonus: 25,
    minTurnsForBonus: 3, // no win/draw bonus for battles shorter than this (quick-forfeit farming)
    repeatWindowHours: 24,
    repeatFactor: 0.5, // points × this for every earlier battle vs the same team inside the window
    dailyCap: 0, // max battle points per team per day; 0 = no cap
    squadBonus: 0.25, // win/draw/flawless bonus × (1 + this per hero above 1 per side)
    xp: { battle: 20, kill: 15, win: 20 }, // hero XP: per battle fought (3+ turns), per enemy defeated, per win
  },
  store: {
    prices: { med_s: 30, med_m: 70, med_l: 120, nrg_s: 20, nrg_m: 45, nrg_l: 80 },
    maxItemsPerBattle: 2,
    levelCost: 50, // × rarity multiplier × current level
    maxLevel: 10,
    levelGain: { attack: 0.04, defence: 0.03, maxHealth: 0.04 },
    xpPerLevel: 100, // XP for the next level = this × current level; 0 = no levelling from XP
    unlockEvery: 2, // abilities unlock at levels 1, 1+this, 1+2×this… (in listed order)
    ultimateLevel: 8, // ultimates unlock at this level
    rankEvery: 3, // an unlocked ability gains a rank every this many levels (max rank 3)
    rankBonus: 0.15, // power/heal per rank above 1; rank 3 also cuts the cooldown by 1
    exchangeRate: 1, // cash per point; 0 disables the exchange
    exchangeDailyCap: 200, // max cash per team per day; 0 = no cap
    exchangeDuringAuction: false,
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
    tournaments: () => [],
    history: () => [],
    settings: defaultSettings,
    admin: () => null,
  })[k]();
