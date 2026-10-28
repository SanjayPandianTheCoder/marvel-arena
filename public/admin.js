/* Admin pages: dashboard (auction + battles), characters, teams & players, history, settings, backup */
const adminNav = (cur) =>
  `<div class="tabs" role="tablist">${[
    ["/admin", "Dashboard"],
    ["/admin/characters", "Characters"],
    ["/admin/teams", "Teams & Players"],
    ["/admin/tournaments", "Tournaments"],
    ["/admin/history", "Game History"],
    ["/admin/settings", "Settings"],
    ["/admin/backup", "Backup & Restore"],
  ]
    .map(
      ([h, n]) =>
        `<a class="btn sm ${cur === h ? "red" : ""}" href="#${h}">${n}</a>`,
    )
    .join(" ")}</div>`;
const post = (p, body) =>
  api("/admin" + p, { method: "POST", body: body || {} });
const sel = (id, opts, v) =>
  `<select id="${id}" data-keep>${opts.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
route(
  "/admin",
  async () => {
    const [o, chars] = await Promise.all([
        api("/admin/overview"),
        api("/admin/characters/export"),
      ]),
      a = o.auction,
      T = o.teams,
      avail = chars.filter(
        (c) => c.availability === "available" && !c.ownerTeamId,
      );
    const tOpts = T.map((t) => [t.id, t.name]),
      cOpts = avail.map((c) => [c.id, c.name]);
    return {
      html: `<h1 style="font-size:2.4rem">ADMIN DASHBOARD</h1>${adminNav("/admin")}${o.warnings.length ? `<div class="panel bad">${o.warnings.map(esc).join("<br>")}</div>` : ""}
 <div class="grid g3"><div class="panel gold"><small>Auction</small><div class="big" style="font-size:2rem">${a.status.toUpperCase()}</div><small>${a.total} lots · ${a.upcoming} upcoming · lot ${a.lot}</small></div><div class="panel"><small>Teams / players</small><div class="big" style="font-size:2rem;color:var(--tx)">${T.length} / ${o.players.length}</div></div><div class="panel"><small>Open disputes</small><div class="big" style="font-size:2rem;color:var(--tx)">${o.battles.reduce((s, b) => s + b.disputes, 0)}</div></div></div>
 <div class="split" style="margin-top:14px"><div class="panel"><h3>Auction setup</h3><div class="row"><label>Pool ${sel(
   "am",
   [
     ["complete", "Complete pool"],
     ["random", "Random pool"],
     ["custom", "Custom pool"],
   ],
   "complete",
 )}</label><label>Random count <input type="number" id="ac" value="40" style="width:80px"></label><label>Bid step <input type="number" id="ai" value="${a.increment}" style="width:80px"></label><label>Timer s <input type="number" id="at" value="${a.timer}" style="width:80px"></label><label>Mystery % <input type="number" id="ay" value="0" style="width:80px"></label></div>
  <details style="margin:8px 0"><summary>Custom pool (${avail.length} available)</summary><div class="pick" style="max-height:220px;overflow:auto">${avail.map((c) => `<label><input type="checkbox" class="cp" value="${c.id}"> ${esc(c.short || c.name)}</label>`).join("")}</div></details>
  <div class="row"><button class="btn gold" data-act="aconf">Configure</button><button class="btn ok" data-act="aop" data-op="start">Start</button><button class="btn" data-act="aop" data-op="pause">Pause</button><button class="btn" data-act="aop" data-op="resume">Resume</button><button class="btn red" data-act="aend">End</button></div></div>
  <div class="panel"><h3>Special rounds</h3><div class="row">${sel("rt", tOpts)}${sel("rc", cOpts)}<input type="number" id="rp" value="20" style="width:80px" aria-label="Price"><button class="btn sm gold" data-act="retain">Retain</button></div>
  <div class="row" style="margin-top:8px"><input type="number" id="bp" value="100" style="width:80px" aria-label="Bonus"><button class="btn sm" data-act="bonus" data-t="1">Bonus: trailing teams</button><button class="btn sm" data-act="bonus">Bonus: ${T[0] ? "selected team" : "team"}</button></div>
  <div class="row" style="margin-top:8px"><button class="btn sm" data-act="emerg">Add emergency lots</button>${sel("hl", tOpts)}<button class="btn sm ok" data-act="healt">Heal team</button></div></div></div>
 <div class="panel" style="margin-top:14px"><h3>Teams &amp; private balances</h3><div class="scroll"><table><tr><th>Team</th><th>Balance</th><th>Spent</th><th>Points</th><th>Heroes</th><th>Rating</th></tr>${T.map((t) => `<tr><td>${esc(t.name)}</td><td><b>${t.balance}</b></td><td>${t.spent}</td><td>${t.points}</td><td>${t.roster.map((c) => esc(c.short || c.name)).join(", ")}</td><td>${t.rating}</td></tr>`).join("")}</table></div></div>
 ${a.current ? `<div class="panel" style="margin-top:14px"><h3>Current lot: ${esc(a.current.char.name)}</h3><p>Bid ${a.current.leader ? a.current.bid + " by " + esc(a.current.leader.name) : "none"} · <span data-deadline="${a.current.deadline || ""}"></span></p></div>` : ""}
 <div class="panel" style="margin-top:14px"><h3>Correct a transaction (audited)</h3><div class="row">${sel(
   "xc",
   chars.filter((c) => c.ownerTeamId).map((c) => [c.id, c.name]),
 )}${sel("xt", [["", "(return to pool)"], ...tOpts])}<input type="number" id="xp" value="0" style="width:90px" aria-label="New price"><button class="btn sm red" data-act="correct">Apply</button></div></div>
 <div class="panel" style="margin-top:14px"><h3>Battles</h3><div class="scroll"><table><tr><th>Teams</th><th>State</th><th>Turn</th><th>Disputes</th><th></th></tr>${o.battles.map((b) => `<tr><td>${esc(b.teams.join(" vs "))}</td><td>${b.state}</td><td>${b.turn}</td><td>${b.disputes}</td><td><a href="#/battle/${b.id}">Inspect</a> · <a href="#/results/${b.id}">Turns</a>${["Finished", "BattleCancelled", "Declined"].includes(b.state) ? `· <a href="#" data-act="dsp" data-id="${b.id}">Disputes</a>` : ` · <a href="#" data-act="bcancel" data-id="${b.id}">Cancel</a>`}</td></tr>`).join("") || '<tr><td colspan=5 class="mut">No battles</td></tr>'}</table></div></div>
 <div class="panel" style="margin-top:14px"><h3>Recent activity</h3><div class="log">${o.events.map((e) => `<p><small>${dt(e.ts)}</small> <b>${e.type}</b> ${esc(JSON.stringify(e.details).slice(0, 120))}</p>`).join("")}</div></div>`,
    };
  },
  { role: "admin", live: true },
);
act("aconf", async () => {
  const ids = $$(".cp:checked").map((x) => x.value);
  await post("/auction/configure", {
    mode: $("#am").value,
    count: +$("#ac").value,
    ids,
    increment: +$("#ai").value,
    timer: +$("#at").value,
    mysteryPct: +$("#ay").value,
  });
  toast("Auction configured");
});
act("aop", async (b) => {
  await post("/auction/" + b.dataset.op);
  toast("Done: " + b.dataset.op);
});
act("aend", async () => {
  if (confirm("End the auction now? Unsold lots are abandoned.")) {
    await post("/auction/end", { confirm: true });
    toast("Auction ended");
  }
});
act("retain", async () => {
  await post("/auction/retain", {
    teamId: $("#rt").value,
    charId: $("#rc").value,
    price: +$("#rp").value,
  });
  toast("Character retained");
  render(true);
});
act("bonus", async (b) => {
  await post(
    "/auction/bonus",
    b.dataset.t
      ? { trailing: true, amount: +$("#bp").value }
      : { teamId: $("#rt").value, amount: +$("#bp").value },
  );
  toast("Bonus granted");
  render(true);
});
act("emerg", async () => {
  const r = await post("/auction/emergency");
  toast(r.added + " emergency lots added");
});
act("healt", async () => {
  await post("/auction/heal", { teamId: $("#hl").value });
  toast("Team healed");
});
act("correct", async () => {
  if (!confirm("Apply this correction? It will be recorded in the audit log."))
    return;
  await post("/auction/correct", {
    charId: $("#xc").value,
    toTeamId: $("#xt").value || null,
    price: +$("#xp").value,
    confirm: true,
  });
  toast("Correction applied");
  render(true);
});
act("bcancel", async (b) => {
  b.preventDefault?.();
  const r = prompt("Reason for cancelling this battle?");
  if (r === null) return;
  await post(`/battles/${b.dataset.id}/cancel`, { confirm: true, reason: r });
  toast("Battle cancelled");
});
act("dsp", async (b) => {
  const v = await api("/battles/" + b.dataset.id);
  modal(
    `<h3>Disputes</h3>${v.disputes.map((d) => `<div class="panel"><p>${esc(d.reason)}</p><small>${dt(d.ts)}</small>${d.resolution ? `<p class="sold">Resolved by ${esc(d.resolution.by)}: ${esc(d.resolution.note)}</p>` : `<input id="dn${d.id}" placeholder="Resolution note" style="width:100%"><button class="btn sm ok" data-act="dres" data-id="${v.id}" data-d="${d.id}">Resolve</button>`}</div>`).join("") || '<p class="mut">No disputes.</p>'}`,
  );
});
act("dres", async (b) => {
  await post(`/battles/${b.dataset.id}/dispute/${b.dataset.d}`, {
    note: $("#dn" + b.dataset.d).value,
  });
  $(".modal")?.remove();
  toast("Dispute resolved");
});
/* characters */
const FIELDS = [
  ["name", "Name", "text"],
  ["short", "Short name", "text"],
  ["image", "Image URL", "text"],
  ["universe", "Universe", "text"],
  ["category", "Category", "text"],
  ["basePrice", "Base price", "number"],
  ["maxHealth", "Max health", "number"],
  ["attack", "Attack", "number"],
  ["defence", "Defence", "number"],
  ["speed", "Speed", "number"],
];
route(
  "/admin/characters",
  async () => {
    const c = await api("/admin/characters/export");
    window._ac = c;
    return {
      html: `<h1 style="font-size:2.4rem">CHARACTER MANAGEMENT</h1>${adminNav("/admin/characters")}<div class="row" style="margin-bottom:10px"><input id="aq" data-keep placeholder="Search…" aria-label="Search" style="flex:1"><button class="btn red" data-act="cnew">+ New character</button><button class="btn" data-act="cexp">Export JSON</button><label class="btn">Import JSON<input type="file" id="cimp" accept=".json" hidden></label></div><div class="panel scroll"><table id="ct"></table></div>`,
      after: () => {
        const d = () => {
          const q = $("#aq").value.toLowerCase();
          $("#ct").innerHTML =
            "<tr><th>Name</th><th>Rarity</th><th>Price</th><th>HP</th><th>ATK</th><th>DEF</th><th>SPD</th><th>Status</th><th></th></tr>" +
            _ac
              .filter((x) => x.name.toLowerCase().includes(q))
              .slice(0, 100)
              .map(
                (x) =>
                  `<tr><td>${esc(x.name)}</td><td>${x.rarity}</td><td>${x.basePrice}</td><td>${x.currentHealth}/${x.maxHealth}</td><td>${x.attack}</td><td>${x.defence}</td><td>${x.speed}</td><td>${x.availability}${x.ownerTeamId ? " · owned" : ""}</td><td><button class="btn sm" data-act="cedit" data-id="${x.id}">Edit</button> <button class="btn sm" data-act="cheal" data-id="${x.id}">Heal</button> <button class="btn sm red" data-act="cdel" data-id="${x.id}">Archive</button></td></tr>`,
              )
              .join("");
        };
        $("#aq").oninput = d;
        d();
        $("#cimp").onchange = async (e) => {
          try {
            const j = JSON.parse(await e.target.files[0].text());
            const r = await post("/characters/import", {
              characters: Array.isArray(j) ? j : j.characters,
            });
            toast("Imported " + r.imported);
            render();
          } catch (err) {
            toast(err.message, true);
          }
        };
      },
    };
  },
  { role: "admin" },
);
const cform = (c) =>
  modal(`<h3>${c.id ? "Edit" : "New"} character</h3><div class="grid g2">${FIELDS.map(([k, l, t]) => `<label>${l}<input id="cf_${k}" type="${t}" value="${esc(c[k] ?? "")}" style="width:100%"></label>`).join("")}<label>Rarity<select id="cf_rarity">${["Common", "Rare", "Epic", "Legendary"].map((r) => `<option ${c.rarity === r ? "selected" : ""}>${r}</option>`).join("")}</select></label><label>Availability<select id="cf_availability">${["available", "unavailable", "reserved", "archived"].map((r) => `<option ${c.availability === r ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
 <label>Abilities (JSON: name, kind attack|buff|heal, power, cost, cd, heal, self/foe effects, ultimate; optional unlockLevel, otherwise unlocks follow the list order)<textarea id="cf_ab" style="min-height:160px;font-family:monospace">${esc(JSON.stringify(c.abilities || [], null, 1))}</textarea></label><button class="btn red" data-act="csave" data-id="${c.id || ""}">Save</button>`);
act("cnew", () =>
  cform({
    rarity: "Common",
    availability: "available",
    universe: "Marvel",
    category: "Custom",
    basePrice: 50,
    maxHealth: 300,
    attack: 60,
    defence: 40,
    speed: 40,
    abilities: [
      {
        name: "Power Strike",
        kind: "attack",
        power: 1.5,
        cost: 20,
        cd: 1,
        desc: "A strong attack",
      },
    ],
  }),
);
act("cedit", (b) => cform(_ac.find((x) => x.id === b.dataset.id)));
act("csave", async (b) => {
  const body = {};
  FIELDS.forEach(
    ([k, , t]) =>
      (body[k] = t === "number" ? +$("#cf_" + k).value : $("#cf_" + k).value),
  );
  body.rarity = $("#cf_rarity").value;
  body.availability = $("#cf_availability").value;
  try {
    body.abilities = JSON.parse($("#cf_ab").value);
  } catch {
    throw new Error("Abilities must be valid JSON");
  }
  await api("/admin/characters" + (b.dataset.id ? "/" + b.dataset.id : ""), {
    method: b.dataset.id ? "PUT" : "POST",
    body,
  });
  $(".modal")?.remove();
  toast("Saved");
  render();
});
act("cdel", async (b) => {
  if (
    confirm(
      "Archive this character? It is removed from play but kept in the data.",
    )
  ) {
    await api("/admin/characters/" + b.dataset.id, {
      method: "DELETE",
      body: { confirm: true },
    });
    toast("Archived");
    render();
  }
});
act("cheal", async (b) => {
  await post("/auction/heal", { charId: b.dataset.id });
  toast("Healed");
});
act("cexp", async () => {
  const j = await api("/admin/characters/export");
  dl("characters.json", { characters: j });
});
const dl = (n, o) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(o, null, 1)], { type: "application/json" }),
  );
  a.download = n;
  a.click();
};
/* teams & players */
route(
  "/admin/teams",
  async () => {
    const [T, o] = await Promise.all([
      api("/admin/teams"),
      api("/admin/overview"),
    ]);
    return {
      html: `<h1 style="font-size:2.4rem">TEAMS &amp; PLAYERS</h1>${adminNav("/admin/teams")}<div class="row" style="margin-bottom:10px"><input id="tn" placeholder="New team name" aria-label="Team name"><input id="tb" type="number" placeholder="Balance (default)" style="width:150px" aria-label="Starting balance"><button class="btn red" data-act="tnew">Create team</button></div>
 <div class="grid g2">${T.map(
   (
     t,
   ) => `<div class="panel team" style="--c:${t.color}"><div class="row sp"><b>${esc(t.name)}</b><span>Balance <b style="color:var(--gold)">${t.balance}</b> · spent ${t.spent} · points <b style="color:var(--gold)">${t.points}</b></span></div><small>Players: ${t.players.map((p) => esc(p.username)).join(", ") || "none"} · ${t.roster.length} heroes · items: ${
     Object.entries(t.inventory || {})
       .filter(([, n]) => n)
       .map(([k, n]) => esc(k) + " ×" + n)
       .join(", ") || "none"
   }</small><div>${t.roster.map((c) => `<span class="tag">${esc(c.short || c.name)} Lv ${c.level} ${c.currentHealth}/${c.maxHealth}</span>`).join("")}</div>
 <div class="row" style="margin-top:6px"><input type="number" id="bal${t.id}" value="${t.balance}" style="width:100px" aria-label="Balance"><button class="btn sm" data-act="tbal" data-id="${t.id}">Set balance</button><input type="number" id="pts${t.id}" value="${t.points}" style="width:90px" aria-label="Points"><button class="btn sm" data-act="tpts" data-id="${t.id}">Set points</button><button class="btn sm" data-act="tren" data-id="${t.id}">Rename</button><button class="btn sm red" data-act="tdel" data-id="${t.id}">Delete</button></div>
 <details><summary>Ledger</summary><div class="log">${
   [...t.ledger]
     .reverse()
     .map(
       (l) =>
         `<p>${dt(l.ts)} ${l.type} <b>${l.amount}</b> → ${l.balanceAfter}</p>`,
     )
     .join("") || "None"
 }</div></details></div>`,
 ).join("")}</div>
 <div class="panel" style="margin-top:14px"><h3>Players</h3><div class="row"><input id="pn" placeholder="Username" aria-label="Username"><input id="pw" type="password" placeholder="Password (8+)" aria-label="Password">${sel("pt", [["", "(no team)"], ...T.map((t) => [t.id, t.name])])}<button class="btn gold" data-act="pnew">Add player</button></div>
 <div class="scroll"><table><tr><th>Player</th><th>Team</th><th></th></tr>${o.players.map((p) => `<tr><td>${esc(p.username)}</td><td>${sel("pa" + p.id, [["", "(none)"], ...T.map((t) => [t.id, t.name])], p.teamId || "")}</td><td><button class="btn sm" data-act="passign" data-id="${p.id}">Assign</button> <button class="btn sm red" data-act="pdel" data-id="${p.id}">Remove</button></td></tr>`).join("")}</table></div></div>`,
    };
  },
  { role: "admin" },
);
act("tnew", async () => {
  await post("/teams", {
    name: $("#tn").value,
    balance: $("#tb").value === "" ? undefined : +$("#tb").value,
  });
  toast("Team created");
  render();
});
act("tbal", async (b) => {
  await api("/admin/teams/" + b.dataset.id, {
    method: "PUT",
    body: { balance: +$("#bal" + b.dataset.id).value },
  });
  toast("Balance updated");
  render();
});
act("tpts", async (b) => {
  await api("/admin/teams/" + b.dataset.id, {
    method: "PUT",
    body: { points: +$("#pts" + b.dataset.id).value },
  });
  toast("Points updated");
  render();
});
act("tren", async (b) => {
  const n = prompt("New team name");
  if (n) {
    await api("/admin/teams/" + b.dataset.id, {
      method: "PUT",
      body: { name: n },
    });
    render();
  }
});
act("tdel", async (b) => {
  if (confirm("Delete this team? Its characters return to the pool.")) {
    await api("/admin/teams/" + b.dataset.id, {
      method: "DELETE",
      body: { confirm: true },
    });
    render();
  }
});
act("pnew", async () => {
  await post("/players", {
    username: $("#pn").value,
    password: $("#pw").value,
    teamId: $("#pt").value || null,
  });
  toast("Player added");
  render();
});
act("passign", async (b) => {
  await api("/admin/players/" + b.dataset.id, {
    method: "PUT",
    body: { teamId: $("#pa" + b.dataset.id).value || null },
  });
  toast("Assigned");
});
act("pdel", async (b) => {
  if (confirm("Remove this player?")) {
    await api("/admin/players/" + b.dataset.id, {
      method: "DELETE",
      body: { confirm: true },
    });
    render();
  }
});
/* tournaments */
route(
  "/admin/tournaments",
  async () => {
    const [T, L, st] = await Promise.all([
      api("/admin/teams"),
      api("/tournaments"),
      api("/state"),
    ]);
    return {
      html: `<h1 style="font-size:2.4rem">TOURNAMENTS</h1>${adminNav("/admin/tournaments")}<div class="panel gold"><h3>New tournament</h3><div class="row"><input id="tnm" data-keep placeholder="Name" aria-label="Tournament name"><label>Heroes per side <input type="number" id="tsq" data-keep min="1" max="${st.settings.rosterLimit}" value="${st.settings.squadSize}" style="width:64px"></label>${sel(
        "tmo",
        [
          ["arena", "Arena"],
          ["campaign", "Campaign"],
        ],
        "arena",
      )}<label>Prize points <input type="number" id="tpz" data-keep value="100" min="0" style="width:90px"></label><label><input type="checkbox" id="trk"> Ranked</label></div>
 <div class="pick" style="margin:8px 0">${T.map((t) => `<label><input type="checkbox" class="tt" value="${t.id}" checked> ${esc(t.name)} <small>(${t.roster.length} heroes, rating ${t.rating})</small></label>`).join("") || '<span class="mut">No teams yet.</span>'}</div>
 <button class="btn red" data-act="tcreate">Create &amp; start</button><p class="mut">Single elimination seeded by rating; byes go to the top seeds. A match starts as soon as both teams are free, and players pick their squads on the battle screen. Draws are replayed; a team that cannot field a full squad loses by walkover.</p></div>
 ${L.map((t) => tourCard(t, t.status === "running" ? `<div class="row"><button class="btn sm" data-act="ttick" data-id="${t.id}">Start waiting matches</button><button class="btn sm red" data-act="tcancel" data-id="${t.id}">Cancel tournament</button></div>` : "")).join("")}`,
    };
  },
  { role: "admin", live: true },
);
act("tcreate", async () => {
  await post("/tournaments", {
    name: $("#tnm").value,
    squadSize: +$("#tsq").value,
    mode: $("#tmo").value,
    prize: +$("#tpz").value,
    ranked: $("#trk").checked,
    teamIds: $$(".tt:checked").map((x) => x.value),
  });
  toast("Tournament started");
  render(true);
});
act("ttick", async (b) => {
  await post(`/tournaments/${b.dataset.id}/tick`);
  toast("Waiting matches checked");
  render(true);
});
act("tcancel", async (b) => {
  if (!confirm("Cancel this tournament? Its running battles are cancelled."))
    return;
  await post(`/tournaments/${b.dataset.id}/cancel`, { confirm: true });
  toast("Tournament cancelled");
  render(true);
});
/* history */
route(
  "/admin/history",
  async () => {
    const [T, C] = await Promise.all([
      api("/admin/teams"),
      api("/admin/characters/export"),
    ]);
    return {
      html: `<h1 style="font-size:2.4rem">GAME HISTORY</h1>${adminNav("/admin/history")}<div class="row" style="margin-bottom:10px">${sel("ht", [["", "All teams"], ...T.map((t) => [t.id, t.name])])}${sel("hc", [["", "All characters"], ...C.map((c) => [c.id, c.name])])}
 ${sel("hy", [
   ["", "All events"],
   ["auction", "Auction"],
   ["bid", "Bids"],
   ["character", "Characters"],
   ["balance", "Balances"],
   ["points", "Points"],
   ["store", "Store"],
   ["battle", "Battles"],
   ["tournament", "Tournaments"],
   ["admin", "Admin actions"],
 ])}<label>From <input type="date" id="hf" data-keep></label><label>To <input type="date" id="hu" data-keep></label><button class="btn red" data-act="hgo">Filter</button><button class="btn" data-act="hexp">Export</button></div><div class="panel scroll" id="hl"></div>`,
      after: () => acts.hgo(),
    };
  },
  { role: "admin" },
);
let HEV = [];
act("hgo", async () => {
  const q = new URLSearchParams({ limit: 500 });
  [
    ["ht", "team"],
    ["hc", "char"],
    ["hy", "type"],
  ].forEach(([i, k]) => $("#" + i).value && q.set(k, $("#" + i).value));
  if ($("#hf").value) q.set("from", $("#hf").value);
  if ($("#hu").value) q.set("to", $("#hu").value + "T23:59:59");
  const r = await api("/admin/history?" + q);
  HEV = r.events;
  $("#hl").innerHTML =
    `<small>${r.total} events</small><table><tr><th>Time</th><th>Type</th><th>Actor</th><th>Details</th></tr>${r.events.map((e) => `<tr><td>${dt(e.ts)}</td><td>${e.type}${e.vis !== "public" ? ` <span class="tag">${e.vis}</span>` : ""}</td><td>${esc(e.actor.name || e.actor.kind)}</td><td><small>${esc(JSON.stringify(e.details).slice(0, 200))}</small></td></tr>`).join("")}</table>`;
});
act("hexp", () => dl("history.json", HEV));
/* settings: generic editor over the whole settings object */
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, p + k + ".") : [[p + k, v]],
  );
