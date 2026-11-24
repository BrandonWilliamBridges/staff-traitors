import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDb, Game, DEFAULT_CONFIG, isQuietTime, nextOpenTime, gameDayProblem, chooseTraitors, makeRng, tally, defaultTraitorCount,
} from '../src/engine.js';
import { STARTER_MISSIONS, ONE_WEEK_PLAN } from '../src/missions.js';

const TUESDAY_NOON = new Date('2027-01-12T18:00:00Z'); // 12:00 PM in Chicago

// Build a game with a cast season and `n` registered players.
export function setup({ n = 18, config = {}, clock = () => TUESDAY_NOON, depts } = {}) {
  const game = new Game(openDb(), { clock });
  game.bootstrapGameMaster('gm@school.org');
  const gm = game.get("SELECT * FROM players WHERE kind = 'gm'");
  game.saveSeason(gm, { name: 'Test season', startDate: '2027-01-11', endDate: '2027-02-26', blackouts: [{ date: '2027-01-18', label: 'Holiday' }], config: { emailDomain: 'school.org', ...config } });
  const [sp] = game.addPeople(gm, ['principal@school.org'], { kind: 'sponsor' });
  const sponsor = game.get('SELECT * FROM players WHERE email = ?', sp.email);
  for (const k of ['staffAssociationTold', 'technologyOfficeOk', 'noSchoolSystemsConnected']) game.setChecklist(gm, k, true);
  game.approveSeason(sponsor);
  game.openRegistration(gm);
  const emails = Array.from({ length: n }, (_, i) => `t${i}@school.org`);
  game.addPeople(gm, emails);
  const departments = depts || DEFAULT_CONFIG.departments;
  for (let i = 0; i < n; i++) {
    const p = game.get('SELECT * FROM players WHERE email = ?', emails[i]);
    game.register(p, { displayName: `Teacher ${i}`, department: departments[i % departments.length], consents: { voluntary: true, optOut: true, noClassTime: true, conduct: true } });
  }
  const fresh = (id) => game.player(id);
  return { game, gm: fresh(gm.id), sponsor: fresh(sponsor.id), fresh };
}

const players = (game) => game.alivePlayers();

test('quiet hours: weekends, class periods, evenings', () => {
  const c = DEFAULT_CONFIG;
  assert.equal(isQuietTime(new Date('2027-01-16T18:00:00Z'), c), true, 'Saturday');
  assert.equal(isQuietTime(new Date('2027-01-12T15:00:00Z'), c), true, '9:00 AM is a class period');
  assert.equal(isQuietTime(new Date('2027-01-12T17:40:00Z'), c), false, '11:40 AM is lunch');
  assert.equal(isQuietTime(new Date('2027-01-13T03:00:00Z'), c), true, '9 PM');
  const next = nextOpenTime(new Date('2027-01-15T23:30:00Z'), c); // Friday 5:30 PM is open
  assert.equal(next.toISOString(), '2027-01-15T23:30:00.000Z');
  const monday = nextOpenTime(new Date('2027-01-16T18:00:00Z'), c); // Saturday goes to Monday 6:30 AM
  assert.equal(monday.toISOString(), '2027-01-18T12:30:00.000Z');
});

test('game days skip weekends, blackout dates and days outside the season', () => {
  const season = { start_date: '2027-01-11', end_date: '2027-02-26', config: DEFAULT_CONFIG };
  const b = [{ date: '2027-01-18', label: 'Holiday' }];
  assert.equal(gameDayProblem(TUESDAY_NOON, season, b), null);
  assert.match(gameDayProblem(new Date('2027-01-18T18:00:00Z'), season, b), /Holiday/);
  assert.match(gameDayProblem(new Date('2027-01-16T18:00:00Z'), season, b), /Weekends/);
  assert.match(gameDayProblem(new Date('2027-03-02T18:00:00Z'), season, b), /outside/);
});

test('traitor count and department balancing', () => {
  assert.equal(defaultTraitorCount(10), 2);
  assert.equal(defaultTraitorCount(45), 5);
  assert.equal(defaultTraitorCount(200), 5);
  const eligible = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, department: ['A', 'B', 'C', 'D'][i % 4] }));
  for (let s = 0; s < 50; s++) {
    const picked = chooseTraitors(eligible, 4, makeRng(`seed${s}`));
    assert.equal(new Set(picked.map((p) => p.department)).size, 4, 'one per department');
  }
  // Same seed, same draw: the draw can be checked after the season.
  assert.deepEqual(chooseTraitors(eligible, 3, makeRng('abc')).map((p) => p.id), chooseTraitors(eligible, 3, makeRng('abc')).map((p) => p.id));
});

