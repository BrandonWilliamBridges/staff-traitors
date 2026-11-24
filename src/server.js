// Web server: plain Node, no outside packages. Serves the screens in /public
// and a small JSON interface over the game engine.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, Game, GameError } from './engine.js';
import { STARTER_MISSIONS, ONE_WEEK_PLAN } from './missions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const PORT = Number(process.env.PORT || 8787);
const DB_FILE = process.env.DB_FILE || path.join(here, '..', 'data', 'game.db');
const GM_EMAIL = process.env.GM_EMAIL || 'gamemaster@example.org';
// "console" prints sign-in codes in this window so the Game Master can hand them out.
// A real email sender can be added later on a free plan.
const EMAIL_MODE = process.env.EMAIL_MODE || 'console';
const SECURE_COOKIE = process.env.SECURE_COOKIE === '1';

export function createServer(game, { log = console.log } = {}) {
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    return list.length > max;
  };

  const routes = {
    // ---- sign in ----
    // Limits are per email address, because a whole school shares one internet address.
    'POST /api/request-code': ({ body, ip }) => {
      const key = String(body.email || '').trim().toLowerCase();
      if (limited(`code:${key}`, 3, 15 * 60000) || limited(`codeip:${ip}`, 300, 15 * 60000)) {
        throw new GameError('Too many requests. Try again in a few minutes.', 429);
      }
      const r = game.requestCode(body.email || '');
      if (r && EMAIL_MODE === 'console') log(`[sign-in code] ${r.email}: ${r.code}`);
      // Same answer either way, so nobody can test which addresses are on the list.
      return { ok: true, message: 'If that address is on the list, a code is on its way. You can also ask the Game Master for one.' };
    },
    'POST /api/login': ({ body, ip, res }) => {
      const key = String(body.email || '').trim().toLowerCase();
      if ((hits.get(`fail:${key}`) || []).filter((t) => Date.now() - t < 15 * 60000).length >= 5 || limited(`loginip:${ip}`, 600, 15 * 60000)) {
        throw new GameError('Too many tries. Wait a few minutes.', 429);
      }
      let token;
      try {
        token = game.signIn(body.email || '', body.code || '');
      } catch (e) {
        limited(`fail:${key}`, Infinity, 15 * 60000); // record the failed try
        throw e;
      }
      res.setHeader('Set-Cookie', cookie(token, 60 * 60 * 24 * 90));
      return { ok: true };
    },
    'POST /api/logout': ({ token, res }) => {
      if (token) game.signOut(token);
      res.setHeader('Set-Cookie', cookie('', 0));
      return { ok: true };
    },

    // ---- players ----
    'GET /api/me': ({ actor }) => game.meView(need(actor)),
    'GET /api/role': ({ actor }) => game.roleView(need(actor)),
    'POST /api/register': ({ actor, body }) => (game.register(need(actor), body), { ok: true }),
    'POST /api/missions/submit': ({ actor, body }) => game.submitMission(need(actor), Number(body.missionId), body),
    'POST /api/vote': ({ actor, body }) => (game.castVote(need(actor), Number(body.targetId), { useDagger: !!body.useDagger }), { ok: true }),
    'POST /api/end-vote': ({ actor, body }) => (game.endVote(need(actor), body.choice), { ok: true }),
    'POST /api/opt-out': ({ actor }) => (game.optOut(need(actor)), { ok: true }),
    'POST /api/away': ({ actor, body }) => (game.setAway(need(actor), body.playerId ?? actor?.id, !!body.away), { ok: true }),
    'POST /api/concern': ({ actor, body }) => (game.reportConcern(need(actor), body.text), { ok: true }),
    'POST /api/recruit/answer': ({ actor, body }) => (game.answerRecruit(need(actor), !!body.accept), { ok: true }),
    'GET /api/story': () => game.seasonStory(),

    // ---- traitors ----
    'GET /api/hideout': ({ actor }) => game.hideoutView(need(actor)),
    'POST /api/hideout/vote': ({ actor, body }) => (game.traitorVote(need(actor), Number(body.targetId)), { ok: true }),
    'POST /api/hideout/message': ({ actor, body }) => (game.postHideout(need(actor), body.text), { ok: true }),
    'POST /api/hideout/sabotage': ({ actor, body }) => (game.sabotage(need(actor), Number(body.missionId)), { ok: true }),
    'POST /api/hideout/recruit': ({ actor, body }) => (game.offerRecruit(need(actor), Number(body.targetId)), { ok: true }),

    // ---- Game Master and principal sponsor ----
    'GET /api/admin': ({ actor }) => game.dashboardView(need(actor)),
    'POST /api/admin/season': ({ actor, body }) => (game.saveSeason(need(actor), body), { ok: true }),
    'POST /api/admin/checklist': ({ actor, body }) => (game.setChecklist(need(actor), body.key, body.value), { ok: true }),
    'POST /api/admin/approve': ({ actor }) => (game.approveSeason(need(actor)), { ok: true }),
    'POST /api/admin/open-registration': ({ actor }) => (game.openRegistration(need(actor)), { ok: true }),
    'POST /api/admin/people': ({ actor, body }) => ({
      codes: game.addPeople(need(actor), String(body.emails || '').split(/[\s,;]+/), { kind: body.kind, evaluator: !!body.evaluator }),
    }),
    'POST /api/admin/new-code': ({ actor, body }) => {
      game.requireKind(need(actor), ['gm']);
      const r = game.requestCode(body.email || '');
      if (!r) throw new GameError('That address is not on the list.');
      return { email: r.email, code: r.code };
    },
    'POST /api/admin/cast': ({ actor }) => game.castRoles(need(actor)),
    'POST /api/admin/pause': ({ actor, body }) => (game.setPaused(need(actor), !!body.paused), { ok: true }),
    'POST /api/admin/missions': ({ actor, body }) => ({ id: game.saveMission(need(actor), body) }),
    'POST /api/admin/missions/update': ({ actor, body }) => ({ id: game.updateMission(need(actor), Number(body.id), body) }),
    'POST /api/admin/missions/starter': ({ actor }) => ({ added: game.loadStarterMissions(need(actor), STARTER_MISSIONS) }),
    'POST /api/admin/missions/week-plan': ({ actor }) => game.loadWeekPlan(need(actor), STARTER_MISSIONS, ONE_WEEK_PLAN),
    'POST /api/admin/missions/open-day': ({ actor, body }) => game.openPlannedDay(need(actor), body.day, { force: !!body.force }),
    'POST /api/admin/missions/status': ({ actor, body }) =>
      (game.setMissionStatus(need(actor), Number(body.id), body.status, { force: !!body.force }), { ok: true }),
    'POST /api/admin/review': ({ actor, body }) => (game.reviewSubmission(need(actor), Number(body.id), !!body.approve, body.reason), { ok: true }),
    'POST /api/admin/round/start': ({ actor, body }) => ({ number: game.startRound(need(actor), { force: !!body.force }) }),
    'POST /api/admin/round/murder': ({ actor, body }) => game.resolveMurder(need(actor), { force: !!body.force }),
    'POST /api/admin/round/open-vote': ({ actor, body }) => (game.openVote(need(actor), { force: !!body.force }), { ok: true }),
    'POST /api/admin/round/close-vote': ({ actor }) => game.closeVote(need(actor)),
    'POST /api/admin/round/close-end-vote': ({ actor }) => game.closeEndVote(need(actor)),
    'POST /api/admin/left': ({ actor, body }) => (game.markLeft(need(actor), Number(body.playerId)), { ok: true }),
    'POST /api/admin/concern/resolve': ({ actor, body }) => (game.resolveConcern(need(actor), Number(body.id)), { ok: true }),
    'POST /api/admin/end-season': ({ actor }) => ({ winner: game.endSeasonNow(need(actor)) }),
    'GET /api/admin/export': ({ actor }) => game.exportData(need(actor)),
    'POST /api/admin/purge': ({ actor, body }) => {
      if (body.confirm !== 'DELETE') throw new GameError('Type DELETE to confirm.');
      game.purge(need(actor));
      return { ok: true };
    },
  };

  const cookie = (value, maxAge) =>
    `st_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;
  const need = (actor) => {
    if (!actor) throw new GameError('Please sign in.', 401);
    return actor;
  };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (url.pathname.startsWith('/api/')) {
        const handler = routes[`${req.method} ${url.pathname}`];
        if (!handler) return send(res, 404, { error: 'Not found.' });
        if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Blocked request from another site.' });
        const body = req.method === 'POST' ? await readJson(req) : {};
        const token = parseCookies(req.headers.cookie).st_session;
        const actor = game.playerFromToken(token);
        const ip = req.socket.remoteAddress;
        const out = handler({ body, actor, token, ip, res });
        return send(res, 200, out);
      }
      return serveStatic(url.pathname, res);
    } catch (e) {
      if (e instanceof GameError) return send(res, e.status, { error: e.message });
      if (e.message === 'too_big') return send(res, 413, { error: 'That upload is too large.' });
      log(e);
      return send(res, 500, { error: 'Something went wrong on the server.' });
    }
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 3_500_000) {
        reject(new Error('too_big'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new GameError('Bad request.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

function serveStatic(pathname, res) {
  const clean = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC, path.normalize(clean).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  });
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const game = new Game(openDb(DB_FILE));
  const firstCode = game.bootstrapGameMaster(GM_EMAIL);
  if (firstCode) {
    console.log(`\nGame Master account created for ${GM_EMAIL}`);
    console.log(`Sign in at /admin.html with that address and this one-time code: ${firstCode}\n`);
  }
  createServer(game).listen(PORT, () => console.log(`Staff Traitors is running at http://localhost:${PORT}`));
}
