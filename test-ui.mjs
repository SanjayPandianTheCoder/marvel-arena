import { spawn } from "child_process";
import { JSDOM } from "jsdom";
import { MongoMemoryServer } from "mongodb-memory-server";
const PORT = 3090,
  U = "http://localhost:" + PORT,
  mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 60000 },
  });
const srv = spawn("node", ["server/index.js"], {
  env: {
    ...process.env,
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB: "arena_ui",
    PORT: String(PORT),
    ADMIN_PASSWORD: "TestAdmin#123",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((r) =>
  srv.stdout.on("data", (d) => /running/.test(d) && r()),
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) fails++;
};
const call = async (m, p, b, t) => {
  const r = await fetch(U + "/api" + p, {
    method: m,
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: "Bearer " + t } : {}),
    },
    body: b ? JSON.stringify(b) : undefined,
  });
  return r.json();
};
const adm = (
  await call("POST", "/admin/login", {
    username: "admin",
    password: "TestAdmin#123",
  })
).token;
await call(
  "PUT",
  "/admin/settings",
  {
    rosterLimit: 2,
    auction: { timer: 0, lotGapMs: 500 },
    battle: { summaryMs: 500 },
  },
  adm,
);
const A = await call("POST", "/register", {
    username: "alice",
    password: "password1",
    teamName: "Alpha",
  }),
  B = await call("POST", "/register", {
    username: "bobby",
    password: "password2",
    teamName: "Beta",
  });
const open = async (sess) => {
  const dom = await JSDOM.fromURL(U + "/", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, U), o);
      w.matchMedia = () => ({ matches: false });
      w.scrollTo = () => {};
      w.confirm = () => true;
      w.prompt = () => "test";
      w.URL.createObjectURL = () => "blob:x";
      if (sess) w.localStorage.setItem("arena_sess", JSON.stringify(sess));
    },
  });
  await wait(900);
  return dom.window;
};
const go = async (w, h, ms = 700) => {
  w.location.hash = h;
  await wait(ms);
  const t = w.document.getElementById("view").textContent;
  return t;
};
const bad = (t) => /Something went wrong|Page not found|Loading…$/.test(t);
let w = await open(null);
for (const h of [
  "#/",
  "#/login",
  "#/lobby",
  "#/catalogue",
  "#/auction",
  "#/battles",
  "#/tournaments",
  "#/matches",
  "#/leaderboard",
  "#/admin-login",
]) {
  const t = await go(w, h);
  ok(!bad(t) && t.length > 10, "public route " + h + " renders");
}
ok(/Login required/.test(await go(w, "#/team")), "player page asks for login");
ok(
  /Login required/.test(await go(w, "#/admin")),
  "admin page asks for admin login",
);
/* real login through the UI form */
await go(w, "#/login");
w.document.getElementById("lu").value = "alice";
w.document.getElementById("lp").value = "password1";
w.document.querySelector("[data-act=login]").click();
await wait(1200);
ok(
  w.location.hash === "#/lobby" &&
    /alice/.test(w.document.getElementById("hdr").textContent),
  "UI login works and shows the user",
);
ok(!bad(await go(w, "#/team")), "My Team renders");
ok(
  /1000/.test(w.document.getElementById("view").textContent),
  "player sees own balance in UI",
);
const stt = await go(w, "#/store");
ok(
  !bad(stt) &&
    /STORE/.test(stt) &&
    /Med Kit S/.test(stt) &&
    /Energy Kit L/.test(stt) &&
    /Exchange points/.test(stt) &&
    /Hero progression/.test(stt) &&
    /no daily limit/.test(stt),
  "Store page renders kits, progression and exchange",
);
ok(
  /Daily gift/.test(stt) && /Day 7/.test(stt),
  "store shows the daily gift calendar",
);
w.document.querySelector("[data-act=gift]").click();
await wait(900);
ok(
  /Claimed today/.test(w.document.getElementById("view").textContent) &&
    /Day 1: \+20 points/.test(w.document.getElementById("toast").textContent),
  "claiming the daily gift in the UI",
);
const bl = await go(w, "#/battles");
ok(
  /Heroes per side/.test(bl) && /Practice vs bot/.test(bl) && /Draft/.test(bl),
  "battle lobby offers squad size, draft and practice",
);
/* catalogue modal + filter */
await go(w, "#/catalogue");
w.document.getElementById("cq").value = "thor";
w.document.getElementById("cq").dispatchEvent(new w.Event("input"));
await wait(200);
ok(
  /Thor/.test(w.document.getElementById("cg").textContent),
  "catalogue search filters",
);
w.document.querySelector("[data-act=char]").click();
await wait(500);
ok(
  /Abilities/.test(w.document.querySelector(".modal")?.textContent || ""),
  "character details modal shows abilities",
);
w.document.querySelector(".modal [data-act=close]").click();
/* auction through the UI */
const chars = await call("GET", "/characters");
const id = (n) => chars.find((c) => c.name.startsWith(n)).id;
await call(
  "POST",
  "/admin/auction/configure",
  {
    mode: "custom",
    ids: ["Iron Man", "Spider-Man (", "Thor Odinson", "Wolverine"].map(id),
  },
  adm,
);
await call("POST", "/admin/auction/start", {}, adm);
await go(w, "#/auction");
ok(
  /Iron Man/.test(w.document.getElementById("view").textContent),
  "auction page shows the live lot",
);
const html = w.document.getElementById("view").innerHTML;
ok(
  !/balance|ledger/i.test(html.replace(/Your balance/g, "")),
  "auction page shows no balance/ledger data except the player's own balance",
);
w.document.querySelector("[data-act=bid]").click();
await wait(800);
ok(
  /Leading: <b>Alpha/.test(w.document.getElementById("view").innerHTML),
  "clicking Bid places the bid and the page updates live",
);
await call("POST", "/auction/pass", {}, B.token);
await wait(1500);
const bw = await open({
  token: B.token,
  role: "player",
  name: "bobby",
  teamId: B.teamId,
});
await go(bw, "#/auction", 900);
for (const [t, tk] of [
  [A, A.token],
  [B, B.token],
]) {
}
const lot2 = async (buyer) => {
  const a = await call("GET", "/auction");
  await call("POST", "/auction/bid", { amount: a.current.next }, buyer.token);
};
await wait(800);
await lot2(B);
await call("POST", "/auction/pass", {}, A.token);
await wait(1200);
await lot2(A);
await call("POST", "/auction/pass", {}, B.token);
await wait(1200);
await lot2(B);
await call("POST", "/auction/pass", {}, A.token);
await wait(1500);
ok((await call("GET", "/auction")).status === "ended", "auction completed");
/* battle through the UI (both players in separate browser windows) */
const me = await call("GET", "/me", null, A.token),
  meB = await call("GET", "/me", null, B.token);