test('tally counts daggers and finds ties', () => {
  assert.deepEqual(tally([{ target_id: 1 }, { target_id: 2 }]).leaders.sort(), [1, 2]);
  assert.deepEqual(tally([{ target_id: 1 }, { target_id: 2, weight: 2 }]).leaders, [2]);
  assert.deepEqual(tally([]).leaders, []);
});

test('setup gates: approval and checklist before registration', () => {
  const game = new Game(openDb(), { clock: () => TUESDAY_NOON });
  game.bootstrapGameMaster('gm@school.org');
  const gm = game.get("SELECT * FROM players WHERE kind = 'gm'");
  game.saveSeason(gm, { name: 'S', startDate: '2027-01-11', endDate: '2027-02-26' });
  assert.throws(() => game.openRegistration(gm), /approve/);
  assert.throws(() => game.approveSeason(gm), /access/);
  game.addPeople(gm, ['p@school.org'], { kind: 'sponsor' });
  game.approveSeason(game.get("SELECT * FROM players WHERE kind = 'sponsor'"));
  assert.throws(() => game.openRegistration(gm), /checklist/);
});

test('sign in: codes work once and one device at a time', () => {
  const game = new Game(openDb(), { clock: () => TUESDAY_NOON });
  const code = game.bootstrapGameMaster('gm@school.org');
  assert.equal(game.bootstrapGameMaster('other@school.org'), null);
  const t1 = game.signIn('GM@school.org', code.toLowerCase());
  assert.equal(game.playerFromToken(t1).kind, 'gm');
  assert.throws(() => game.signIn('gm@school.org', code), /match/);
  const fresh = game.requestCode('gm@school.org');
  const t2 = game.signIn('gm@school.org', fresh.code);
  assert.equal(game.playerFromToken(t1), null, 'old device signed out');
  assert.ok(game.playerFromToken(t2));
  assert.equal(game.requestCode('stranger@school.org'), null);
});

test('registration needs every consent and a listed department; only school addresses', () => {
  const { game, gm } = setup({ n: 6 });
  assert.throws(() => game.addPeople(gm, ['x@gmail.com']), /school.org/);
  game.addPeople(gm, ['new@school.org']);
  const p = game.get("SELECT * FROM players WHERE email = 'new@school.org'");
  assert.throws(() => game.register(p, { displayName: 'N', department: 'Math', consents: { voluntary: true } }), /four/);
  assert.throws(() => game.register(p, { displayName: 'N', department: 'Nope', consents: { voluntary: true, optOut: true, noClassTime: true, conduct: true } }), /department/);
});

test('casting: evaluators stay Faithful, late joiners are Faithful, roles stay secret from others', () => {
  const { game, gm } = setup({ n: 18 });
  const evals = game.addPeople(gm, ['ap@school.org'], { evaluator: true });
  game.register(game.get('SELECT * FROM players WHERE email = ?', evals[0].email), { displayName: 'AP', department: 'Administration', consents: { voluntary: true, optOut: true, noClassTime: true, conduct: true } });
  const r = game.castRoles(gm);
  assert.equal(r.traitors, 2);
  const ap = game.get("SELECT * FROM players WHERE email = 'ap@school.org'");
  assert.equal(game.roleOf(ap.id), 'faithful');
  game.addPeople(gm, ['late@school.org']);
  const late = game.get("SELECT * FROM players WHERE email = 'late@school.org'");
  game.register(late, { displayName: 'Late', department: 'Math', consents: { voluntary: true, optOut: true, noClassTime: true, conduct: true } });
  assert.equal(game.roleOf(late.id), 'faithful');
  const faithful = players(game).find((p) => p.role === 'faithful');
  assert.throws(() => game.hideoutView(game.player(faithful.id)), /access/);
  const sponsorView = game.dashboardView(game.get("SELECT * FROM players WHERE kind = 'sponsor'"));
  assert.ok(sponsorView.people.every((p) => p.role === undefined && p.email === undefined), 'sponsor never sees roles or emails');
  // Notifications never name the role.
  assert.ok(game.all('SELECT text FROM outbox').every((o) => !/traitor|faithful/i.test(o.text)));
});

test('sealed mode hides roles from the Game Master', () => {
  const { game, gm } = setup({ n: 10, config: { sealed: true } });
  game.castRoles(gm);
  assert.ok(game.dashboardView(gm).people.every((p) => p.role === undefined));
});

