// Drives the real web server over HTTP, the same way the screens do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, Game } from '../src/engine.js';
import { createServer } from '../src/server.js';

test('a season played through the web interface', async () => {
  const game = new Game(openDb(), { clock: () => new Date('2027-01-12T18:00:00Z') });
  const gmCode = game.bootstrapGameMaster('gm@school.org');
  const logs = [];
  const server = createServer(game, { log: (m) => logs.push(String(m)) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const client = () => {
    let cookie = '';
    return async (path, body) => {
      const res = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status });
      return data;
    };
  };

  try {
    const gm = client();
    await assert.rejects(gm('/api/admin'), { status: 401 });
    await gm('/api/login', { email: 'gm@school.org', code: gmCode });
    await gm('/api/admin/season', { name: 'Spring', startDate: '2027-01-11', endDate: '2027-02-26', config: { emailDomain: 'school.org' } });
    const { codes: [sp] } = await gm('/api/admin/people', { emails: 'principal@school.org', kind: 'sponsor' });
    const sponsor = client();
    await sponsor('/api/login', { email: sp.email, code: sp.code });
    await sponsor('/api/admin/approve', {});
    await assert.rejects(sponsor('/api/admin/cast', {}), { status: 403 });
    for (const key of ['staffAssociationTold', 'technologyOfficeOk', 'noSchoolSystemsConnected']) await gm('/api/admin/checklist', { key, value: true });
    await gm('/api/admin/open-registration', {});
    const emails = Array.from({ length: 10 }, (_, i) => `t${i}@school.org`).join('\n');
    const { codes } = await gm('/api/admin/people', { emails });
    const players = [];
    for (const [i, c] of codes.entries()) {
      const p = client();
      await p('/api/login', { email: c.email, code: c.code });
      await p('/api/register', { displayName: `T${i}`, department: 'Math', consents: { voluntary: true, optOut: true, noClassTime: true, conduct: true } });
      players.push(p);
    }
    const cast = await gm('/api/admin/cast', {});
    assert.equal(cast.traitors, 2);
    const roles = await Promise.all(players.map((p) => p('/api/role')));
    const traitorIdx = roles.map((r, i) => (r.role === 'traitor' ? i : -1)).filter((i) => i >= 0);
    assert.equal(traitorIdx.length, 2);
    await assert.rejects(players[roles.findIndex((r) => r.role === 'faithful')]('/api/hideout'), { status: 403 });

    await gm('/api/admin/missions/starter', {});
    const plan = await gm('/api/admin/missions/week-plan', {});
    assert.equal(plan.added, 0, 'the plan reuses the starter missions');
    const day = await gm('/api/admin/missions/open-day', {});
    assert.equal(day.day, 2); // Tuesday of the season's first week
    assert.ok(day.opened.includes('The Broken Map'));
    await gm('/api/admin/round/start', {});
    const hideout = await players[traitorIdx[0]]('/api/hideout');
    await players[traitorIdx[0]]('/api/hideout/vote', { targetId: hideout.targets[0].id });
    const murder = await gm('/api/admin/round/murder', {});
    assert.equal(murder.result, 'murdered');
    await gm('/api/admin/round/open-vote', {});
    const me = await players[traitorIdx[1]]('/api/me');
    assert.equal(me.round.phase, 'vote');
    const traitorView = await players[traitorIdx[0]]('/api/me');
    const target = traitorView.players.find((p) => p.id !== traitorView.me.id);
    await players[traitorIdx[0]]('/api/vote', { targetId: target.id });
    const closed = await gm('/api/admin/round/close-vote', {});
    assert.equal(closed.outcome, 'banished');

    // Requests from another site are refused.
    const res = await fetch(`${base}/api/logout`, { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
    // The same answer for listed and unlisted addresses.
    const a = await client()('/api/request-code', { email: 't1@school.org' });
    const b = await client()('/api/request-code', { email: 'nobody@school.org' });
    assert.equal(a.message, b.message);
    assert.ok(logs.some((l) => l.includes('t1@school.org')));
    // Pages are served.
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /Staff Traitors/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  } finally {
    server.close();
  }
});
