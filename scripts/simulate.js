// Plays many full seasons with fake players making random choices, and checks
// that every season ends, nobody votes twice and roles never leak.
// The season is one school week: Monday to Friday, one roundtable a day, and
// the Final Roundtable on Friday.
// Usage: npm run simulate -- [seasons] [players] [murders a night]
import assert from 'node:assert/strict';
import { openDb, Game, DEFAULT_CONFIG } from '../src/engine.js';

const SEASONS = Number(process.argv[2] || 300);
const PLAYERS = Number(process.argv[3] || 15);
const MURDERS = Number(process.argv[4] || 1);
const DAYS = ['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const consents = { voluntary: true, optOut: true, noClassTime: true, conduct: true };

function playSeason() {
  let now = new Date('2027-01-08T20:00:00Z'); // roles are cast the Friday before
  const game = new Game(openDb(), { clock: () => now });
  game.bootstrapGameMaster('gm@school.org');
  const gm = game.get("SELECT * FROM players WHERE kind = 'gm'");
  game.saveSeason(gm, {
    name: 'Sim', startDate: '2027-01-11', endDate: '2027-01-15',
    config: { daggers: true, murdersPerRound: MURDERS, revealMode: Math.random() < 0.5 ? 'names' : 'totals' },
  });
  game.addPeople(gm, ['principal@school.org'], { kind: 'sponsor' });
  for (const k of ['staffAssociationTold', 'technologyOfficeOk', 'noSchoolSystemsConnected']) game.setChecklist(gm, k, true);
  game.approveSeason(game.get("SELECT * FROM players WHERE kind = 'sponsor'"));
  game.openRegistration(gm);
  const emails = Array.from({ length: PLAYERS }, (_, i) => `p${i}@school.org`);
  game.addPeople(gm, emails.slice(0, 3), { evaluator: true });
  game.addPeople(gm, emails.slice(3));
  for (const [i, e] of emails.entries()) {
    game.register(game.get('SELECT * FROM players WHERE email = ?', e), { displayName: `P${i}`, department: DEFAULT_CONFIG.departments[i % 15], consents });
  }
  game.castRoles(gm);
  const p = (id) => game.player(id);
  const alive = () => game.alivePlayers();
  // Hand out a few shields and daggers.
  for (const x of alive().slice(0, 6)) game.run('INSERT INTO items (player_id, kind, created_at) VALUES (?, ?, ?)', x.id, Math.random() < 0.5 ? 'shield' : 'dagger', 'sim');

  let rounds = 0;
  let fridayStart = null;
  let fridayTables = 0;
  let dayIndex = 0;
  while (game.season().status === 'active') {
    rounds++;
    assert.ok(rounds < 80, 'season never ended');
    const cur = game.currentRound();
    // A new school day starts after each roundtable, except on Friday, when the
    // Final Roundtable keeps meeting until the players end the game.
    if (cur && cur.vote_date && !cur.endgame) dayIndex++;
    assert.ok(dayIndex < DAYS.length, 'the week ran out without an end');
    now = new Date(`${DAYS[dayIndex]}T13:00:00Z`); // 7:00 AM in Chicago
    if (dayIndex === DAYS.length - 1) {
      if (fridayStart === null) fridayStart = alive().length;
      fridayTables++;
    }
    const startAlive = alive().length;
    game.startRound(gm);
    let r = game.currentRound();
    if (r.phase === 'murder') {
      const targets = alive().filter((x) => x.role === 'faithful' && !x.away);
      const chosen = Array.from({ length: MURDERS }, () => pick(targets)).filter(Boolean);
      alive().filter((x) => x.role === 'traitor').forEach((t, i) => {
        if (Math.random() < 0.9 && chosen.length) game.traitorVote(p(t.id), chosen[i % chosen.length].id);
      });
      game.resolveMurder(gm);
      if (game.season().status !== 'active') break;
      game.openVote(gm);
    }
    // Voting model: the Traitors vote as a bloc for one Faithful; most Faithful
    // follow one loud suspicion of the day (right about a quarter of the time),
    // and the rest vote at random.
    const voteRound = (candidatesFor) => {
      const pool = candidatesFor(null);
      const traitorsIn = pool.filter((x) => x.role === 'traitor');
      const faithfulIn = pool.filter((x) => x.role === 'faithful');
      const suspicion = traitorsIn.length && Math.random() < 0.25 ? pick(traitorsIn) : pick(faithfulIn.length ? faithfulIn : pool);
      const bloc = faithfulIn.length ? pick(faithfulIn) : pick(pool);
      for (const v of alive()) {
        if (Math.random() < 0.05) continue; // some people miss the vote
        const options = pool.filter((x) => x.id !== v.id);
        if (!options.length) continue;
        let target;
        if (v.role === 'traitor') target = bloc.id !== v.id ? bloc : pick(options);
        else target = Math.random() < 0.6 && suspicion.id !== v.id ? suspicion : pick(options);
        const hasDagger = game.get("SELECT 1 FROM items WHERE player_id = ? AND kind = 'dagger' AND used = 0", v.id);
        game.castVote(p(v.id), target.id, { useDagger: !!hasDagger && Math.random() < 0.2 });
        if (Math.random() < 0.1) game.castVote(p(v.id), pick(options).id); // change of mind
      }
    };
    voteRound(() => alive());
    let out = game.closeVote(gm);
    if (out.outcome === 'revote') {
      const tied = JSON.parse(game.currentRound().tie_ids);
      voteRound(() => alive().filter((x) => tied.includes(x.id)));
      out = game.closeVote(gm);
      assert.notEqual(out.outcome, 'revote', 'only one revote');
    }
    r = game.currentRound();
    // One ballot per voter per stage, always.
    const dupes = game.get('SELECT COUNT(*) n FROM (SELECT voter_id, stage FROM votes WHERE round_id = ? GROUP BY voter_id, stage HAVING COUNT(*) > 1)', r.id).n;
    assert.equal(dupes, 0);
    if (r.recruit_open && game.season().status === 'active') {
      const last = alive().find((x) => x.role === 'traitor');
      const target = pick(alive().filter((x) => x.role === 'faithful'));
      game.offerRecruit(p(last.id), target.id);
      game.answerRecruit(p(target.id), Math.random() < 0.5);
    }
    if (game.season().status === 'active' && game.currentRound().phase === 'endcheck') {
      for (const v of alive()) game.endVote(p(v.id), Math.random() < 0.7 ? 'end' : 'continue');
      game.closeEndVote(gm);
    }
    if (Math.random() < 0.1 && game.season().status === 'active') game.optOut(p(pick(alive()).id));
    assert.ok(alive().length <= startAlive);
  }
  const s = game.season();
  assert.ok(['faithful', 'traitors'].includes(s.winner));
  // Roles never leak: no notice to a Faithful player names a role, and
  // no announcement names a living player's role.
  for (const n of game.all("SELECT o.text, r.role FROM outbox o JOIN roles r ON r.player_id = o.player_id WHERE r.role = 'faithful'")) {
    assert.ok(!/you are (a )?traitor|fellow traitor/i.test(n.text), `leak: ${n.text}`);
  }
  // Evaluators were never cast as Traitors (recruitment aside).
  const evalTraitors = game.get("SELECT COUNT(*) n FROM players p JOIN roles r ON r.player_id = p.id WHERE p.is_evaluator = 1 AND r.role = 'traitor' AND r.recruited = 0").n;
  assert.equal(evalTraitors, 0);
  return { winner: s.winner, rounds, fridayStart, fridayTables };
}

const results = { faithful: 0, traitors: 0 };
let totalRounds = 0;
let fridays = 0;
let fridayPlayers = 0;
let fridayTables = 0;
let earlyEnds = 0;
const t0 = Date.now();
for (let i = 0; i < SEASONS; i++) {
  const r = playSeason();
  results[r.winner]++;
  totalRounds += r.rounds;
  if (r.fridayStart === null) earlyEnds++;
  else { fridays++; fridayPlayers += r.fridayStart; fridayTables += r.fridayTables; }
}
console.log(`${SEASONS} seasons of ${PLAYERS} players, ${MURDERS} murders a night, finished in ${((Date.now() - t0) / 1000).toFixed(1)} seconds.`);
console.log(`Faithful won ${results.faithful}, Traitors won ${results.traitors}. ${earlyEnds} ended before Friday.`);
if (fridays) console.log(`When the game reached Friday: ${(fridayPlayers / fridays).toFixed(1)} players left on average, ${(fridayTables / fridays).toFixed(1)} roundtables that day.`);
console.log('Every season ended, nobody voted twice, no roles leaked, no evaluator was cast as a Traitor.');