const bid_ = (
  await call("POST", "/battles", { opponentTeamId: meB.team.id }, A.token)
).id;
await go(bw, "#/battle/" + bid_, 800);
ok(
  /challenged you/.test(bw.document.getElementById("view").textContent),
  "invited player sees Accept/Decline",
);
bw.document.querySelector('[data-act=resp][data-a="1"]').click();
await wait(1200);
ok(
  /Pick exactly 2 heroes/.test(bw.document.getElementById("view").textContent),
  "both move to squad selection",
);
await go(w, "#/battle/" + bid_, 900);
const lockQ = (win) => win.document.querySelector("[data-act=lockq]");
ok(lockQ(w).disabled, "squad lock disabled until N heroes are picked");
w.document.querySelectorAll("[data-act=pickq]").forEach((b) => b.click());
ok(
  !lockQ(w).disabled && /2\/2/.test(lockQ(w).textContent),
  "picking N heroes enables the squad lock",
);
lockQ(w).click();
await wait(900);
const bt = bw.document.getElementById("view").textContent;
const opp =
  bw.document.querySelector(".arena .panel.fighter:last-child")?.textContent ||
  "";
ok(
  /READY/.test(bt) && /No active character/.test(opp),
  "opponent sees READY but not the chosen active fighter",
);
bw.document.querySelectorAll("[data-act=pickq]").forEach((b) => b.click());
lockQ(bw).click();
await wait(1200);
ok(
  /Basic Attack/.test(w.document.getElementById("view").textContent),
  "action menu appears with abilities for turn 1",
);
const opt = w.document.querySelector("[data-act=picka][data-key=heavy]");
opt.click();
w.document.querySelector("[data-act=locka]").click();
await wait(800);
ok(
  /Locked: Heavy Attack/.test(w.document.getElementById("view").textContent),
  "player locks Heavy Attack",
);
ok(
  !/Heavy Attack/.test(
    bw.document
      .getElementById("view")
      .textContent.split("Turn 1")[0]
      .replace(/Basic Attack[\s\S]*Pass Turn/, ""),
  ),
  "(opponent cannot see it before resolving)",
);
bw.document.querySelector("[data-act=picka][data-key=defend]").click();
bw.document.querySelector("[data-act=locka]").click();
await wait(1500);
ok(
  /Turn 1 report/.test(w.document.getElementById("view").textContent),
  "turn report visible after both locked",
);
ok(
  /Ultimate \d+%/.test(w.document.getElementById("view").textContent),
  "the arena shows the ultimate charge",
);
await call("POST", `/battles/${bid_}/forfeit`, {}, B.token);
await wait(600);
ok(
  /Rematch/.test(w.document.getElementById("view").textContent),
  "finished battle offers a rematch",
);
await go(w, "#/replay/" + bid_, 900);
w.document.querySelector('[data-act=rp][data-d="1"]').click();
ok(
  /REPLAY/.test(w.document.getElementById("view").textContent) &&
    /Turn 1 of 1/.test(w.document.getElementById("view").textContent),
  "replay steps through the turns",
);
/* admin pages */
const aw = await open(null);
await go(aw, "#/admin-login");
aw.document.getElementById("au").value = "admin";
aw.document.getElementById("ap").value = "TestAdmin#123";
aw.document.querySelector("[data-act=alogin]").click();
await wait(1200);
ok(aw.location.hash === "#/admin", "admin UI login works");
for (const h of [
  "#/admin",
  "#/admin/characters",
  "#/admin/teams",
  "#/admin/tournaments",
  "#/admin/history",
  "#/admin/settings",
  "#/admin/backup",
  "#/battle/" + bid_,
]) {
  const t = await go(aw, h, 900);
  ok(!bad(t) && t.length > 60, "admin route " + h.slice(0, 24) + " renders");
}
await go(aw, "#/admin");
ok(
  /1000|\d{3}/.test(aw.document.getElementById("view").textContent) &&
    /Teams &amp; private balances|private balances/i.test(
      aw.document.getElementById("view").innerHTML,
    ),
  "admin dashboard shows private balances",
);
await go(aw, "#/battle/" + bid_, 900);
srv.kill("SIGTERM");
await mongo.stop();
console.log(fails ? `\n${fails} FAILED` : "\nUI SMOKE TEST PASSED");
process.exit(fails ? 1 : 0);
