/* Core: session, API client, router, realtime, shared UI helpers, public pages */
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
let SESS = JSON.parse(localStorage.arena_sess || "null"),
  sock = null,
  tmr = null,
  INV = [];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const ini = (n) =>
    String(n)
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase(),
  hue = (s) =>
    [...String(s)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 360;
const mono = (n) =>
  `<div class="mono" style="--h:${hue(n)}">${esc(ini(n))}</div>`;
const RAR = {
  Common: "#9b9bad",
  Rare: "#2e86de",
  Epic: "#9b59b6",
  Legendary: "#f6c343",
  "???": "#666",
};
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(SESS ? { authorization: "Bearer " + SESS.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && SESS && !/login|register/.test(path)) {
    setSess(null);
    location.hash = "#/login";
  }
  if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")");
  return j;
}
function toast(m, err) {
  const t = $("#toast");
  t.textContent = m;
  t.style.background = err ? "#a31218" : "var(--red)";
  t.style.display = "block";
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.style.display = "none"), 3200);
}
function setSess(s) {
  SESS = s;
  s
    ? (localStorage.arena_sess = JSON.stringify(s))
    : localStorage.removeItem("arena_sess");
  connect();
  nav();
}
function connect() {
  if (sock) sock.disconnect();
  sock = io({ auth: { token: SESS?.token } });
  let t;
  sock.on("ev", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (live) render(true);
      if (e.t === "battle") invites();
    }, 180);
  });
  invites();
}
// incoming challenges show on every page: a count on the Battles link and a toast when a new one arrives
async function invites() {
  const was = INV.map((x) => x.id);
  INV =
    SESS?.role === "player"
      ? await api("/battles/invites").catch(() => INV)
      : [];
  const n = INV.filter((x) => !was.includes(x.id));
  if (n.length)
    toast(
      n.length > 1
        ? `⚔ ${n.length} new battle invitations: open Battles`
        : `⚔ ${n[0].from} challenged you: open Battles`,
    );
  nav();
}
let live = false;
/* ---------- router ---------- */
const R = [];
const route = (p, fn, o = {}) =>
  R.push({
    re: new RegExp("^" + p.replace(/:\w+/g, "([^/]+)") + "$"),
    fn,
    ...o,
  });
const snapshot = () => ({
  v: $$("[data-keep]").map((e) => [
    e.id,
    e.value,
    e === document.activeElement,
  ]),
  s: $$(".log").map((e) => e.scrollTop),
});
function restore(s) {
  if (!s) return;
  s.v.forEach(([id, v, f]) => {
    const e = document.getElementById(id);
    if (e) {
      e.value = v;
      if (f) e.focus();
    }
  });
  $$(".log").forEach((e, i) => (e.scrollTop = s.s[i] ?? 1e6));
}
async function render(keep) {
  const path = location.hash.slice(1) || "/",
    v = $("#view"),
    m = R.map((r) => [r, path.match(r.re)]).find((x) => x[1]);
  if (!m) {
    live = false;
    v.innerHTML =
      '<div class="panel"><h2>Page not found</h2><a class="btn" href="#/">Home</a></div>';
    return nav();
  }
  const [r, mm] = m;
  live = !!r.live;
  if (r.role && (!SESS || SESS.role !== r.role)) {
    v.innerHTML = `<div class="panel"><h2>Login required</h2><p class="mut">This page is for ${r.role === "admin" ? "administrators" : "players"}.</p><a class="btn red" href="#/${r.role === "admin" ? "admin-login" : "login"}">Log in</a></div>`;
    return nav();
  }
  if (!keep)
    v.innerHTML = '<div class="panel mut" aria-busy="true">Loading…</div>';
  const snap = keep ? snapshot() : null;
  try {
    const out = await r.fn(...mm.slice(1).map(decodeURIComponent)),
      o = typeof out === "string" ? { html: out } : out;
    if ((location.hash.slice(1) || "/") !== path) return;
    v.innerHTML = o.html;
    restore(snap);
    o.after && o.after();
  } catch (e) {
    v.innerHTML = `<div class="panel"><h2>Something went wrong</h2><p class="bad" role="alert">${esc(e.message)}</p><button class="btn" data-act="retry">Retry</button></div>`;
  }
  nav();
  if (!keep) window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => render());