const ENUM = {
  "battle.mode": ["arena", "campaign"],
  "battle.timeoutAction": ["defend", "pass", "attack", "dodge"],
};
route(
  "/admin/settings",
  async () => {
    const s = await api("/admin/settings");
    return {
      html: `<h1 style="font-size:2.4rem">GAME SETTINGS</h1>${adminNav("/admin/settings")}<div class="panel"><p class="mut">Changes apply to future actions. Stored in <code>data/settings.json</code>.</p><div class="grid g3">${flat(
        s,
      )
        .filter(
          ([k]) => !["gameId", "auction.mode", "auction.poolSize"].includes(k),
        )
        .map(
          ([k, v]) =>
            `<label>${k}<br>${ENUM[k] ? `<select data-p="${k}">${ENUM[k].map((x) => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("")}</select>` : typeof v === "boolean" ? `<input type="checkbox" data-p="${k}" ${v ? "checked" : ""}>` : `<input data-p="${k}" type="number" step="any" value="${v}" style="width:100%">`}</label>`,
        )
        .join(
          "",
        )}</div><button class="btn red" data-act="ssave" style="margin-top:12px">Save settings</button></div>`,
    };
  },
  { role: "admin" },
);
act("ssave", async () => {
  const o = {};
  $$("[data-p]").forEach((e) => {
    const ks = e.dataset.p.split(".");
    let t = o;
    ks.slice(0, -1).forEach((k) => (t = t[k] = t[k] || {}));
    t[ks.at(-1)] =
      e.type === "checkbox"
        ? e.checked
        : e.tagName === "SELECT"
          ? e.value
          : +e.value;
  });
  await api("/admin/settings", { method: "PUT", body: o });
  toast("Settings saved");
});
/* backup */
route(
  "/admin/backup",
  async () => `<h1 style="font-size:2.4rem">BACKUP &amp; RESTORE</h1>${adminNav("/admin/backup")}<div class="grid g2"><div class="panel gold"><h3>Export</h3><p class="mut">Downloads characters, teams, players (password hashes), auction, battles, history and settings. Admin credentials and login sessions are not included.</p><button class="btn red" data-act="bexp">Download backup</button></div>
 <div class="panel"><h3>Import</h3><p class="mut">Validated before use. Replaces the current game and logs players out.</p><input type="file" id="bf" accept=".json"><button class="btn gold" data-act="bimp">Restore backup</button></div>
 <div class="panel"><h3>Change admin password</h3><div class="grid"><input id="pc" type="password" placeholder="Current password" aria-label="Current password"><input id="pn2" type="password" placeholder="New password (10+)" aria-label="New password"><button class="btn" data-act="ppw">Change</button></div></div>
 <div class="panel" style="border-left-color:#a31218"><h3>Reset game</h3><p class="mut">Clears teams, rosters, auction and battles and restores all characters. History and accounts are kept.</p><input id="rs" placeholder="Type RESET to confirm" aria-label="Type RESET"><button class="btn red" data-act="reset">Reset game</button></div></div>`,
  { role: "admin" },
);
act("bexp", async () =>
  dl(
    "marvel-arena-backup-" + new Date().toISOString().slice(0, 10) + ".json",
    await api("/admin/backup"),
  ),
);
act("bimp", async () => {
  const f = $("#bf").files[0];
  if (!f) throw new Error("Choose a backup file");
  let j;
  try {
    j = JSON.parse(await f.text());
  } catch {
    throw new Error("That file is not valid JSON");
  }
  if (!confirm("Replace the current game with this backup?")) return;
  await post("/restore", { confirm: true, files: j.files });
  toast("Backup restored");
});
act("ppw", async () => {
  await post("/password", { current: $("#pc").value, next: $("#pn2").value });
  toast("Password changed");
});
act("reset", async () => {
  if ($("#rs").value !== "RESET") throw new Error("Type RESET to confirm");
  if (confirm("This clears the whole game. Continue?")) {
    await post("/reset", { confirm: "RESET" });
    toast("Game reset");
  }
});
