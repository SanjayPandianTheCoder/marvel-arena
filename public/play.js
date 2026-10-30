/* Player pages: auction room, team dashboard, battle lobby, battle arena, results, match history */
route(
  "/auction",
  async () => {
    const a = await api("/auction"),
      c = a.current,
      me = a.me,
      pl = SESS?.role === "player";
    const lead = c?.leader ? `<b>${esc(c.leader.name)}</b>` : "nobody yet";
    const ctl = !c
      ? ""
      : !pl
        ? '<p class="mut">Log in as a player to bid. You are spectating.</p>'
        : a.status !== "live"
          ? '<p class="mut">Bidding is closed while the auction is paused.</p>'
          : `<p class="mut">Your balance: <b style="color:var(--gold)">${me.balance}</b>${me.blocked ? ` · <span class="bad">${esc(me.blocked)}</span>` : ""}</p><div class="row"><button class="btn red" data-act="bid" data-amt="${c.next}" ${me.canBid ? "" : "disabled"}>Bid ${c.next}</button><input type="number" id="amt" data-keep min="${c.next}" step="${a.increment}" aria-label="Custom bid" placeholder="Custom"><button class="btn" data-act="bid" data-custom="1" ${me.canBid ? "" : "disabled"}>Set bid</button></div>
  <div class="row" style="margin-top:8px"><button class="btn gold" data-act="pass" ${me.leading || me.passed ? "disabled" : ""}>${me.passed ? "You passed" : "Pass this hero"}</button><small class="mut">${me.leading ? "You lead – you cannot pass." : me.passed ? "You are out of this lot." : "Passing is final for this lot. It sells when all others pass."}</small></div>`;
    return {
      html: `<div class="row sp"><h1 style="font-size:2.6rem">AUCTION ROOM</h1><span class="state">${a.status.toUpperCase()}</span></div>${a.status === "idle" || a.status === "ready" ? '<div class="panel"><p>The auction has not started. Waiting for the admin.</p></div>' : ""}
 ${
   c
     ? `<div class="split"><div>${cCard(c.char)}${!c.mystery ? `<div class="panel" style="margin-top:10px"><b>Abilities</b> ${c.char.abilities.map((x) => `<span class="tag">${esc(x.name)}</span>`).join("")}</div>` : ""}</div>
 <div class="panel gold"><div class="row sp"><span>Lot ${a.lot} of ${a.total}</span><b style="font-size:1.6rem">⏱ <span data-deadline="${c.deadline || ""}" data-none="${a.status === "paused" ? "paused" : "–"}"></span></b></div>
 <div class="big" aria-live="polite">${c.leader ? c.bid : "—"}</div><div>Leading: ${lead}${c.mystery ? ' · <span class="tag">mystery lot</span>' : ""}</div>${ctl}
 <h3 style="margin-top:10px">Bids</h3><div class="log">${c.bids.map((b) => `<p>${esc(b.teamName)} bid <b>${b.amount}</b></p>`).join("") || '<p class="mut">No bids yet</p>'}</div>${c.passed.length ? `<small class="mut">${c.passed.length} team(s) passed</small>` : ""}</div></div>`
     : a.status === "live"
       ? '<div class="panel">Next lot opening…</div>'
       : a.status === "ended"
         ? '<div class="panel gold"><h2>Auction complete</h2><a class="btn red" href="#/team">See your team</a></div>'
         : ""
 }
 ${a.lastResult ? `<div class="panel" style="margin-top:12px">Last lot: <b>${esc(a.lastResult.name)}</b> ${a.lastResult.type === "sold" ? `sold to <b>${esc(a.lastResult.team)}</b> for ${a.lastResult.price}` : "went unsold"}</div>` : ""}
 <div class="panel" style="margin-top:12px"><h3>Completed purchases (public)</h3><div class="scroll"><table><tr><th>Hero</th><th>Team</th><th>Price</th></tr>${a.sold.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.team)}</td><td>${s.price}</td></tr>`).join("") || '<tr><td colspan=3 class="mut">None yet</td></tr>'}</table></div><small class="mut">${a.upcoming} lots remaining · ${a.unsold} unsold</small></div>`,
    };
  },
  { live: true },
);
act("bid", async (b) => {
  const amt = b.dataset.custom ? +$("#amt").value : +b.dataset.amt;
  if (!amt) throw new Error("Enter an amount");
  await api("/auction/bid", { method: "POST", body: { amount: amt } });
  if ($("#amt")) $("#amt").value = "";
});
act("pass", async () => {
  await api("/auction/pass", { method: "POST" });
});
route(
  "/team",
  async () => {
    const { team: t } = await api("/me");
    return {
      html: `<div class="row sp"><h1 style="font-size:2.6rem">${esc(t.name)}</h1><span class="rating">Rating ${t.rating}</span></div>${t.giftReady ? '<div class="panel gold row sp" style="margin-bottom:12px"><b>🎁 Your daily gift is ready</b><a class="btn sm red" href="#/store">Claim it in the store</a></div>' : ""}
 <div class="grid g3"><div class="panel gold"><small>Private balance (only you and the admin can see this)</small><div class="big">${t.balance}</div></div><div class="panel gold"><small>Points (private) · ${t.pointsEarned} earned in total</small><div class="big">${t.points}</div><a class="btn sm red" href="#/store">Open store</a></div><div class="panel"><small>Total spent</small><div class="big" style="color:var(--tx)">${t.spent}</div></div><div class="panel"><small>Record</small><div class="big" style="color:var(--tx)">${t.wins}-${t.losses}-${t.draws}</div><small>streak ${t.streak}</small></div></div>
 <h2 style="margin-top:16px">Roster (${t.roster.length})</h2><div class="grid g3">${t.roster.map((c) => cCard(c)).join("") || '<p class="mut">No characters yet. Win some in the auction.</p>'}</div>
 <div class="grid g3" style="margin-top:12px">${t.roster.map((c) => `<div class="panel"><b>${esc(c.short || c.name)}</b> <span class="tag">Lv ${c.level}</span> ${c.isEliminated ? '<span class="tag bad">eliminated</span>' : ""}${c.restUntil ? `<span class="tag bad" title="Campaign rest">resting until ${new Date(c.restUntil).toLocaleTimeString()}</span>` : ""}<small> persistent condition</small>${hp(c.currentHealth, c.maxHealth)}<div class="hpbar enbar" style="margin-top:4px"><i style="width:${(c.energy / c.maxEnergy) * 100}%"></i><span>Energy ${c.energy}</span></div>${status(Object.fromEntries((c.statusEffects || []).map((s) => [s.status, s])))}</div>`).join("")}</div>
 <div class="panel" style="margin-top:16px"><h3>Spending history</h3><div class="scroll"><table><tr><th>When</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Note</th></tr>${
   [...t.ledger]
     .reverse()
     .map(
       (l) =>
         `<tr><td>${dt(l.ts)}</td><td>${l.type}</td><td class="${l.amount < 0 ? "bad" : "sold"}">${l.amount}</td><td>${l.balanceAfter}</td><td>${esc(l.charName || l.note || "")}</td></tr>`,
     )
     .join("") || '<tr><td colspan=5 class="mut">No transactions</td></tr>'
 }</table></div></div>`,
    };
  },
  { role: "player", live: true },
);
/* ---------------- store: kits, hero levels, points → cash ---------------- */
route(
  "/store",
  async () => {
    const s = await api("/store"),
      m = s.me,
      ex = s.exchange,
      rw = s.rewards,
      owned = s.items.filter((i) => i.owned),
      ic = (i) => (i.kind === "hp" ? "➕" : "⚡"),
      g = s.gift,
      itemName = (id) => s.items.find((i) => i.id === id)?.name;
    return {
      html: `<div class="row sp"><h1 style="font-size:2.6rem">STORE &amp; UPGRADES</h1><span class="rating">${m.points} points</span></div>
 <div class="panel gold" style="margin-bottom:12px"><div class="row sp"><h3>🎁 Daily gift</h3>${g.available ? `<button class="btn red" data-act="gift">Claim day ${g.day} gift</button>` : '<span class="tag sold">Claimed today · come back tomorrow</span>'}</div><p class="mut" style="margin:4px 0">A free gift every day. Claim on consecutive days to build a 7-day streak with bigger gifts; missing a day starts again at day 1.</p>
 <div class="gifts">${g.calendar.map((r) => `<div class="gift ${r.day < g.day || (r.day === g.day && !g.available) ? "got" : r.day === g.day ? "now" : ""}"><small>Day ${r.day}</small><b>${r.points} pts</b>${r.item ? `<small>+ ${esc(itemName(r.item))}</small>` : ""}</div>`).join("")}</div></div>
 <div class="grid g3"><div class="panel gold"><small>Points (private, shared by your team)</small><div class="big">${m.points}</div><small>${m.pointsEarned} earned in total${rw.dailyCap ? ` · ${m.earnedToday}/${rw.dailyCap} today` : ""}</small></div><div class="panel"><small>Cash balance (private)</small><div class="big" style="color:var(--tx)">${m.balance}</div></div>
 <div class="panel"><small>How to earn points</small><p style="margin:4px 0">${rw.killBase} per enemy hero defeated × rarity: ${Object.entries(
   rw.rarityMult,
 )
   .map(([r, x]) => `<b style="color:${RAR[r]}">${r} ×${x}</b>`)
   .join(
     " · ",
   )}</p><small>+${rw.winBonus} win · +${rw.drawBonus} draw · +${rw.flawlessBonus} flawless win (battles of ${rw.minTurnsForBonus}+ turns), +${Math.round(rw.squadBonus * 100)}% per extra hero per side · +${Math.round(rw.levelBonus * 100)}% per level of the defeated hero · repeat battles against the same team earn less</small></div></div>
 <div class="panel" style="margin-top:12px"><h3>Hero progression</h3><p class="mut" style="margin:4px 0">${s.level.xpPerLevel ? `Heroes earn XP in battle (${s.level.xp.battle} per battle of ${rw.minTurnsForBonus}+ turns, ${s.level.xp.kill} per enemy defeated, ${s.level.xp.win} per win) and level up for free at ${s.level.xpPerLevel} × their level. You can also buy levels with points. ` : ""}Abilities unlock at levels 1, ${1 + s.level.unlockEvery}, ${1 + 2 * s.level.unlockEvery}… in order, and ultimates at level ${s.level.ultimateLevel}. Ultimates also need a full charge, which builds up in battle. Every ${s.level.rankEvery} levels after it unlocks, an ability ranks up (+${Math.round(s.level.rankBonus * 100)}% power; rank III also has 1 turn less cooldown). Perks: ${s.perks.map((p) => `<b>Lv ${p.level} ${esc(p.name)}</b> (${esc(p.desc)})`).join(" · ")}.</p></div>
 <h2 style="margin-top:16px">Med &amp; energy kits</h2><p class="mut">Use a kit in battle (it takes your turn, max ${s.maxItemsPerBattle} per battle) or on a hero below. Between battles this matters in campaign mode, where health persists.</p>
 <div class="grid g3">${s.items.map((i) => `<div class="panel ${i.kind === "hp" ? "" : "gold"}"><div class="row sp"><b>${ic(i)} ${esc(i.name)}</b><span class="tag">owned ${i.owned}</span></div><p class="mut" style="margin:4px 0">Restores ${Math.round(i.pct * 100)}% ${i.kind === "hp" ? "health" : "energy"}</p><div class="row sp"><b style="color:var(--gold)">${i.price} pts</b><button class="btn sm red" data-act="buy" data-item="${i.id}" ${m.points < i.price ? "disabled" : ""}>Buy</button></div></div>`).join("")}</div>
 <h2 style="margin-top:16px">Your heroes</h2><div class="grid g3">${
   m.heroes
     .map(
       (
         c,
       ) => `<div class="panel" style="border-left-color:${RAR[c.rarity]}"><div class="row sp"><b>${esc(c.short || c.name)}</b><span><span class="tag">Lv ${c.level}</span> <span class="rar" style="color:${RAR[c.rarity]}">${c.rarity}</span></span></div>
  ${hp(c.currentHealth, c.maxHealth)}<div class="hpbar enbar" style="margin-top:4px"><i style="width:${(c.energy / c.maxEnergy) * 100}%"></i><span>Energy ${c.energy}</span></div>${!c.maxed && c.xpNext ? `<div class="hpbar xpbar" style="margin-top:4px" title="XP ${c.xp} / ${c.xpNext}"><i style="width:${(c.xp / c.xpNext) * 100}%"></i></div><small class="mut">XP ${c.xp} / ${c.xpNext}</small><br>` : ""}<small>ATK ${c.attack} · DEF ${c.defence} · HP ${c.maxHealth}${c.isEliminated ? ' · <span class="bad">eliminated</span>' : ""}${c.busy ? ' · <span class="bad">in battle</span>' : ""}${c.restUntil ? ` · <span class="bad" title="Campaign rest">resting until ${new Date(c.restUntil).toLocaleTimeString()}</span>` : ""}</small>
  <div style="margin-top:4px">${abilityTags(c)}${c.perks.map((p) => `<span class="tag perk" title="${esc(p.desc)}">★ ${esc(p.name)}</span>`).join("")}</div>${c.nextUnlock ? `<small class="mut">Next: <b>${esc(c.nextUnlock.name)}</b> at Lv ${c.nextUnlock.unlockLevel}</small>` : ""}
  <div class="row" style="margin-top:6px">${c.maxed ? '<span class="tag sold">max level</span>' : `<button class="btn sm gold" data-act="lvl" data-id="${c.id}" ${c.busy || m.points < c.levelCost ? "disabled" : ""}>Level up · ${c.levelCost} pts</button>`}${owned.map((i) => `<button class="btn sm" data-act="use" data-item="${i.id}" data-id="${c.id}" ${c.busy ? "disabled" : ""} title="Use ${esc(i.name)} on this hero">${ic(i)} ${esc(i.name.replace(" Kit", ""))} ×${i.owned}</button>`).join("")}</div></div>`,
     )
     .join("") || '<p class="mut">No heroes yet. Win some in the auction.</p>'
 }</div>
 <div class="split" style="margin-top:16px"><div class="panel gold"><h3>Exchange points for cash</h3>${ex.blocked ? `<p class="bad">${esc(ex.blocked)}</p>` : ""}<p class="mut">1 point = ${ex.rate} cash, no daily limit. Cash goes into your private auction balance.</p><div class="row"><input type="number" id="xpts" data-keep min="1" max="${m.points}" aria-label="Points to exchange" placeholder="Points"><button class="btn red" data-act="xchg" ${ex.blocked ? "disabled" : ""}>Exchange</button><button class="btn" data-act="xchg" data-all="${m.points}" ${ex.blocked || !m.points ? "disabled" : ""}>Exchange all (${m.points})</button></div></div>
 <div class="panel"><h3>Points history</h3><div class="log" style="max-height:220px">${
   [...m.pointsLedger]
     .reverse()
     .map(
       (l) =>
         `<p><small>${dt(l.ts)}</small> ${esc(l.type)} <b class="${l.amount < 0 ? "bad" : "sold"}">${l.amount > 0 ? "+" : ""}${l.amount}</b> → ${l.pointsAfter} <small>${esc(l.note || "")}</small></p>`,
     )
     .join("") ||
   '<p class="mut">No points yet. Defeat enemy heroes in battle to earn some.</p>'
 }</div></div></div>`,
    };
  },
  { role: "player", live: true },
);
act("buy", async (b) => {
  const r = await api("/store/buy", {
    method: "POST",
    body: { item: b.dataset.item },
  });
  toast(`Bought · ${r.points} points left`);
  render(true);
});
act("use", async (b) => {
  const r = await api("/store/use", {
    method: "POST",
    body: { item: b.dataset.item, charId: b.dataset.id },
  });
  toast(`Restored ${r.gain}`);
  render(true);
});
act("lvl", async (b) => {
  const r = await api("/store/level-up", {
    method: "POST",
    body: { charId: b.dataset.id },
  });
  toast(
    `Level ${r.level}! (${r.cost} points)${r.unlocked?.length ? " · Unlocked: " + r.unlocked.join(", ") : ""}`,
  );
  render(true);
});
act("gift", async () => {
  const r = await api("/store/gift", { method: "POST" });
  toast(
    `🎁 Day ${r.day}: +${r.points} points${r.itemName ? " + " + r.itemName : ""}`,
  );
  render(true);
});
act("xchg", async (b) => {
  const p = +(b.dataset.all || $("#xpts").value);
  if (!p) throw new Error("Enter how many points to exchange");
  const r = await api("/store/exchange", {
    method: "POST",
    body: { points: p },
  });
  $("#xpts").value = "";
  toast(`+${r.cash} cash · balance ${r.balance}`);
  render(true);
});
// "3v3 · draft · practice · Spring Cup" for lists and headers
const fmt = (x) =>
  [
    x.squadSize ? `${x.squadSize}v${x.squadSize}` : "",
    x.bans ? "draft" : "",
    x.practice ? "practice" : "",
    x.tournament ? "🏆 " + esc(x.tournament.name || x.tournament) : "",
  ]
    .filter(Boolean)
    .join(" · ");
const nameOf = (x, id) => x.teams.find((t) => t.id === id)?.name;
route(
  "/battles",
  async () => {
    const pl = SESS?.role === "player",
      [b, t, s, sg] = await Promise.all([
        api("/battles"),
        api("/teams"),
        api("/state"),
        pl ? api("/battles/suggest") : [],
      ]),
      mine = s.session?.teamId,
      done = ["Finished", "BattleCancelled", "Declined"],
      max = s.settings.rosterLimit,
      size = s.settings.squadSize;
    const open = b.filter((x) => !done.includes(x.state));
    const inv = open.filter((x) => x.incoming),
      out = open.filter(
        (x) => x.state === "WaitingForPlayers" && x.mine && !x.incoming,
      ),
      run = open.filter((x) => x.state !== "WaitingForPlayers"),
      sizeIn = (id, v = size) =>
        `<label>Heroes per side <input type="number" id="${id}" data-keep min="1" max="${max}" value="${v}" style="width:64px"></label>`;
    return {
      html: `<h1 style="font-size:2.6rem">BATTLE LOBBY</h1>${
        pl
          ? `<div class="split"><div class="panel gold"><h3>Challenge a team</h3><div class="row"><select id="op" data-keep aria-label="Opponent">${t
              .filter((x) => x.id !== mine)
              .map(
                (x) =>
                  `<option value="${x.id}">${esc(x.name)} (${x.roster.length} heroes, ${x.rating})</option>`,
              )
              .join("")}</select>
 <select id="bm" data-keep aria-label="Mode"><option value="arena">Arena (full recovery after)</option><option value="campaign">Campaign (health persists)</option></select></div>
 <div class="row" style="margin-top:8px">${sizeIn("sq")}<label title="Before picking squads, each side bans one enemy hero"><input type="checkbox" id="dr"> Draft (each side bans 1)</label><label><input type="checkbox" id="rk" checked> Ranked</label><button class="btn red" data-act="challenge">Send challenge</button></div>
 <small class="mut">Both teams fight with exactly this many heroes, picked in secret after the challenge is accepted. Bigger squads earn a bigger win bonus.</small></div>
 <div class="panel"><h3>Practice vs bot</h3><p class="mut" style="margin:4px 0">An instant battle against a bot squad priced like your roster. Nothing is at stake: no rating, points, XP or health changes.</p><div class="row">${sizeIn("pq")}<button class="btn" data-act="practice">Start practice</button></div></div></div>
 ${sg.length ? `<div class="panel" style="margin-top:10px"><h3>Suggested opponents</h3><div class="row">${sg.map((x) => `<button class="btn sm" data-act="sugg" data-id="${x.id}" ${x.busy || !x.heroes ? "disabled" : ""} title="Rating ${x.rating} (${x.diff >= 0 ? "+" : ""}${x.diff})">${esc(x.name)} · ${x.winChance}% win chance${x.busy ? " · in battle" : ""}</button>`).join("")}</div></div>` : ""}`
          : '<div class="panel mut">Log in as a player to challenge teams. You can spectate any battle below.</div>'
      }
 ${inv.length ? `<h2 style="margin-top:14px">Invitations for you</h2>${inv.map((x) => `<div class="panel row sp"><span><b>${esc(nameOf(x, x.invite.from))}</b> ${x.invite.counter ? "proposes" : "challenges you to"} <b>${fmt(x)}</b> · ${x.mode}${x.ranked ? " · ranked" : ""}</span><span class="row"><button class="btn ok sm" data-act="resp" data-id="${x.id}" data-a="1">Accept</button> <button class="btn sm" data-act="resp" data-id="${x.id}" data-a="0">Decline</button> ${sizeIn("cs" + x.id, x.squadSize)}<button class="btn sm gold" data-act="counter" data-id="${x.id}">Counter-offer</button></span></div>`).join("")}` : ""}
 ${out.length ? `<h2 style="margin-top:14px">Waiting for reply</h2>${out.map((x) => `<div class="panel">${x.invite.counter ? "Counter-offer" : "Challenge"} (${fmt(x)}) sent to <b>${esc(nameOf(x, x.invite.to))}</b> <a href="#/battle/${x.id}">open</a></div>`).join("")}` : ""}
 <h2 style="margin-top:14px">Live battles</h2>${run.map((x) => `<div class="panel row sp"><span>${esc(x.teams.map((y) => y.name).join(" vs "))} · ${fmt(x)} · <span class="state">${x.state}</span> · turn ${x.turn}</span><a class="btn sm ${x.mine ? "red" : ""}" href="#/battle/${x.id}">${x.mine ? "Resume" : "Spectate"}</a></div>`).join("") || '<p class="mut">No battles in progress.</p>'}`,
    };
  },
  { live: true },
);
act("challenge", async () => {
  const r = await api("/battles", {
    method: "POST",
    body: {
      opponentTeamId: $("#op").value,
      mode: $("#bm").value,
      ranked: $("#rk").checked,
      squadSize: +$("#sq").value,
      bans: $("#dr").checked,
    },
  });
  location.hash = "#/battle/" + r.id;
});
act("practice", async () => {
  const r = await api("/battles/practice", {
    method: "POST",
    body: { squadSize: +$("#pq").value },
  });
  location.hash = "#/battle/" + r.id;
});
act("sugg", (b) => {
  $("#op").value = b.dataset.id;
  $("#op").focus();
});
act("resp", async (b) => {
  await api(`/battles/${b.dataset.id}/respond`, {
    method: "POST",
    body: { accept: b.dataset.a === "1" },
  });
  if (b.dataset.a === "1") location.hash = "#/battle/" + b.dataset.id;
  else render();
});
act("counter", async (b) => {
  await api(`/battles/${b.dataset.id}/counter`, {
    method: "POST",
    body: { squadSize: +$("#cs" + b.dataset.id).value },
  });
  toast("Counter-offer sent");
  render(true);
});
act("rematch", async (b) => {
  const r = await api(`/battles/${b.dataset.id}/rematch`, { method: "POST" });
  location.hash = "#/battle/" + r.id;
});
/* ---------------- battle arena ---------------- */
let SELKEY = null,
  SELTURN = null,
  SQUAD = [],
  lastSeen = {};
const shortN = (n) => String(n).replace(/\s*\(.*\)/, "");
const charge = (v) =>
  v == null
    ? ""
    : `<div class="hpbar chbar" style="margin-top:4px" title="Ultimate charge: ultimates need 100%"><i style="width:${v}%"></i><span>Ultimate ${v}%</span></div>`;
const fighter = (s, you) => {
  const a = s.chars.find((c) => c.active);
  return `<div class="panel fighter ${you ? "you" : ""}" id="f${esc(s.teamId)}"><div class="row sp"><b>${esc(s.name)}${you ? " (you)" : ""}</b>${s.ready != null ? `<span class="tag ${s.ready ? "sold" : ""}">${s.ready ? "READY" : "thinking…"}</span>` : ""}</div>
 ${a ? `${mono(a.name)}<h3>${esc(a.name)} <span class="tag">Lv ${a.level || 1}</span></h3>${hp(a.hp, a.max)}<div class="hpbar enbar" style="margin-top:4px"><i style="width:${(a.energy / a.maxEnergy) * 100}%"></i><span>Energy ${a.energy}</span></div>${charge(a.charge)}<div>${status(a.status)}${(a.perks || []).map((p) => `<span class="tag perk">★ ${esc(p)}</span>`).join("")}</div>` : '<div class="mut" style="padding:20px">No active character</div>'}
 <div style="margin-top:8px">${s.chars.map((c) => `<span class="chip ${c.eliminated ? "dead" : ""} ${c.active ? "act" : ""}" title="${c.hp}/${c.max}">${esc(shortN(c.name))} <small>${Math.max(0, Math.round((c.hp / c.max) * 100))}%</small></span>`).join("")}</div></div>`;
};
// hero card button for the ban and squad screens; `ord` is the pick order badge
const heroBtn = (c, a, sel, ord = "", n = "") =>
  `<button class="act ${sel ? "sel" : ""}" data-act="${a}" data-id="${c.id}" data-n="${n}"><span class="ord">${ord}</span><b>${esc(shortN(c.name))}</b><small>Lv ${c.level} · <span style="color:${RAR[c.rarity]}">${c.rarity}</span></small><small>HP ${Math.round(c.hp)}/${c.max} · ATK ${c.attack} · DEF ${c.defence} · SPD ${c.speed}</small></button>`;
const ROMAN = ["", "I", "II", "III"];
// XP and level-ups of one team's heroes after a battle
const xpList = (v, tid) => {
  const x = (v.sides.find((s) => s.teamId === tid)?.chars || [])
    .map((c) => v.xpGained?.[c.id])
    .filter(Boolean);
  return x.length
    ? `<p style="margin:6px 0"><small>${x.map((g) => `${esc(shortN(g.name))} +${g.xp} XP${g.to > g.from ? ` · <b style="color:var(--gold)">Level ${g.to}!</b>` : ""}${g.unlocked.length ? ` · unlocked ${esc(g.unlocked.join(", "))}` : ""}`).join("<br>")}</small></p>`
    : "";
};
const evText = (e) =>
  `<p>${e.k === "damage" || e.k === "counter" ? `<span class="dmg">-${e.amount}</span> ` : e.k === "heal" ? `<span class="sold">+${e.amount}</span> ` : e.k === "item" && e.amount ? `<span style="color:#5dade2">+${e.amount}⚡</span> ` : ""}${esc(e.text)}${e.points ? ` <span class="tag" style="color:var(--gold)">+${e.points} pts</span>` : ""}</p>`;
const earned = (v, id) =>
  v.rewards?.[id] ? (v.rewards[id].paid ?? v.rewards[id].total) : null;
route(
  "/battle/:id",
  async (id) => {
    const v = await api("/battles/" + id),
      me = v.me,
      mi = me ? v.sides.findIndex((s) => s.teamId === me.teamId) : 0,
      sY = v.sides[mi],
      sO = v.sides[1 - mi],
      st = v.state,
      last = v.turns[v.turns.length - 1];
    if (SELTURN !== v.id + v.turn + st) {
      SELKEY = null;
      SQUAD = [];
      SELTURN = v.id + v.turn + st;
    }
    const myT = me ? me.teamId : sY.teamId,
      dY = v.draft?.find((d) => d.teamId === myT),
      dO = v.draft?.find((d) => d.teamId !== myT),
      n = v.squadSize;
    let mid = `<div class="panel"><div class="state">${esc(v.derived.replace(/([A-Z])/g, " $1").trim())}</div>`;
    if (st === "WaitingForPlayers")
      mid +=
        me && v.invite.to === me.teamId
          ? `<p>${esc(nameOf(v, v.invite.from))} ${v.invite.counter ? "proposes" : "challenged you to"} a <b>${fmt(v)}</b> battle (${v.mode}).</p><div class="row"><button class="btn ok" data-act="resp" data-id="${v.id}" data-a="1">Accept</button> <button class="btn" data-act="resp" data-id="${v.id}" data-a="0">Decline</button><label>Heroes per side <input type="number" id="cs${v.id}" data-keep min="1" value="${n || 1}" style="width:64px"></label><button class="btn sm gold" data-act="counter" data-id="${v.id}">Counter-offer</button></div>`
          : `<p class="mut">Waiting for ${esc(nameOf(v, v.invite.to))} to accept a ${fmt(v)} battle…</p>`;
    else if (st === "Declined" || st === "BattleCancelled")
      mid += `<p class="mut">${st === "Declined" ? "The challenge was declined." : "Battle cancelled: " + esc(v.reason || "")}</p>`;
    else if (st === "Finished")
      mid += `<h2>${v.winner ? esc(nameOf(v, v.winner)) + " wins!" : "Draw"}</h2><p class="mut">${esc(v.reason || "")}</p>${me && earned(v, me.teamId) != null ? `<p>You earned <b style="color:var(--gold)">${earned(v, me.teamId)} points</b> · <a href="#/store">Store</a></p>` : ""}${me ? xpList(v, me.teamId) : ""}<div class="row"><a class="btn red" href="#/results/${v.id}">View results</a><a class="btn" href="#/replay/${v.id}">Replay</a>${me && !v.tournament ? `<button class="btn gold" data-act="rematch" data-id="${v.id}">Rematch</button>` : ""}</div>`;
    else {
      mid += `<div class="row sp"><span>Turn <b>${v.turn || "–"}</b> · ${v.mode}${v.ranked ? " · ranked" : ""}${fmt(v) ? " · " + fmt(v) : ""}</span><b>⏱ <span data-deadline="${v.deadline || ""}"></span></b></div>`;
      const bans = v.draft?.some((d) => d.banned)
        ? `<p class="mut">Bans: ${v.draft.map((d) => `${esc(nameOf(v, d.teamId))} banned <b>${esc(shortN(d.banned.name))}</b>`).join(" · ")}</p>`
        : "";
      if (st === "BanSelection")
        mid += !me
          ? '<p class="mut">Both teams are banning one enemy hero…</p>'
          : me.ban
            ? '<p class="mut">Ban locked. Waiting for your opponent…</p>'
            : `<p>Ban one enemy hero. It cannot play in this battle (hidden until both lock in):</p><div class="actions">${dO.pool.map((c) => heroBtn(c, "pickc", SELKEY === c.id)).join("")}</div><button class="btn red" style="margin-top:8px" data-act="lockc" data-kind="ban" data-id="${v.id}" ${SELKEY ? "" : "disabled"}>Lock ban</button>`;
      else if (st === "SquadSelection")
        mid +=
          bans +
          (!me
            ? `<p class="mut">Both teams are picking ${n} heroes in secret…</p>`
            : me.squad
              ? `<p>🔒 Squad locked: <b>${me.squad.map((id) => esc(shortN(dY.pool.find((c) => c.id === id)?.name || "?"))).join(", ")}</b></p><p class="mut">Waiting for your opponent…</p>`
              : `<p>Pick exactly <b>${n}</b> hero${n === 1 ? "" : "es"}. Your first pick starts the fight; the order is hidden until both lock in.</p><div class="actions">${dY.pool.map((c) => heroBtn(c, "pickq", SQUAD.includes(c.id), SQUAD.indexOf(c.id) + 1 || "", n)).join("")}</div><button class="btn red" style="margin-top:8px" data-act="lockq" data-id="${v.id}" ${SQUAD.length === n ? "" : "disabled"}>Lock squad (${SQUAD.length}/${n})</button>`);
      else if (me && st === "CharacterSelection")
        mid += me.pending
          ? '<p class="mut">Selection locked. Waiting for your opponent…</p>'
          : `<p>Choose your first fighter (hidden until both lock in):</p><div class="actions">${sY.chars
              .filter((c) => !c.eliminated)
              .map(
                (c, i) =>
                  `<button class="act ${SELKEY === c.id ? "sel" : ""}" data-act="pickc" data-id="${c.id}"><b>${esc(c.name.replace(/\s*\(.*\)/, ""))}</b><small>HP ${Math.round(c.hp)}/${c.max}</small></button>`,
              )
              .join(
                "",
              )}</div><button class="btn red" style="margin-top:8px" data-act="lockc" data-id="${v.id}" ${SELKEY ? "" : "disabled"}>Lock selection</button>`;
      else if (me && st === "CharacterReplacement")
        mid += me.needsReplacement
          ? `<p>Your fighter fell. Choose a replacement:</p><div class="actions">${sY.chars
              .filter((c) => !c.eliminated)
              .map(
                (c) =>
                  `<button class="act ${SELKEY === c.id ? "sel" : ""}" data-act="pickc" data-id="${c.id}"><b>${esc(c.name.replace(/\s*\(.*\)/, ""))}</b><small>HP ${Math.round(c.hp)}/${c.max}</small></button>`,
              )
              .join(
                "",
              )}</div><button class="btn red" style="margin-top:8px" data-act="lockc" data-id="${v.id}" ${SELKEY ? "" : "disabled"}>Send in fighter</button>`
          : '<p class="mut">Opponent is choosing a replacement…</p>';
      else if (me && st === "ActionSelection")
        mid += me.locked
          ? `<p>🔒 Locked: <b>${esc(me.locked)}</b></p><p class="mut">Waiting for your opponent… (their choice stays hidden until both are locked)</p>`
          : `<div class="actions" role="group" aria-label="Actions">${me.options.map((o, i) => `<button class="act ${SELKEY === o.key ? "sel" : ""}" data-act="picka" data-key="${esc(o.key)}" ${o.reason ? "disabled" : ""} title="${esc(o.reason || o.desc || "")}"><b>${i < 9 ? i + 1 + ". " : ""}${esc(o.label)}</b><small>${o.kind === "item" ? "item · uses your turn" : o.cost ? o.cost + " energy" : "free"}${o.power ? " · ×" + o.power : ""}${o.rank > 1 ? " · rank " + ROMAN[o.rank] : ""}${o.ultimate ? " · ULTIMATE" : ""}${o.teamUp ? " · TEAM-UP" : ""}</small><small>${esc(o.reason || o.desc || "")}</small></button>`).join("")}</div><div class="row" style="margin-top:8px"><button class="btn red" data-act="locka" data-id="${v.id}" data-turn="${v.turn}" ${SELKEY ? "" : "disabled"}>Lock action (Enter)</button>${v.mode === "arena" ? "" : ""}<button class="btn sm" data-act="forfeit" data-id="${v.id}">Forfeit</button></div>`;
      else if (st === "TurnSummary")
        mid += '<p class="mut">Turn resolved. Next turn starting…</p>';
      else if (!me)
        mid +=
          '<p class="mut">You are spectating. Hidden actions stay hidden until the turn resolves.</p>';
    }
    mid += `</div>${last && st !== "WaitingForPlayers" ? `<div class="panel" style="margin-top:10px"><h3>Turn ${last.n} report</h3><div class="log" style="max-height:220px">${last.events.map(evText).join("")}</div></div>` : ""}`;
    return {
      html: `<div class="row sp"><h2><a href="#/battles">←</a> ${esc(v.teams.map((t) => t.name).join(" vs "))}</h2><small>${Object.entries(
        v.online || {},
      )
        .map(
          ([k, o]) =>
            `${esc(v.teams.find((t) => t.id === k).name)}: ${o ? "🟢" : "⚪"}`,
        )
        .join(" · ")}</small></div>
 <div class="arena">${fighter(sY, !!me)}<div class="mid">${mid}</div>${fighter(sO, false)}</div>`,
      after: () => {
        if (last && lastSeen[v.id] !== last.n) {
          lastSeen[v.id] = last.n;
          last.events
            .filter((e) => e.k === "damage" || e.k === "counter")
            .forEach((e) => {
              const f = $("#f" + e.target);
              f && f.classList.add("shake");
            });
        }
      },
    };
  },
  { live: true },
);
act("pickc", (b) => {
  SELKEY = b.dataset.id;
  $$(".act").forEach((x) => x.classList.toggle("sel", x === b));
  $("[data-act=lockc]").disabled = false;
});
act("picka", (b) => {
  SELKEY = b.dataset.key;
  $$(".act").forEach((x) => x.classList.toggle("sel", x === b));
  $("[data-act=locka]").disabled = false;
});
act("lockc", async (b) => {
  await api(
    `/battles/${b.dataset.id}/${b.dataset.kind === "ban" ? "ban" : "select"}`,
    { method: "POST", body: { charId: SELKEY } },
  );
  SELKEY = null;
  render(true);
});
// squad picks toggle; the order of picking is the order sent (first = starting hero)
act("pickq", (b) => {
  const id = b.dataset.id,
    n = +b.dataset.n,
    i = SQUAD.indexOf(id);
  if (i >= 0) SQUAD.splice(i, 1);
  else if (SQUAD.length < n) SQUAD.push(id);
  else return toast(`Your squad already has ${n}: remove one first`, true);
  $$("[data-act=pickq]").forEach((x) => {
    const k = SQUAD.indexOf(x.dataset.id);
    x.classList.toggle("sel", k >= 0);
    x.querySelector(".ord").textContent = k >= 0 ? k + 1 : "";
  });
  const l = $("[data-act=lockq]");
  l.disabled = SQUAD.length !== n;
  l.textContent = `Lock squad (${SQUAD.length}/${n})`;
});
act("lockq", async (b) => {
  await api(`/battles/${b.dataset.id}/squad`, {
    method: "POST",
    body: { charIds: SQUAD },
  });
  SQUAD = [];
  render(true);
});
act("locka", async (b) => {
  await api(`/battles/${b.dataset.id}/action`, {
    method: "POST",
    body: { turn: +b.dataset.turn, key: SELKEY },
  });
  SELKEY = null;
  render(true);
});
act("forfeit", async (b) => {
  if (confirm("Forfeit this battle? Your opponent wins."))
    await api(`/battles/${b.dataset.id}/forfeit`, { method: "POST" });
});
document.addEventListener("keydown", (e) => {
  if (
    /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) ||
    !location.hash.startsWith("#/battle/")
  )
    return;
  const opts = $$("[data-act=picka]");
  if (/^[1-9]$/.test(e.key) && opts[+e.key - 1] && !opts[+e.key - 1].disabled)
    opts[+e.key - 1].click();
  if (e.key === "Enter") {
    const l =
      $("[data-act=locka]:not(:disabled)") ||
      $("[data-act=lockc]:not(:disabled)") ||
      $("[data-act=lockq]:not(:disabled)");
    l && l.click();
  }
});
route("/results/:id", async (id) => {
  const v = await api("/battles/" + id);
  if (v.state !== "Finished")
    return `<div class="panel"><p>This battle is not finished yet.</p><a class="btn" href="#/battle/${id}">Back to the arena</a></div>`;
  const dmg = {},
    heals = {},
    by = {};
  v.turns.forEach((t) =>
    t.events.forEach((e) => {
      if (e.k === "damage" || e.k === "counter")
        dmg[e.team] = (dmg[e.team] || 0) + e.amount;
      if (e.k === "heal") heals[e.team] = (heals[e.team] || 0) + e.amount;
      if (e.k === "defeat") by[e.team] = (by[e.team] || 0) + 1;
    }),
  );
  const nm = (i) => v.teams.find((t) => t.id === i)?.name;
  return `<h1 style="font-size:2.6rem">BATTLE RESULTS</h1><div class="panel gold"><h2>${v.winner ? "🏆 " + esc(nm(v.winner)) : "Draw"}</h2><p class="mut">${esc(v.reason || "")} · ${v.turns.length} turns · ${v.mode}${v.ranked ? " · ranked" : ""}${fmt(v) ? " · " + fmt(v) : ""}</p>${v.ratingChange ? `<p>Rating: ${v.teams.map((t) => `${esc(t.name)} ${v.ratingChange[t.id] > 0 ? "+" : ""}${v.ratingChange[t.id]}`).join(" · ")}</p>` : ""}<div class="row"><a class="btn" href="#/replay/${v.id}">▶ Watch replay</a>${v.me && !v.tournament ? `<button class="btn gold" data-act="rematch" data-id="${v.id}">Rematch</button>` : ""}</div></div>
 <div class="grid g2" style="margin-top:12px">${v.teams
   .map(
     (t) =>
       `<div class="panel"><h3>${esc(t.name)}</h3><div class="kv"><span>Damage dealt</span><b>${dmg[t.id] || 0}</b><span>Health healed</span><b>${heals[t.id] || 0}</b><span>Characters lost</span><b>${by[t.id] || 0}</b>${v.rewards ? `<span>Points earned</span><b style="color:var(--gold)">${earned(v, t.id)}${v.rewards[t.id].bonus ? ` <small>(incl. ${v.rewards[t.id].bonus} bonus)</small>` : ""}</b>` : ""}</div>${v.sides
         .find((s) => s.teamId === t.id)
         .chars.map(
           (c) =>
             `<div style="margin-top:6px"><small>${esc(c.name)}${c.eliminated ? " (defeated)" : ""}</small>${hp(c.hp, c.max)}</div>`,
         )
         .join("")}${xpList(v, t.id)}</div>`,
   )
   .join("")}</div>
 <div class="panel" style="margin-top:12px"><h3>Turn by turn</h3>${v.turns
   .map(
     (t) =>
       `<details><summary>Turn ${t.n}: ${Object.entries(t.actions)
         .map(
           ([k, a]) =>
             `${esc(nm(k))} → ${esc(a.label)}${a.defaulted ? " (timeout)" : ""}`,
         )
         .join(
           " · ",
         )}</summary><div class="log">${t.events.map(evText).join("")}</div></details>`,
   )
   .join("")}</div>
 ${SESS?.role === "player" && v.me ? `<div class="panel" style="margin-top:12px"><h3>Dispute this result</h3><textarea id="dr" aria-label="Reason" placeholder="Explain what went wrong"></textarea><button class="btn sm" data-act="dispute" data-id="${id}">Submit to admin</button> ${v.disputes.length ? `<small>${v.disputes.length} dispute(s) filed</small>` : ""}</div>` : ""}<a class="btn" href="#/battles" style="margin-top:12px">Back to lobby</a>`;
});
act("dispute", async (b) => {
  await api(`/battles/${b.dataset.id}/dispute`, {
    method: "POST",
    body: { reason: $("#dr").value },
  });
  toast("Dispute sent to the admin");
});
route("/matches", async () => {
  const b = (await api("/battles")).filter((x) =>
    ["Finished", "BattleCancelled", "Declined"].includes(x.state),
  );
  return `<h1 style="font-size:2.6rem">MATCH HISTORY</h1><div class="panel scroll"><table><tr><th>Date</th><th>Match</th><th>Mode</th><th>Result</th><th></th></tr>${b.map((x) => `<tr><td>${dt(x.created)}</td><td>${esc(x.teams.map((t) => t.name).join(" vs "))}</td><td>${x.mode}${x.ranked ? " · ranked" : ""}${fmt(x) ? " · " + fmt(x) : ""}</td><td>${x.state === "Finished" ? (x.winner ? "🏆 " + esc(x.teams.find((t) => t.id === x.winner).name) : "Draw") : x.state}</td><td>${x.state === "Finished" ? `<a href="#/results/${x.id}">Results</a> · <a href="#/replay/${x.id}">Replay</a>` : ""}</td></tr>`).join("") || '<tr><td colspan=5 class="mut">No completed battles yet.</td></tr>'}</table></div>`;
});
/* ---------------- replay: step through a finished battle from its saved turn history ---------------- */
let RP = null;
route("/replay/:id", async (id) => {
  const v = await api("/battles/" + id);
  if (v.state !== "Finished")
    return `<div class="panel"><p>A replay is available once the battle is finished.</p><a class="btn" href="#/battle/${id}">Back to the arena</a></div>`;
  clearInterval(RP?.timer);
  RP = { v, step: 0, timer: null };
  return {
    html: `<div class="row sp"><h1 style="font-size:2.4rem">REPLAY</h1><a class="btn sm" href="#/results/${id}">Results</a></div><p class="mut">${esc(v.teams.map((t) => t.name).join(" vs "))} · ${v.mode}${fmt(v) ? " · " + fmt(v) : ""} · ${v.turns.length} turns</p>
 <div class="panel replay-ctl"><button class="btn sm" data-act="rp" data-d="first" aria-label="Start">⏮</button><button class="btn sm" data-act="rp" data-d="-1" aria-label="Previous turn">◀</button><button class="btn sm red" data-act="rpplay" id="rpplay">▶ Play</button><button class="btn sm" data-act="rp" data-d="1" aria-label="Next turn">▶</button><button class="btn sm" data-act="rp" data-d="last" aria-label="Last turn">⏭</button><input type="range" id="rpr" min="0" max="${v.turns.length}" value="0" aria-label="Turn" style="flex:1"><b id="rpl"></b></div>
 <div id="rpv" style="margin-top:10px"></div>`,
    after: () => {
      $("#rpr").oninput = (e) => rpGo(+e.target.value);
      rpGo(0);
    },
  };
});
// step 0 = the squads as they took the field; step k = the state after turn k
function rpGo(k) {
  const v = RP.v,
    N = v.turns.length;
  RP.step = Math.max(0, Math.min(N, k));
  const t = v.turns[RP.step - 1],
    snap = (id) => (t ? t.snapshot[id] : v.start?.chars[id]) || {},
    on = (id) => (t ? t.active?.[id] : v.start?.active[id]);
  $("#rpr").value = RP.step;
  $("#rpl").textContent = RP.step ? `Turn ${RP.step} of ${N}` : "Start";
  $("#rpv").innerHTML =
    `<div class="grid g2">${v.sides
      .map((s) => {
        const sn = snap(s.teamId);
        return `<div class="panel"><h3>${esc(s.name)}</h3>${s.chars
          .map((c) => {
            const x = sn[c.id] || { hp: c.max, energy: c.maxEnergy };
            return `<div style="margin-top:6px"><small>${on(s.teamId) === c.id ? "▶ " : ""}<b>${esc(shortN(c.name))}</b>${x.hp <= 0 ? " (defeated)" : ""}</small>${hp(x.hp, c.max)}<div class="hpbar enbar xpbar" style="margin-top:2px"><i style="width:${(x.energy / c.maxEnergy) * 100}%"></i></div>${x.charge != null ? `<div class="hpbar chbar xpbar" style="margin-top:2px" title="Ultimate charge ${x.charge}%"><i style="width:${x.charge}%"></i></div>` : ""}</div>`;
          })
          .join("")}</div>`;
      })
      .join("")}</div>
 ${t ? `<div class="panel" style="margin-top:10px"><h3>Turn ${t.n}: ${Object.entries(t.actions).map(([id, a]) => `${esc(nameOf(v, id))} → ${esc(a.label)}`).join(" · ")}</h3><div class="log">${t.events.map(evText).join("")}</div></div>` : '<p class="mut">The squads take the field. Press play or step through the turns.</p>'}`;
}
act("rp", (b) => {
  const d = b.dataset.d;
  rpGo(d === "first" ? 0 : d === "last" ? RP.v.turns.length : RP.step + +d);
});
act("rpplay", (b) => {
  const stop = () => {
    clearInterval(RP.timer);
    RP.timer = null;
    const p = $("#rpplay");
    if (p) p.textContent = "▶ Play";
  };
  if (RP.timer) return stop();
  if (RP.step >= RP.v.turns.length) rpGo(0);
  b.textContent = "⏸ Pause";
  RP.timer = setInterval(
    () =>
      !$("#rpv") || RP.step >= RP.v.turns.length ? stop() : rpGo(RP.step + 1),
    1400,
  );
});
/* ---------------- tournaments (bracket view; the admin creates them) ---------------- */
const roundName = (i, t) => {
  const total = Math.log2(t.rounds[0].length * 2);
  return i === total - 1
    ? "Final"
    : i === total - 2
      ? "Semi-finals"
      : `Round ${i + 1}`;
};
const matchBox = (t, m) => {
  const nm = (id) => (id ? esc(t.names[id]) : '<span class="mut">bye</span>'),
    w = (id) => (m.winner && m.winner === id ? "win" : "");
  return `<div class="match"><div class="${w(m.a)}">${nm(m.a)}</div><div class="${w(m.b)}">${nm(m.b)}</div><small class="mut">${
    m.status === "playing"
      ? `<a href="#/battle/${m.battleId}">live now</a>`
      : m.status === "pending"
        ? "waiting for both teams to be free"
        : m.status === "done"
          ? `<a href="#/results/${m.battleId}">result</a>`
          : m.status
  }${m.replays ? ` · replayed ×${m.replays}` : ""}</small></div>`;
};
const tourCard = (t, extra = "") =>
  `<div class="panel ${t.status === "running" ? "gold" : ""}" style="margin-bottom:12px"><div class="row sp"><h2>${esc(t.name)}</h2><span class="state">${t.status.toUpperCase()}</span></div><p class="mut">${t.squadSize}v${t.squadSize} · ${t.mode}${t.ranked ? " · ranked" : ""}${t.prize ? ` · prize ${t.prize} points` : ""}${t.winner ? ` · 🏆 <b style="color:var(--gold)">${esc(t.names[t.winner])}</b>` : ""}</p><div class="bracket">${t.rounds.map((r, i) => `<div class="round"><small class="mut">${roundName(i, t)}</small>${r.map((m) => matchBox(t, m)).join("")}</div>`).join("")}</div>${extra}</div>`;
route(
  "/tournaments",
  async () => {
    const L = await api("/tournaments");
    return `<h1 style="font-size:2.6rem">TOURNAMENTS</h1><p class="mut">Single elimination, seeded by rating. A match starts as soon as both teams are free; open it from here or the battle lobby.</p>${L.map((t) => tourCard(t)).join("") || '<div class="panel mut">No tournaments yet. The admin creates them.</div>'}`;
  },
  { live: true },
);
