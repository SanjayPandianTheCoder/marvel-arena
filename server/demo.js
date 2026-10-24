// Creates sample data (demo admin + two demo teams). Demo passwords are public – change them or delete data/ before real use.
process.env.NO_LISTEN = "1";
const { db, persist, idle, uid } = await import("./store.js");
const { hashPw } = await import("./auth.js");
await import("./index.js");
db.admin = { username: "admin", ...hashPw("Admin#12345") };
if (!db.players.players.length) {
  [
    ["Avengers Club", "tony"],
    ["Mutant Union", "charles"],
  ].forEach(([n, u]) => {
    const t = {
      id: uid("tm"),
      name: n,
      logo: "",
      color: n[0] == "A" ? "#ec1d24" : "#f6c343",
      balance: db.settings.startingBudget,
      startingBalance: db.settings.startingBudget,
      roster: [],
      ledger: [],
      rating: 1000,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      createdAt: new Date().toISOString(),
    };
    db.teams.push(t);
    db.players.players.push({
      id: uid("pl"),
      username: u,
      ...hashPw("demo12345"),
      teamId: t.id,
      createdAt: new Date().toISOString(),
    });
  });
}
persist("admin", "teams", "players");
await idle();
console.log(
  "Demo data written. Admin: admin / Admin#12345 · Players: tony, charles / demo12345",
);
process.exit(0);