test('nothing runs on a blackout date unless overridden, and pause stops play', () => {
  let now = new Date('2027-01-18T18:00:00Z');
  const { game, gm, sponsor } = setup({ n: 10, clock: () => now });
  game.castRoles(gm);
  assert.throws(() => game.startRound(gm), /Holiday/);
  game.startRound(gm, { force: true });
  assert.ok(game.all("SELECT * FROM audit_log WHERE action = 'start_round'")[0].detail.includes('"force":true'));
  now = TUESDAY_NOON;
  game.setPaused(sponsor, true);
  const t = players(game).find((p) => p.role === 'traitor');
  assert.throws(() => game.traitorVote(game.player(t.id), players(game).find((p) => p.role === 'faithful').id), /paused/);
  game.setPaused(gm, false);
});

test('missions: codes graded, ghosts limited to kindness, sabotage halves, shields awarded', () => {
  const { game, gm } = setup({ n: 12 });
  game.castRoles(gm);
  assert.equal(game.loadStarterMissions(gm, STARTER_MISSIONS), 30);
  const quiz = game.get("SELECT * FROM missions WHERE answer = 'EDIT ME' LIMIT 1");
  assert.throws(() => game.setMissionStatus(gm, quiz.id, 'open'), /answer/);
  const code = game.get("SELECT * FROM missions WHERE title = 'Copy Room Clue'");
  const puzzle = game.get("SELECT * FROM missions WHERE title = 'Four Letters'");
  const kindness = game.get("SELECT * FROM missions WHERE title = 'New Teacher Welcome'");
  for (const m of [code, puzzle, kindness]) game.setMissionStatus(gm, m.id, 'open');
  const [a, b] = players(game).filter((p) => p.role === 'faithful');
  const traitor = players(game).find((p) => p.role === 'traitor');
  assert.equal(game.submitMission(game.player(a.id), code.id, { answer: 'wrong' }).status, 'rejected');
  assert.equal(game.submitMission(game.player(a.id), code.id, { answer: ' lantern ' }).status, 'approved');
  assert.throws(() => game.submitMission(game.player(a.id), code.id, { answer: 'lantern' }), /already/);
  assert.equal(game.season().pot, 100);
  game.startRound(gm);
  game.sabotage(game.player(traitor.id), puzzle.id);
  assert.throws(() => game.sabotage(game.player(traitor.id), puzzle.id), /already/);
  game.submitMission(game.player(b.id), puzzle.id, { answer: 'trust' });
  assert.equal(game.season().pot, 300, 'half of 400 added');
  const sub = game.submitMission(game.player(b.id), kindness.id, {});
  assert.equal(sub.status, 'pending');
  game.reviewSubmission(gm, sub.id, true);
  assert.equal(game.meView(game.player(b.id)).me.shields, 1);
  game.optOut(game.player(a.id));
  assert.throws(() => game.submitMission(game.player(a.id), puzzle.id, { answer: 'trust' }), /Ghosts/);
});

test('murder: shields block, ties broken at random, away players safe', () => {
  const { game, gm } = setup({ n: 12 });
  game.castRoles(gm);
  game.startRound(gm);
  const traitors = players(game).filter((p) => p.role === 'traitor');
  const faithful = players(game).filter((p) => p.role === 'faithful');
  game.setAway(gm, faithful[2].id, true);
  assert.throws(() => game.traitorVote(game.player(traitors[0].id), faithful[2].id), /away/);
  game.run("INSERT INTO items (player_id, kind, created_at) VALUES (?, 'shield', 'x')", faithful[0].id);
  game.traitorVote(game.player(traitors[0].id), faithful[0].id);
  game.traitorVote(game.player(traitors[1].id), faithful[0].id);
  const r1 = game.resolveMurder(gm);
  assert.equal(r1.result, 'shielded');
  assert.equal(game.player(faithful[0].id).status, 'active');
  // Next round: a tie between two targets.
  game.openVote(gm);
  game.closeVote(gm); // nobody voted
  game.startRound(gm);
  game.traitorVote(game.player(traitors[0].id), faithful[0].id);
  game.traitorVote(game.player(traitors[1].id), faithful[1].id);
  const r2 = game.resolveMurder(gm);
  assert.equal(r2.result, 'murdered');
  assert.ok([faithful[0].id, faithful[1].id].includes(r2.victimId));
});

