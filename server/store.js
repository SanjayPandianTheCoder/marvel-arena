// JSON persistence: in-memory cache + atomic, serialised file writes. All game mutations are synchronous (so they cannot interleave); writes queue behind each other.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
export const DIR =
  process.env.DATA_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../data");
export const NAMES = {
  characters: "characters.json",
  teams: "teams.json",
  players: "players.json",
  auction: "auction.json",
  battles: "battles.json",
  history: "game-history.json",
  settings: "settings.json",
  admin: "admin.json",
};
export const db = {};
export const uid = (p) => p + "_" + randomBytes(5).toString("hex");
export const VALID = {
  characters: Array.isArray,
  teams: Array.isArray,
  battles: Array.isArray,
  history: Array.isArray,
  players: (x) =>
    x &&
    Array.isArray(x.players) &&
    x.sessions &&
    typeof x.sessions == "object",
  auction: (x) => x && typeof x == "object" && Array.isArray(x.queue),
  settings: (x) =>
    x && x.battle && x.auction && typeof x.startingBudget == "number",
  admin: (x) => x && x.hash && x.salt,
};
export function load(defaults) {
  fs.mkdirSync(DIR, { recursive: true });
  const warn = [];
  for (const k in NAMES) {
    const f = path.join(DIR, NAMES[k]);
    let v;
    try {
      v = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!VALID[k](v)) throw new Error("unexpected structure");
    } catch (e) {
      if (fs.existsSync(f)) {
        fs.renameSync(f, f + ".corrupt-" + Date.now());
        warn.push(
          `${NAMES[k]}: ${e.message}; file moved aside, defaults restored`,
        );
      }
      v = defaults(k);
    }
    db[k] = v;
  }
  persist(...Object.keys(NAMES));
  return warn;
}
let q = Promise.resolve();
const dirty = new Set();
async function flush() {
  for (const k of [...dirty]) {
    dirty.delete(k);
    if (db[k] == null) continue;
    const f = path.join(DIR, NAMES[k]),
      t = f + ".tmp";
    await fs.promises.writeFile(t, JSON.stringify(db[k], null, 1));
    await fs.promises.rename(t, f);
  }
}
export const persist = (...ks) => {
  ks.forEach((k) => dirty.add(k));
  q = q.then(flush).catch((e) => console.error("persist failed", e));
};
export const idle = () => q;
