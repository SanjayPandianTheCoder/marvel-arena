// Persistence: in-memory cache + MongoDB (the only store). All game mutations are synchronous on the cache (so they cannot interleave);
// persist(k) marks a part dirty and a serialised queue writes only the documents that changed since the last write.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseEnv } from "util";
import { randomBytes } from "crypto";
import { MongoClient } from "mongodb";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// .env holds configuration only (connection string, admin password); it never overrides variables that are already set
try {
  const env = parseEnv(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
  for (const k in env) process.env[k] ??= env[k];
} catch {}
export const db = {};
export const uid = (p) => p + "_" + randomBytes(5).toString("hex");
export const VALID = {
  characters: Array.isArray,
  teams: Array.isArray,
  battles: Array.isArray,
  tournaments: Array.isArray,
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
/* How each part of db maps onto MongoDB:
   list   → one document per item (_id = item.id, _i = position, so order survives)
   append → like list, but only new items are written (history is append-only)
   map    → one document per key (_id = key)
   single → one document { _id, value } in the "meta" collection */
const PARTS = {
  characters: [{ coll: "characters", type: "list", get: () => db.characters }],
  teams: [{ coll: "teams", type: "list", get: () => db.teams }],
  battles: [{ coll: "battles", type: "list", get: () => db.battles }],
  tournaments: [
    { coll: "tournaments", type: "list", get: () => db.tournaments },
  ],
  history: [{ coll: "history", type: "append", get: () => db.history }],
  players: [
    { coll: "players", type: "list", get: () => db.players.players },
    { coll: "sessions", type: "map", get: () => db.players.sessions },
  ],
  auction: [{ coll: "meta", type: "single", id: "auction", get: () => db.auction }],
  settings: [
    { coll: "meta", type: "single", id: "settings", get: () => db.settings },
  ],
  admin: [{ coll: "meta", type: "single", id: "admin", get: () => db.admin }],
};
// the parts of db, in load order (backup/restore and reset iterate over these)
export const KEYS = Object.keys(PARTS);
const pkey = (p) => p.coll + ":" + (p.id || "");
let client = null,
  mdb = null;
// what is known to be stored, per part: Map(_id → JSON) for list/map/single, { ref, n } for append; missing = unknown (full sync)
const seen = new Map();
const docsOf = (p) => {
  const v = p.get();
  if (p.type === "single") return v == null ? [] : [[p.id, { value: v }]];
  if (p.type === "map") return Object.entries(v);
  return v.map((x, i) => [x.id ?? "_" + i, { ...x, _i: i }]);
};
const strip = ({ _id, _i, ...x }) => x;
// returns { v, exact }: exact = stored exactly as this code writes it (list positions 0..n-1), so it can be diffed against
async function read(k) {
  const v = {};
  let exact = true;
  for (const p of PARTS[k]) {
    const C = mdb.collection(p.coll);
    if (p.type === "single") {
      const d = await C.findOne({ _id: p.id });
      v[p.coll] = d ? d.value : undefined;
    } else if (p.type === "map")
      v[p.coll] = Object.fromEntries(
        (await C.find().toArray()).map((d) => [d._id, strip(d)]),
      );
    else {
      const docs = await C.find().sort({ _i: 1 }).toArray();
      if (docs.some((d, i) => d._i !== i)) exact = false;
      v[p.coll] = docs.map(strip);
    }
  }
  return {
    v:
      k === "players"
        ? { players: v.players, sessions: v.sessions }
        : v[PARTS[k][0].coll],
    exact,
  };
}
export async function load(defaults) {
  const uri = process.env.MONGODB_URI;
  if (!uri)
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env and put your MongoDB connection string in it.",
    );
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  mdb = client.db(process.env.MONGODB_DB || "marvel-arena");
  const warn = [],
    colls = [...new Set(Object.values(PARTS).flat().map((p) => p.coll))],
    counts = await Promise.all(
      colls.map((c) => mdb.collection(c).estimatedDocumentCount()),
    ),
    fresh = counts.every((n) => !n);
  for (const k in PARTS) {
    let v,
      asIs = false;
    if (!fresh) {
      const r = await read(k);
      v = r.v;
      if (v !== undefined && !VALID[k](v)) {
        // keep the bad document for inspection, then fall back to defaults
        await mdb
          .collection("corrupt")
          .insertOne({ part: k, ts: new Date().toISOString(), raw: v });
        warn.push(
          `${k}: unexpected structure; copy saved in the "corrupt" collection, defaults restored`,
        );
        v = undefined;
      } else asIs = v !== undefined && r.exact;
    }
    db[k] = v === undefined ? defaults(k) : v;
    // parts loaded as-is are already stored: remember them so the first write only sends changes
    if (asIs)
      PARTS[k].forEach((p) =>
        seen.set(
          pkey(p),
          p.type === "append"
            ? { ref: p.get(), n: p.get().length }
            : new Map(docsOf(p).map(([id, d]) => [id, JSON.stringify(d)])),
        ),
      );
  }
  persist(...Object.keys(PARTS));
  return warn;
}
async function flushPart(p) {
  const C = mdb.collection(p.coll),
    key = pkey(p),
    s = seen.get(key);
  const put = (id, doc) => ({
    replaceOne: { filter: { _id: id }, replacement: doc, upsert: true },
  });
  if (p.type === "append") {
    const a = p.get(),
      n = a.length,
      same = s && s.ref === a && n >= s.n,
      ops = a
        .slice(same ? s.n : 0, n)
        .map((x, i) => put(x.id, JSON.parse(JSON.stringify({ ...x, _i: (same ? s.n : 0) + i }))));
    if (!same) await C.deleteMany({});
    if (ops.length) await C.bulkWrite(ops, { ordered: false });
    seen.set(key, { ref: a, n });
    return;
  }
  const next = new Map(),
    ops = [];
  for (const [id, doc] of docsOf(p)) {
    const j = JSON.stringify(doc);
    next.set(id, j);
    // JSON.parse(j) snapshots the document now, so later in-memory changes cannot leak into this write
    if (!s || s.get(id) !== j) ops.push(put(id, JSON.parse(j)));
  }
  if (p.type === "single") {
    if (!next.size && (!s || s.size)) ops.push({ deleteOne: { filter: { _id: p.id } } });
  } else if (!s) ops.push({ deleteMany: { filter: { _id: { $nin: [...next.keys()] } } } });
  else {
    const gone = [...s.keys()].filter((id) => !next.has(id));
    if (gone.length) ops.push({ deleteMany: { filter: { _id: { $in: gone } } } });
  }
  if (ops.length) await C.bulkWrite(ops, { ordered: false });
  seen.set(key, next);
}
let q = Promise.resolve(),
  retry = null;
const dirty = new Set();
async function flush() {
  if (!mdb) return; // not connected yet: stays dirty until load() connects
  for (const k of [...dirty]) {
    dirty.delete(k);
    if (db[k] === undefined) continue;
    try {
      for (const p of PARTS[k]) await flushPart(p);
    } catch (e) {
      dirty.add(k);
      console.error(`[db] saving ${k} failed: ${e.message}; retrying in 5s`);
      clearTimeout(retry);
      retry = setTimeout(() => persist(), 5000);
    }
  }
}
export const persist = (...ks) => {
  ks.forEach((k) => dirty.add(k));
  q = q.then(flush);
};
/* single-document parts (e.g. settings) edited in the database directly are re-read every few seconds and handed to
   onChange(k, value), which adopts them into db[k] or rejects them; either way it calls persist(k), so a rejected edit is
   overwritten by the in-memory copy. Checks run in the write queue, so they never overlap a write; a part with an
   unwritten local change is skipped (the local change wins). A deleted document is written back from memory. */
let watcher = null;
export function watch(keys, onChange, ms = 5000) {
  async function check() {
    for (const k of keys) {
      const p = PARTS[k][0],
        s = seen.get(pkey(p));
      if (dirty.has(k) || !s) continue;
      const d = await mdb.collection(p.coll).findOne({ _id: p.id });
      if (!d) {
        if (s.size) {
          s.delete(p.id);
          persist(k);
        }
        continue;
      }
      const j = JSON.stringify({ value: d.value });
      if (s.get(p.id) === j) continue;
      s.set(p.id, j); // what the database holds now, so the next write sends whatever differs from it
      onChange(k, d.value);
    }
  }
  clearInterval(watcher);
  watcher = setInterval(() => {
    q = q.then(check).catch((e) => console.error("[db] reading external changes failed:", e.message));
  }, ms);
  watcher.unref();
}
export const idle = () => q;
export const close = async () => {
  clearInterval(watcher);
  await idle();
  await client?.close();
};