function nav() {
  const a = SESS?.role === "admin",
    p = SESS?.role === "player",
    L = [
      ["/", "Home"],
      ["/lobby", "Lobby"],
      ["/catalogue", "Catalogue"],
      ["/auction", "Auction"],
      ...(p
        ? [
            ["/team", "My Team"],
            ["/store", "Store"],
          ]
        : []),
      ["/battles", "Battles"],
      ["/tournaments", "Tournaments"],
      ["/matches", "Match History"],
      ["/leaderboard", "Leaderboard"],
      ...(a ? [["/admin", "Admin"]] : []),
    ],
    cur = "#" + (location.hash.slice(1) || "/");
  $("#hdr").innerHTML =
    `<header class="top"><a class="logo" href="#/">MARVEL<b>ARENA</b></a><nav aria-label="Main">${L.map(([h, n]) => `<a href="#${h}" class="${cur === "#" + h || (h !== "/" && cur.startsWith("#" + h)) ? "on" : ""}">${n}${h === "/battles" && INV.length ? ` <span class="tag" style="color:var(--gold)" title="Battle invitations waiting for you">${INV.length}</span>` : ""}</a>`).join("")}</nav><span style="margin-left:auto;white-space:nowrap">${SESS ? `<small>${esc(SESS.name)} (${SESS.role})</small> <button class="btn sm" data-act="logout">Log out</button>` : '<a class="btn sm red" href="#/login">Log in</a>'}</span><button class="btn sm" data-act="motion" aria-label="Toggle animations" title="Toggle animations">✨</button></header>`;
}
const acts = {};
const act = (n, f) =>
  (acts[n] = async (b, e) => {
    try {
      await f(b, e);
    } catch (err) {
      toast(err.message, true);
    }
  });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b && acts[b.dataset.act]) acts[b.dataset.act](b, e);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $(".modal")?.remove();
});
act("retry", () => render());
act("logout", async () => {
  try {
    await api("/logout", { method: "POST" });
  } catch {}
  setSess(null);
  location.hash = "#/";
  toast("Logged out");
});
document.documentElement.classList.toggle(
  "reduce",
  localStorage.arena_reduce === "1" ||
    matchMedia("(prefers-reduced-motion:reduce)").matches,
);
act("motion", () => {
  localStorage.arena_reduce = document.documentElement.classList.toggle(
    "reduce",
  )
    ? "1"
    : "0";
});
setInterval(() => {
  $$("[data-deadline]").forEach((e) => {
    const d = +e.dataset.deadline;
    e.textContent = d
      ? Math.max(0, Math.ceil((d - Date.now()) / 1000)) + "s"
      : e.dataset.none || "";
  });
}, 250);
/* ---------- shared UI ---------- */
function modal(html) {
  $(".modal")?.remove();
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div role="dialog" aria-modal="true">${html}<div style="margin-top:12px"><button class="btn" data-act="close">Close</button></div></div>`;
  m.onclick = (e) => {
    if (e.target === m) m.remove();
  };
  document.body.appendChild(m);
  m.querySelector("button")?.focus();
  return m;
}
act("close", () => $(".modal")?.remove());
const sbar = (l, v, max = 150) =>
  `<div class="st"><span>${l}</span><div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><em>${v}</em></div>`;
const hp = (v, m, cls = "") =>
  `<div class="hpbar ${cls}" role="progressbar" aria-valuenow="${v}" aria-valuemax="${m}"><i style="width:${m ? Math.max(0, (v / m) * 100) : 0}%"></i><span>${Math.max(0, Math.round(v))} / ${m}</span></div>`;
const status = (st) =>
  Object.entries(st || {})
    .map(([k, v]) => `<span class="tag">${esc(k)} ${v.turns}</span>`)
    .join("");
// ability chips: locked ones show their unlock level, unlocked ones their rank
const abilityTags = (c) =>
  (c.abilities || [])
    .map(
      (a) =>
        `<span class="tag ${a.rank ? "" : "lock"}" title="${esc(a.desc || "")}">${a.rank ? "" : "🔒 "}${esc(a.name)}${a.ultimate ? " ⚡" : ""}${a.rank ? (a.rank > 1 ? " " + ["", "I", "II", "III"][a.rank] : "") : " · Lv " + a.unlockLevel}</span>`,
    )
    .join("");
function cCard(c, extra = "") {
  if (c.mystery)
    return `<div class="panel cc"><div class="row"><div class="mono">?</div><div><b>Mystery Hero</b><br><small>Stats revealed after the sale</small></div></div><div>Base ${c.basePrice}</div></div>`;
  return `<div class="panel cc" style="border-left-color:${RAR[c.rarity]}"><div class="row">${c.image ? `<img class="portrait" src="${esc(c.image)}" alt="${esc(c.name)}">` : mono(c.name)}<div style="flex:1"><b>${esc(c.short || c.name)}</b><br><small>${esc(c.category)}</small></div>${c.level > 1 ? `<span class="tag">Lv ${c.level}</span>` : ""}<span class="rar" style="color:${RAR[c.rarity]}">${c.rarity}</span></div>
 <div style="margin:8px 0">${sbar("Health", c.maxHealth, 700)}${sbar("Attack", c.attack, 200)}${sbar("Defence", c.defence, 100)}${sbar("Speed", c.speed, 100)}</div>
 <div class="row sp"><span>Base <b style="color:var(--gold)">${c.basePrice}</b></span>${extra}<button class="btn sm" data-act="char" data-id="${c.id}">Details</button></div></div>`;
}
let CHARS = [];
act("char", async (b) => {
  if (!CHARS.length) CHARS = await api("/characters");
  const c = CHARS.find((x) => x.id === b.dataset.id);
  if (!c) return;
  modal(`<h2>${esc(c.name)}</h2><p class="mut">${esc(c.universe)} · ${esc(c.category)} · <span style="color:${RAR[c.rarity]}">${c.rarity}</span> · base ${c.basePrice}</p>${hp(c.currentHealth, c.maxHealth)}<div style="margin:8px 0">${sbar("Attack", c.attack, 200)}${sbar("Defence", c.defence, 100)}${sbar("Speed", c.speed, 100)}${sbar("Energy", c.energy, 100)}</div>
 <h3>Abilities</h3>${c.abilities.map((a) => `<div class="panel" style="margin:6px 0;${a.rank ? "" : "opacity:.6"}"><b>${a.rank ? "" : "🔒 "}${esc(a.name)}</b> <span class="tag">${a.kind}${a.ultimate ? " · ultimate (needs full charge)" : ""}</span> <span class="tag">${a.rank ? "rank " + ["", "I", "II", "III"][a.rank] : "unlocks at Lv " + a.unlockLevel}</span><br><small>Power ${a.power} · Energy ${a.cost} · Cooldown ${a.ultimate ? "–" : a.cd}${a.heal ? " · Heal " + Math.round(a.heal * 100) + "%" : ""}${a.self ? " · self: " + a.self.status : ""}${a.foe ? " · foe: " + a.foe.status : ""}</small><br><small>${esc(a.desc || "")}</small></div>`).join("") || '<p class="mut">No special abilities.</p>'}
 ${c.teamUps?.length ? `<h3>Team-ups</h3>${c.teamUps.map((t) => `<p style="margin:4px 0"><b>${esc(t.name)}</b> with ${esc(t.partner)} <small class="mut">(both in the same squad) · ${esc(t.desc || "")}</small></p>`).join("")}` : ""}
 ${c.perks?.length ? `<h3>Perks</h3>${c.perks.map((p) => `<span class="tag perk">★ ${esc(p.name)}</span> <small>${esc(p.desc)}</small>`).join("<br>")}` : ""}
 <small>Level ${c.level || 1}${c.xpNext ? ` · XP ${c.xp}/${c.xpNext}` : ""} · Record: ${c.record?.wins || 0} wins in ${c.record?.battles || 0} battles${c.isEliminated ? " · currently eliminated" : ""}${c.restUntil ? " · resting" : ""}</small>`);
});
const dt = (s) => new Date(s).toLocaleString();
/* ---------- public pages ---------- */
route("/", async () => {
  const s = await api("/state");
  return `<section class="hero"><h1>MARVEL <span>ARENA</span></h1><p class="mut" style="max-width:640px">Bid for heroes with a secret purse, then fight turn-based battles where you and your opponent choose in secret. Teams: ${s.teams} · Auction: <b>${s.auction.status}</b> · Live battles: ${s.battlesActive}</p>
 <div class="row" style="margin-top:14px">${SESS ? `<a class="btn red" href="#/lobby">Enter lobby</a>` : `<a class="btn red" href="#/login">Quick start</a>`}<a class="btn gold" href="#/auction">Auction room</a><a class="btn" href="#/battles">Battle lobby</a><a class="btn" href="#/admin-login">Admin</a></div></section>
 <div class="grid g3" style="margin-top:20px"><div class="panel"><h3>1 · Auction</h3><p class="mut">Bid on heroes. Balances are private: rivals only see the current bid, never your purse.</p></div><div class="panel"><h3>2 · Draft your roster</h3><p class="mut">Each hero has health, energy, abilities and cooldowns that persist.</p></div><div class="panel"><h3>3 · Battle</h3><p class="mut">Pick an action in secret. Both actions resolve at once on the server.</p></div></div>`;
});
route("/login", async () => {
  const open = await api("/teams/open"),
    s = await api("/state");
  return {
    html: `<div class="split"><div class="panel"><h2>Player login</h2><div class="grid"><input id="lu" aria-label="Username" placeholder="Username" autocomplete="username"><input id="lp" type="password" aria-label="Password" placeholder="Password" autocomplete="current-password"><button class="btn red" data-act="login">Log in</button></div></div>
 <div class="panel gold"><h2>New player</h2><div class="grid"><input id="ru" aria-label="Choose a username" placeholder="Choose a username"><input id="rp" type="password" aria-label="Choose a password" placeholder="Password (8+ characters)">
 <label>Team <select id="rt"><option value="">Create a new team…</option>${open.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label><input id="rn" aria-label="New team name" placeholder="New team name" ${s.settings.allowSelfTeam ? "" : "disabled"}><button class="btn gold" data-act="register">Register &amp; play</button></div></div></div>`,
  };
});
const afterLogin = (r) => {
  setSess({ token: r.token, role: r.role, name: r.name, teamId: r.teamId });
  location.hash = r.role === "admin" ? "#/admin" : "#/lobby";
  toast("Welcome, " + r.name);
};
act("login", async () =>
  afterLogin(
    await api("/login", {
      method: "POST",
      body: { username: $("#lu").value, password: $("#lp").value },
    }),
  ),
);
act("register", async () =>
  afterLogin(
    await api("/register", {
      method: "POST",
      body: {
        username: $("#ru").value,
        password: $("#rp").value,
        teamId: $("#rt").value || undefined,
        teamName: $("#rn").value,
      },
    }),
  ),
);
route(
  "/admin-login",
  () =>
    `<div class="panel" style="max-width:420px;margin:auto"><h2>Admin login</h2><div class="grid"><input id="au" aria-label="Admin username" placeholder="Admin username" autocomplete="username"><input id="ap" type="password" aria-label="Admin password" placeholder="Password" autocomplete="current-password"><button class="btn red" data-act="alogin">Log in</button></div></div>`,
);
act("alogin", async () =>
  afterLogin(
    await api("/admin/login", {
      method: "POST",
      body: { username: $("#au").value, password: $("#ap").value },
    }),
  ),
);
route(
  "/lobby",
  async () => {
    const [s, t, b] = await Promise.all([
      api("/state"),
      api("/teams"),
      api("/battles"),
    ]);
    const live = b.filter(
      (x) => !["Finished", "BattleCancelled", "Declined"].includes(x.state),
    );
    return {
      html: `<h1 style="font-size:2.6rem">LOBBY</h1><div class="grid g3"><div class="panel gold"><h3>Auction</h3><div class="big" style="font-size:2rem">${s.auction.status.toUpperCase()}</div><a class="btn red" href="#/auction">Open auction room</a></div>
 <div class="panel"><h3>Modes</h3><p class="mut">Quick Battle with your squad size · Draft (bans) · Ranked · Arena mode (full recovery) · Campaign mode (health persists, heroes rest) · Practice vs bot · Tournaments · Team-ups · Spectator &amp; replays</p><a class="btn" href="#/battles">Battle lobby</a></div><div class="panel"><h3>Live battles</h3><p>${live.length ? live.map((x) => `<a href="#/battle/${x.id}">${esc(x.teams.map((y) => y.name).join(" vs "))}</a> <small>(${x.state})</small>`).join("<br>") : '<span class="mut">None right now</span>'}</p></div></div>
 <h2 style="margin-top:16px">Teams</h2><div class="grid g3">${t.map((x) => `<div class="panel team" style="--c:${x.color}"><b>${esc(x.name)}</b> <small>rating ${x.rating}</small><br><small>${x.roster.length} characters · ${x.wins}W ${x.losses}L ${x.draws}D</small><div>${x.roster.map((c) => `<span class="tag">${esc(c.short || c.name)}</span>`).join("")}</div></div>`).join("") || '<p class="mut">No teams yet.</p>'}</div>`,
    };
  },
  { live: true },
);
route("/catalogue", async () => {
  CHARS = await api("/characters");
  const cats = [...new Set(CHARS.map((c) => c.category))];
  return {
    html: `<h1 style="font-size:2.6rem">CHARACTER CATALOGUE</h1><div class="row" style="margin-bottom:12px"><input id="cq" data-keep aria-label="Search" placeholder="Search name…" style="flex:1;min-width:160px"><select id="cr" data-keep aria-label="Rarity"><option value="">Any rarity</option>${["Common", "Rare", "Epic", "Legendary"].map((r) => `<option>${r}</option>`).join("")}</select>
 <select id="cc" data-keep aria-label="Category"><option value="">Any category</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select><select id="co" data-keep aria-label="Ownership"><option value="">Any</option><option value="free">Available</option><option value="owned">Owned</option></select>
 <select id="cs" data-keep aria-label="Sort"><option value="name">Name</option><option value="basePrice">Price</option><option value="attack">Attack</option><option value="maxHealth">Health</option><option value="speed">Speed</option></select></div><div class="grid g3" id="cg"></div>`,
    after: () => {
      const draw = () => {
        const q = $("#cq").value.toLowerCase(),
          r = $("#cr").value,
          c = $("#cc").value,
          o = $("#co").value,
          s = $("#cs").value;
        let l = CHARS.filter(
          (x) =>
            x.name.toLowerCase().includes(q) &&
            (!r || x.rarity === r) &&
            (!c || x.category === c) &&
            (!o || (o === "owned") === !!x.ownerTeamId),
        );
        l.sort((a, b) =>
          s === "name"
            ? a.name.localeCompare(b.name)
            : (b[s] || 0) - (a[s] || 0),
        );
        $("#cg").innerHTML =
          l
            .slice(0, 120)
            .map((x) =>
              cCard(
                x,
                x.ownerTeamId
                  ? '<span class="tag sold">owned</span>'
                  : x.availability !== "available"
                    ? `<span class="tag">${x.availability}</span>`
                    : "",
              ),
            )
            .join("") || '<p class="mut">No characters match.</p>';
      };
      ["#cq", "#cr", "#cc", "#co", "#cs"].forEach((i) => ($(i).oninput = draw));
      draw();
    },
  };
});
route("/leaderboard", async () => {
  const [l, a] = await Promise.all([api("/leaderboard"), api("/analytics")]);
  return `<h1 style="font-size:2.6rem">LEADERBOARD</h1><div class="panel gold scroll"><table><tr><th>#</th><th>Team</th><th>Rating</th><th>W</th><th>L</th><th>D</th><th>Win %</th><th>Streak</th><th>Best</th><th>Points earned</th><th>Heroes</th></tr>${l.map((t) => `<tr><td>${t.rank}</td><td style="border-left:4px solid ${t.color}"><b>${esc(t.name)}</b></td><td><b>${t.rating}</b></td><td>${t.wins}</td><td>${t.losses}</td><td>${t.draws}</td><td>${t.winRate}%</td><td>${t.streak}</td><td>${t.bestStreak}</td><td>${t.pointsEarned ?? 0}</td><td>${t.characters}</td></tr>`).join("")}</table></div>
 <div class="grid g2" style="margin-top:14px"><div class="panel"><h3>Character win rates</h3>${a.characters.map((c) => `<div class="row sp"><span>${esc(c.name)}</span><span>${c.winRate}% <small>(${c.battles})</small></span></div>`).join("") || '<span class="mut">No battles yet</span>'}</div><div class="panel"><h3>Biggest purchases</h3>${a.spending.map((c) => `<div class="row sp"><span>${esc(c.name)} → ${esc(c.team)}</span><b>${c.price}</b></div>`).join("") || '<span class="mut">No sales yet</span>'}</div></div>`;
});