test('roundtable: one vote each, no self vote, tie revote, second tie banishes nobody', () => {
  const { game, gm } = setup({ n: 12 });
  game.castRoles(gm);
  game.startRound(gm);
  game.resolveMurder(gm); // no traitor votes: nobody murdered
  assert.equal(game.currentRound().murder_result, 'none');
  game.openVote(gm);
  const alive = players(game);
  const [x, y] = alive;
  assert.throws(() => game.castVote(game.player(x.id), x.id), /yourself/);
  game.castVote(game.player(x.id), y.id);
  game.castVote(game.player(x.id), alive[2].id); // changed vote replaces the old one
  assert.equal(game.get('SELECT COUNT(*) n FROM votes WHERE voter_id = ?', x.id).n, 1);
  // Make a tie between y and z.
  const z = alive[2];
  game.run('DELETE FROM votes');
  alive.slice(3, 7).forEach((p) => game.castVote(game.player(p.id), y.id));
  alive.slice(7, 11).forEach((p) => game.castVote(game.player(p.id), z.id));
  const first = game.closeVote(gm);
  assert.equal(first.outcome, 'revote');
  assert.throws(() => game.castVote(game.player(alive[3].id), alive[5].id), /tied/);
  game.castVote(game.player(alive[3].id), y.id);
  game.castVote(game.player(alive[4].id), z.id);
  const second = game.closeVote(gm);
  assert.equal(second.outcome, 'none');
  assert.equal(game.currentRound().phase, 'done');
});

test('banishing a Traitor rewards correct voters and opens recruitment for the last Traitor', () => {
  const { game, gm } = setup({ n: 14 });
  game.castRoles(gm);
  game.startRound(gm);
  game.resolveMurder(gm);
  game.openVote(gm);
  const alive = players(game);
  const [t1, t2] = alive.filter((p) => p.role === 'traitor');
  const voters = alive.filter((p) => p.id !== t1.id);
  for (const v of voters) game.castVote(game.player(v.id), t1.id);
  const before = game.player(voters[0].id).points;
  const out = game.closeVote(gm);
  assert.equal(out.outcome, 'banished');
  assert.equal(out.role, 'traitor');
  assert.equal(game.player(voters[0].id).points, before + 10 + 5, 'correct vote plus survival');
  assert.equal(game.currentRound().recruit_open, 1);
  const target = players(game).find((p) => p.role === 'faithful');
  game.offerRecruit(game.player(t2.id), target.id);
  assert.equal(game.roleView(game.player(target.id)).recruitOffer, true);
  game.answerRecruit(game.player(target.id), true);
  assert.equal(game.roleOf(target.id), 'traitor');
});

test('endgame: needs every remaining player to vote End Game', () => {
  const { game, gm } = setup({ n: 8, config: { traitorCount: 2 } });
  game.castRoles(gm);
  const faithful = players(game).filter((p) => p.role === 'faithful');
  // Take three Faithful out so five remain: the final roundtable.
  for (const f of faithful.slice(0, 3)) game.markLeft(gm, f.id);
  assert.equal(game.season().status, 'active');
  game.startRound(gm);
  assert.equal(game.currentRound().phase, 'vote');
  assert.equal(game.currentRound().endgame, 1);
  const alive = players(game);
  const target = alive.find((p) => p.role === 'faithful');
  for (const v of alive.filter((p) => p.id !== target.id)) game.castVote(game.player(v.id), target.id);
  game.closeVote(gm);
  // Two Traitors against two Faithful: Traitors already win.
  assert.equal(game.season().status, 'ended');
  assert.equal(game.season().winner, 'traitors');
  const story = game.seasonStory();
  assert.equal(story.roles.filter((r) => r.role === 'traitor').length, 2);
  assert.match(story.seed, /^[0-9a-f]{64}$/);
});

test('end game vote that is not unanimous keeps playing', () => {
  const { game, gm } = setup({ n: 9, config: { traitorCount: 2 } });
  game.castRoles(gm);
  const [t1] = players(game).filter((p) => p.role === 'traitor');
  const faithful = players(game).filter((p) => p.role === 'faithful');
  for (const f of faithful.slice(0, 3)) game.markLeft(gm, f.id); // 6 left: 2 traitors, 4 faithful
  game.startRound(gm);
  game.resolveMurder(gm); // nobody murdered
  game.openVote(gm);
  const alive = players(game);
  for (const v of alive.filter((p) => p.id !== t1.id)) game.castVote(game.player(v.id), t1.id);
  game.closeVote(gm); // 5 remain: 1 traitor, 4 faithful
  assert.equal(game.currentRound().phase, 'endcheck');
  const left = players(game);
  left.forEach((p, i) => game.endVote(game.player(p.id), i === 0 ? 'continue' : 'end'));
  assert.equal(game.closeEndVote(gm).ended, false);
  assert.equal(game.season().status, 'active');
});

test('the last day of the season forces the Final Roundtable', () => {
  const { game, gm } = setup({ n: 12, clock: () => new Date('2027-02-26T18:00:00Z') });
  game.castRoles(gm);
  game.startRound(gm);
  assert.equal(game.currentRound().endgame, 1);
  assert.equal(game.currentRound().phase, 'vote');
});

test('one roundtable a day: a second one waits for the next school day', () => {
  let now = TUESDAY_NOON;
  const { game, gm } = setup({ n: 16, clock: () => now });
  game.castRoles(gm);
  const roundtable = () => {
    game.startRound(gm);
    game.resolveMurder(gm);
    game.openVote(gm);
    const alive = players(game);
    for (const p of alive) game.castVote(game.player(p.id), (p.id === alive[0].id ? alive[1] : alive[0]).id);
    game.closeVote(gm);
  };
  roundtable();
  game.startRound(gm);
  game.resolveMurder(gm);
  assert.throws(() => game.openVote(gm), /already been a roundtable today/);
  game.openVote(gm, { force: true }); // the Game Master can override, and it is logged
  assert.ok(game.get("SELECT 1 x FROM audit_log WHERE action = 'open_vote' AND detail LIKE '%\"force\":true%'"));
  now = new Date('2027-01-13T18:00:00Z'); // Wednesday
  const alive = players(game);
  for (const p of alive) game.castVote(game.player(p.id), (p.id === alive[0].id ? alive[1] : alive[0]).id);
  game.closeVote(gm);
  roundtable(); // a new day, a new roundtable
});

test('the one-week plan opens each day\'s missions and closes finished ones', () => {
  let now = new Date('2027-01-11T18:00:00Z'); // Monday
  const { game, gm } = setup({ n: 12, clock: () => now });
  assert.equal(new Set(ONE_WEEK_PLAN.map((p) => p.title)).size, ONE_WEEK_PLAN.length, 'no mission twice');
  assert.deepEqual([...new Set(ONE_WEEK_PLAN.map((p) => p.day))], [1, 2, 3, 4, 5]);
  const r = game.loadWeekPlan(gm, STARTER_MISSIONS, ONE_WEEK_PLAN);
  assert.equal(r.planned, ONE_WEEK_PLAN.length);
  assert.equal(game.loadWeekPlan(gm, STARTER_MISSIONS, ONE_WEEK_PLAN).added, 0, 'loading twice adds nothing');
  game.castRoles(gm);
  const mon = game.openPlannedDay(gm);
  assert.equal(mon.day, 1);
  assert.ok(mon.opened.includes('Lounge Clue'));
  assert.deepEqual(mon.needAnswer, ['School History One']);
  now = new Date('2027-01-12T18:00:00Z'); // Tuesday
  const tue = game.openPlannedDay(gm);
  assert.equal(tue.day, 2);
  assert.ok(tue.closed.includes('Lounge Clue'));
  assert.ok(!tue.closed.includes('New Teacher Welcome'), 'week-long missions stay open');
  assert.ok(tue.opened.includes('The Broken Map'));
  now = new Date('2027-01-19T18:00:00Z'); // the next Tuesday, after the Monday holiday
  assert.equal(game.schoolDayNumber(), 6);
});

test('several murders a night: the top names are murdered', () => {
  const { game, gm } = setup({ n: 20, config: { murdersPerRound: 2 } });
  game.castRoles(gm);
  game.startRound(gm);
  const traitors = players(game).filter((p) => p.role === 'traitor');
  const faithful = players(game).filter((p) => p.role === 'faithful');
  traitors.forEach((t, i) => game.traitorVote(game.player(t.id), faithful[i % 2].id));
  const r = game.resolveMurder(gm);
  assert.equal(r.victims.length, 2);
});

test('export and delete all player data after the season', () => {
  const { game, gm } = setup({ n: 6 });
  game.castRoles(gm);
  assert.throws(() => game.purge(gm), /End the season/);
  game.endSeasonNow(gm);
  const data = game.exportData(gm);
  assert.ok(data.players.length >= 7);
  game.purge(gm);
  assert.equal(game.get('SELECT COUNT(*) n FROM players').n, 1, 'only the Game Master account is left');
  assert.equal(game.season(), null);
});
