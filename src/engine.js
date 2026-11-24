// Game engine: every rule of the game lives here, on top of a SQLite database.
// The web server is a thin layer over this file, and the tests and the season
// simulation call it directly.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const DEFAULT_CONFIG = {
  timeZone: 'America/Chicago',
  emailDomain: '', // for example "school.org"; empty means any address on the allow list
  traitorCount: null, // null means about one per nine players, minimum 2, maximum 5
  evaluatorsFaithfulOnly: true,
  sealed: false, // true hides roles from the Game Master until the season ends
  revealMode: 'totals', // "totals" or "names"
  recruitment: true,
  shields: true,
  daggers: false,
  endgameAt: 5,
  murdersPerRound: 1, // one-week game: 1 for about 15 players, 2 for 18 to 20 (see the readme)
  correctVotePoints: 10,
  survivalPoints: 5,
  quietBefore: '06:30',
  quietAfter: '20:00',
  bellSchedule: [
    { start: '07:50', end: '08:40' },
    { start: '08:45', end: '09:35' },
    { start: '09:40', end: '10:30' },
    { start: '10:35', end: '11:25' },
    { start: '12:05', end: '12:55' },
    { start: '13:00', end: '13:50' },
    { start: '13:55', end: '14:45' },
  ],
  departments: [
    'English', 'Math', 'Science', 'Social Studies', 'Fine Arts', 'World Languages',
    'Career and Technical Education', 'Special Education', 'Athletics', 'Counseling',
    'Front Office', 'Custodial and Facilities', 'Food Service', 'Administration', 'Other',
  ],
  checklist: {
    principalApproved: false,
    staffAssociationTold: false,
    technologyOfficeOk: false,
    noSchoolSystemsConnected: false,
  },
};

export const CHECKLIST_LABELS = {
  principalApproved: 'Principal approved the season in the app',
  staffAssociationTold: 'Staff association or union representative told (if the campus has one)',
  technologyOfficeOk: 'District technology office says staff may use this app on personal phones',
  noSchoolSystemsConnected: 'No district, student or school-issued system is connected to the game',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS season (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, approved, registration, active, ended
  paused INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  approved_by INTEGER,
  approved_at TEXT,
  seed TEXT,
  seed_hash TEXT,
  pot INTEGER NOT NULL DEFAULT 0,
  winner TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blackout_dates (
  date TEXT PRIMARY KEY,
  label TEXT
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'player', -- player, gm, sponsor
  is_evaluator INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  department TEXT,
  lunch TEXT,
  status TEXT NOT NULL DEFAULT 'invited', -- invited, active, murdered, banished, ghost, left
  away INTEGER NOT NULL DEFAULT 0,
  late INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  consents TEXT,
  out_round INTEGER,
  joined_at TEXT
);
CREATE TABLE IF NOT EXISTS login_codes (
  code_hash TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('faithful', 'traitor')),
  recruited INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'individual', -- individual, pair, department, staff, kindness, puzzle
  check_method TEXT NOT NULL DEFAULT 'manual', -- code, quiz, photo, manual
  answer TEXT,
  reward INTEGER NOT NULL DEFAULT 100,
  awards_shield INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, open, closed
  sabotaged INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  plan_day INTEGER, -- school day of the week plan it opens on (1 is Monday)
  plan_last_day INTEGER -- last school day it stays open
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  answer TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  reason TEXT,
  reward_given INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (mission_id, player_id)
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  phase TEXT NOT NULL, -- murder, day, vote, revote, endcheck, done
  endgame INTEGER NOT NULL DEFAULT 0,
  murder_victim INTEGER,
  murder_result TEXT, -- murdered, shielded, none
  banished_id INTEGER,
  tie_ids TEXT,
  result TEXT,
  sabotage_used INTEGER NOT NULL DEFAULT 0,
  recruit_open INTEGER NOT NULL DEFAULT 0,
  recruit_target INTEGER,
  recruit_status TEXT,
  vote_date TEXT, -- the school day this round's roundtable met
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS traitor_votes (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  traitor_id INTEGER NOT NULL REFERENCES players(id),
  target_id INTEGER NOT NULL REFERENCES players(id),
  PRIMARY KEY (round_id, traitor_id)
);
CREATE TABLE IF NOT EXISTS votes (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  stage INTEGER NOT NULL,
  voter_id INTEGER NOT NULL REFERENCES players(id),
  target_id INTEGER NOT NULL REFERENCES players(id),
  weight INTEGER NOT NULL DEFAULT 1,
  CHECK (voter_id <> target_id),
  PRIMARY KEY (round_id, stage, voter_id)
);
CREATE TABLE IF NOT EXISTS end_votes (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  voter_id INTEGER NOT NULL REFERENCES players(id),
  choice TEXT NOT NULL CHECK (choice IN ('end', 'continue')),
  PRIMARY KEY (round_id, voter_id)
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('shield', 'dagger')),
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pot_ledger (
  id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hideout_messages (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS concerns (
  id INTEGER PRIMARY KEY,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  deliver_after TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`;

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Databases made by the first version lack these columns.
  const addColumn = (table, column, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };
  addColumn('rounds', 'vote_date', 'TEXT');
  addColumn('missions', 'plan_day', 'INTEGER');
  addColumn('missions', 'plan_last_day', 'INTEGER');
  return db;
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Deterministic random numbers from a seed, so the role draw can be checked
// after the season by anyone holding the revealed seed.
export function makeRng(seedHex) {
  let counter = 0;
  let buf = Buffer.alloc(0);
  const next32 = () => {
    if (buf.length < 4) buf = crypto.createHash('sha256').update(`${seedHex}:${counter++}`).digest();
    const v = buf.readUInt32BE(0);
    buf = buf.subarray(4);
    return v;
  };
  return {
    int(n) {
      const limit = Math.floor(0x100000000 / n) * n;
      let v;
      do v = next32(); while (v >= limit);
      return v % n;
    },
  };
}

const secureRng = { int: (n) => crypto.randomInt(n) };

export function localParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Quiet hours: weekends, before the morning start, after the evening cutoff
// and during any class period on the bell schedule.
export function isQuietTime(date, config) {
  const p = localParts(date, config.timeZone);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return true;
  const mins = p.hour * 60 + p.minute;
  if (mins >= toMinutes(config.quietAfter) || mins < toMinutes(config.quietBefore)) return true;
  return (config.bellSchedule || []).some((b) => mins >= toMinutes(b.start) && mins < toMinutes(b.end));
}

export function nextOpenTime(date, config) {
  let t = new Date(Math.ceil(date.getTime() / 60000) * 60000);
  for (let i = 0; i < 60 * 24 * 8; i++) {
    if (!isQuietTime(t, config)) return t;
    t = new Date(t.getTime() + 60000);
  }
  return t;
}

export function gameDayProblem(date, season, blackouts) {
  const p = localParts(date, season.config.timeZone);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'Weekends are off.';
  if (p.date < season.start_date || p.date > season.end_date) return 'Today is outside the season dates.';
  const b = blackouts.find((x) => x.date === p.date);
  if (b) return `Today is a blackout date${b.label ? ` (${b.label})` : ''}.`;
  return null;
}

// Pick traitors with department balancing: each pick comes from a department
// that has the fewest traitors so far.
export function chooseTraitors(eligible, count, rng) {
  const byDept = new Map();
  for (const p of [...eligible].sort((a, b) => a.id - b.id)) {
    const d = p.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(p);
  }
  const picked = [];
  const taken = new Map();
  for (let i = 0; i < count; i++) {
    const open = [...byDept.entries()].filter(([, list]) => list.length > 0);
    if (!open.length) break;
    const fewest = Math.min(...open.map(([d]) => taken.get(d) || 0));
    // Weight departments by how many eligible people they have, among those with the fewest traitors.
    const pool = open.filter(([d]) => (taken.get(d) || 0) === fewest).flatMap(([, list]) => list);
    const choice = pool[rng.int(pool.length)];
    const d = choice.department || 'Other';
    byDept.set(d, byDept.get(d).filter((p) => p.id !== choice.id));
    taken.set(d, (taken.get(d) || 0) + 1);
    picked.push(choice);
  }
  return picked;
}

export function defaultTraitorCount(n) {
  return Math.max(2, Math.min(5, Math.round(n / 9)));
}

// Count weighted votes. Returns the leaders and the full count.
export function tally(votes) {
  const counts = new Map();
  for (const v of votes) counts.set(v.target_id, (counts.get(v.target_id) || 0) + (v.weight || 1));
  let max = 0;
  for (const c of counts.values()) max = Math.max(max, c);
  const leaders = max === 0 ? [] : [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);
  return { counts: Object.fromEntries(counts), leaders, max };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}
const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const ALIVE = 'active';

export class Game {
  constructor(db, { clock = () => new Date(), rng = secureRng } = {}) {
    this.db = db;
    this.clock = clock;
    this.rng = rng;
  }

  // ---------- small helpers ----------
  get(sql, ...a) { return this.db.prepare(sql).get(...a); }
  all(sql, ...a) { return this.db.prepare(sql).all(...a); }
  run(sql, ...a) { return this.db.prepare(sql).run(...a); }
  now() { return this.clock(); }
  iso() { return this.now().toISOString(); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  season() {
    const s = this.get('SELECT * FROM season WHERE id = 1');
    if (!s) return null;
    const saved = JSON.parse(s.config || '{}');
    s.config = { ...DEFAULT_CONFIG, ...saved, checklist: { ...DEFAULT_CONFIG.checklist, ...(saved.checklist || {}) } };
    return s;
  }
  requireSeason() {
    const s = this.season();
    if (!s) throw new GameError('No season has been set up yet.');
    return s;
  }
  requireRunning() {
    const s = this.requireSeason();
    if (s.paused) throw new GameError('The game is paused right now.');
    return s;
  }
  blackouts() { return this.all('SELECT date, label FROM blackout_dates ORDER BY date'); }
  requireGameDay(season, force) {
    if (force) return;
    const problem = gameDayProblem(this.now(), season, this.blackouts());
    if (problem) throw new GameError(`${problem} Nothing in the game runs today.`);
  }

  player(id) { return this.get('SELECT * FROM players WHERE id = ?', id); }
  roleOf(id) { return this.get('SELECT role FROM roles WHERE player_id = ?', id)?.role || null; }
  alivePlayers() {
    return this.all(`SELECT p.*, r.role FROM players p LEFT JOIN roles r ON r.player_id = p.id
                     WHERE p.kind = 'player' AND p.status = ? ORDER BY p.display_name`, ALIVE);
  }
  aliveCounts() {
    const alive = this.alivePlayers();
    const traitors = alive.filter((p) => p.role === 'traitor').length;
    return { alive: alive.length, traitors, faithful: alive.length - traitors };
  }

  audit(actorId, action, detail) {
    this.run('INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?, ?, ?, ?)',
      actorId ?? null, action, detail ? JSON.stringify(detail) : null, this.iso());
  }
  announce(text) {
    this.run('INSERT INTO announcements (text, created_at) VALUES (?, ?)', text, this.iso());
  }
  // A personal notice. It is held until the next minute outside quiet hours.
  notify(playerId, text) {
    const s = this.season();
    const config = s ? s.config : DEFAULT_CONFIG;
    const after = nextOpenTime(this.now(), config).toISOString();
    this.run('INSERT INTO outbox (player_id, text, deliver_after) VALUES (?, ?, ?)', playerId, text, after);
  }
  addToPot(amount, reason) {
    if (!amount) return;
    this.run('INSERT INTO pot_ledger (amount, reason, created_at) VALUES (?, ?, ?)', amount, reason, this.iso());
    this.run('UPDATE season SET pot = pot + ? WHERE id = 1', amount);
  }

  // ---------- accounts and sign in ----------
  bootstrapGameMaster(email) {
    const existing = this.get("SELECT * FROM players WHERE kind = 'gm' LIMIT 1");
    if (existing) return null;
    const r = this.run("INSERT INTO players (email, kind, display_name, status) VALUES (?, 'gm', 'Game Master', 'active')",
      email.toLowerCase());
    return this.issueCode(Number(r.lastInsertRowid), 60 * 24 * 7);
  }

  issueCode(playerId, ttlMinutes = 60 * 24 * 14) {
    const code = newCode();
    const expires = new Date(this.now().getTime() + ttlMinutes * 60000).toISOString();
    this.run('INSERT INTO login_codes (code_hash, player_id, expires_at) VALUES (?, ?, ?)', sha256(code), playerId, expires);
    return code;
  }

  addPeople(actor, emails, { kind = 'player', evaluator = false } = {}) {
    this.requireKind(actor, ['gm']);
    if (!['player', 'sponsor'].includes(kind)) throw new GameError('Unknown kind of person.');
    const s = this.season();
    const domain = s?.config.emailDomain?.toLowerCase();
    const out = [];
    this.tx(() => {
      for (const raw of emails) {
        const email = String(raw).trim().toLowerCase();
        if (!email) continue;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new GameError(`Not an email address: ${email}`);
        if (domain && !email.endsWith(`@${domain}`)) throw new GameError(`Only ${domain} addresses can join: ${email}`);
        let p = this.get('SELECT * FROM players WHERE email = ?', email);
        if (!p) {
          const r = this.run('INSERT INTO players (email, kind, is_evaluator) VALUES (?, ?, ?)', email, kind, evaluator ? 1 : 0);
          p = this.player(Number(r.lastInsertRowid));
        }
        out.push({ email, code: this.issueCode(p.id) });
      }
      this.audit(actor.id, 'add_people', { count: out.length, kind, evaluator });
    });
    return out;
  }

  // A fresh sign-in code for someone already on the allow list (for printing,
  // or for an email sender once one is set up). Unknown addresses get nothing.
  requestCode(email) {
    const p = this.get('SELECT * FROM players WHERE email = ?', String(email).trim().toLowerCase());
    if (!p || p.status === 'left') return null;
    return { playerId: p.id, email: p.email, code: this.issueCode(p.id, 30) };
  }

  signIn(email, code) {
    const p = this.get('SELECT * FROM players WHERE email = ?', String(email).trim().toLowerCase());
    const bad = new GameError('That email and code do not match. Ask the Game Master for a new code.', 401);
    if (!p) throw bad;
    const row = this.get('SELECT * FROM login_codes WHERE code_hash = ? AND player_id = ?',
      sha256(String(code).trim().toUpperCase()), p.id);
    if (!row || row.used || row.expires_at < this.iso()) throw bad;
    const token = crypto.randomBytes(32).toString('base64url');
    this.tx(() => {
      this.run('UPDATE login_codes SET used = 1 WHERE code_hash = ?', row.code_hash);
      // One device at a time: signing in ends any other session.
      this.run('DELETE FROM sessions WHERE player_id = ?', p.id);
      this.run('INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)', sha256(token), p.id, this.iso());
    });
    return token;
  }
  playerFromToken(token) {
    if (!token) return null;
    const row = this.get('SELECT player_id FROM sessions WHERE token_hash = ?', sha256(token));
    return row ? this.player(row.player_id) : null;
  }
  signOut(token) { this.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token)); }

  requireKind(actor, kinds) {
    if (!actor || !kinds.includes(actor.kind)) throw new GameError('You do not have access to that.', 403);
  }

  // ---------- season setup ----------
  saveSeason(actor, { name, startDate, endDate, blackouts = [], config = {} }) {
    this.requireKind(actor, ['gm']);
    const s = this.season();
    if (s && s.status !== 'draft') throw new GameError('The season can only be edited before the principal approves it.');
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
      throw new GameError('Give the season a name, a start date and an end date after it.');
    }
    const allowed = Object.keys(DEFAULT_CONFIG);
    const clean = Object.fromEntries(Object.entries(config).filter(([k]) => allowed.includes(k) && k !== 'checklist'));
    const merged = { ...(s ? JSON.parse(this.get('SELECT config FROM season WHERE id = 1').config) : {}), ...clean };
    this.tx(() => {
      if (s) {
        this.run('UPDATE season SET name = ?, start_date = ?, end_date = ?, config = ? WHERE id = 1',
          name, startDate, endDate, JSON.stringify(merged));
      } else {
        this.run('INSERT INTO season (id, name, start_date, end_date, config, created_at) VALUES (1, ?, ?, ?, ?, ?)',
          name, startDate, endDate, JSON.stringify(merged), this.iso());
      }
      this.run('DELETE FROM blackout_dates');
      for (const b of blackouts) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new GameError(`Blackout date is not a date: ${b.date}`);
        this.run('INSERT OR REPLACE INTO blackout_dates (date, label) VALUES (?, ?)', b.date, b.label || null);
      }
      this.audit(actor.id, 'save_season', { name, startDate, endDate, blackouts: blackouts.length });
    });
    return this.season();
  }

  setChecklist(actor, key, value) {
    this.requireKind(actor, ['gm']);
    const s = this.requireSeason();
    if (!(key in DEFAULT_CONFIG.checklist) || key === 'principalApproved') throw new GameError('Unknown checklist item.');
    const config = JSON.parse(this.get('SELECT config FROM season WHERE id = 1').config);
    config.checklist = { ...(config.checklist || {}), [key]: !!value };
    this.run('UPDATE season SET config = ? WHERE id = 1', JSON.stringify(config));
    this.audit(actor.id, 'checklist', { key, value: !!value });
    return s;
  }

  approveSeason(actor) {
    this.requireKind(actor, ['sponsor']);
    const s = this.requireSeason();
    if (s.status !== 'draft') throw new GameError('This season is already approved.');
    const config = JSON.parse(this.get('SELECT config FROM season WHERE id = 1').config);
    config.checklist = { ...(config.checklist || {}), principalApproved: true };
    this.run("UPDATE season SET status = 'approved', approved_by = ?, approved_at = ?, config = ? WHERE id = 1",
      actor.id, this.iso(), JSON.stringify(config));
    this.audit(actor.id, 'approve_season', null);
  }

  openRegistration(actor) {
    this.requireKind(actor, ['gm']);
    const s = this.requireSeason();
    if (s.status !== 'approved') throw new GameError('The principal sponsor has to approve the season first.');
    const missing = Object.entries(s.config.checklist).filter(([, v]) => !v).map(([k]) => CHECKLIST_LABELS[k]);
    if (missing.length) throw new GameError(`Finish the setup checklist first: ${missing.join('; ')}.`);
    this.run("UPDATE season SET status = 'registration' WHERE id = 1");
    this.announce('Registration is open. Sign up any time before roles are cast.');
    this.audit(actor.id, 'open_registration', null);
  }

  register(actor, { displayName, department, lunch, consents = {} }) {
    this.requireKind(actor, ['player']);
    const s = this.requireRunning();
    if (!['registration', 'active'].includes(s.status)) throw new GameError('Registration is not open.');
    if (actor.status !== 'invited') throw new GameError('You are already registered.');
    const needed = ['voluntary', 'optOut', 'noClassTime', 'conduct'];
    if (!needed.every((k) => consents[k] === true)) throw new GameError('Please tick all four boxes to join.');
    const name = String(displayName || '').trim().slice(0, 40);
    if (!name) throw new GameError('Choose a display name.');
    if (!s.config.departments.includes(department)) throw new GameError('Choose your department from the list.');
    const late = s.status === 'active' ? 1 : 0;
    this.tx(() => {
      this.run(`UPDATE players SET display_name = ?, department = ?, lunch = ?, status = 'active', late = ?,
                consents = ?, joined_at = ? WHERE id = ?`,
        name, department, lunch ? String(lunch).slice(0, 20) : null, late, JSON.stringify(consents), this.iso(), actor.id);
      if (late) {
        this.run("INSERT INTO roles (player_id, role) VALUES (?, 'faithful')", actor.id);
        this.notify(actor.id, 'Your role is ready.');
      }
      this.audit(actor.id, 'register', { department, late: !!late });
    });
  }

  castRoles(actor) {
    this.requireKind(actor, ['gm']);
    const s = this.requireRunning();
    if (s.status !== 'registration') throw new GameError('Roles can only be cast once, when registration is open.');
    const players = this.all("SELECT * FROM players WHERE kind = 'player' AND status = 'active'");
    if (players.length < 6) throw new GameError('At least 6 registered players are needed.');
    const eligible = s.config.evaluatorsFaithfulOnly ? players.filter((p) => !p.is_evaluator) : players;
    const count = Math.min(s.config.traitorCount || defaultTraitorCount(players.length), Math.floor(players.length / 3));
    if (eligible.length < count) throw new GameError('Not enough people can be Traitors with these settings.');
    const seed = crypto.randomBytes(32).toString('hex');
    const traitors = new Set(chooseTraitors(eligible, count, makeRng(seed)).map((p) => p.id));
    this.tx(() => {
      for (const p of players) {
        this.run('INSERT INTO roles (player_id, role) VALUES (?, ?)', p.id, traitors.has(p.id) ? 'traitor' : 'faithful');
        this.notify(p.id, 'Your role is ready.');
      }
      this.run("UPDATE season SET status = 'active', seed = ?, seed_hash = ? WHERE id = 1", seed, sha256(seed));
      this.announce(`Roles are cast. ${count} Traitors walk among ${players.length} players. Open My Role in private.`);
      this.audit(actor.id, 'cast_roles', { players: players.length, traitors: count, seedHash: sha256(seed) });
    });
    return { players: players.length, traitors: count };
  }

  setPaused(actor, paused) {
    this.requireKind(actor, ['gm', 'sponsor']);
    this.requireSeason();
    this.run('UPDATE season SET paused = ? WHERE id = 1', paused ? 1 : 0);
    this.announce(paused
      ? 'The game is paused. Nothing happens until it starts again. Thank you for your patience.'
      : 'The game is back on.');
    this.audit(actor.id, paused ? 'pause' : 'resume', null);
  }

  // ---------- leaving, away, concerns ----------
  optOut(actor) {
    this.requireKind(actor, ['player']);
    if (actor.status !== ALIVE && actor.status !== 'invited') throw new GameError('You are already out of the game.');
    const round = this.currentRound();
    this.tx(() => {
      this.run("UPDATE players SET status = 'ghost', out_round = ? WHERE id = ?", round?.number ?? null, actor.id);
      this.audit(actor.id, 'opt_out', null);
      if (this.roleOf(actor.id) === 'traitor') {
        this.run('INSERT INTO concerns (player_id, text, created_at) VALUES (NULL, ?, ?)',
          'A Traitor opted out. Check the balance of the game.', this.iso());
      }
      this.checkWin();
    });
  }

  setAway(actor, playerId, away) {
    const target = this.player(playerId);
    if (!target || target.kind !== 'player') throw new GameError('No such player.');
    if (actor.id !== target.id) this.requireKind(actor, ['gm']);
    this.run('UPDATE players SET away = ? WHERE id = ?', away ? 1 : 0, target.id);
    this.audit(actor.id, 'set_away', { playerId, away: !!away });
  }

  markLeft(actor, playerId) {
    this.requireKind(actor, ['gm']);
    const target = this.player(playerId);
    if (!target || target.kind !== 'player') throw new GameError('No such player.');
    const round = this.currentRound();
    this.tx(() => {
      this.run("UPDATE players SET status = 'left', out_round = ? WHERE id = ?", round?.number ?? null, target.id);
      this.run('DELETE FROM sessions WHERE player_id = ?', target.id);
      this.announce(`${target.display_name || 'A player'} has left the game.`);
      this.audit(actor.id, 'mark_left', { playerId });
      this.checkWin();
    });
  }

  reportConcern(actor, text) {
    const t = String(text || '').trim().slice(0, 2000);
    if (!t) throw new GameError('Write what is worrying you.');
    this.run('INSERT INTO concerns (player_id, text, created_at) VALUES (?, ?, ?)', actor.id, t, this.iso());
  }
  resolveConcern(actor, id) {
    this.requireKind(actor, ['gm', 'sponsor']);
    this.run('UPDATE concerns SET resolved = 1 WHERE id = ?', id);
    this.audit(actor.id, 'resolve_concern', { id });
  }

  // ---------- missions ----------
  saveMission(actor, m) {
    this.requireKind(actor, ['gm']);
    const kinds = ['individual', 'pair', 'department', 'staff', 'kindness', 'puzzle'];
    const methods = ['code', 'quiz', 'photo', 'manual'];
    if (!m.title || !m.description) throw new GameError('A mission needs a title and a description.');
    if (!kinds.includes(m.kind || 'individual')) throw new GameError('Unknown mission kind.');
    if (!methods.includes(m.checkMethod || 'manual')) throw new GameError('Unknown check-in method.');
    if (['code', 'quiz'].includes(m.checkMethod) && !m.answer) throw new GameError('Code and quiz missions need an answer.');
    const reward = Math.max(0, Math.min(10000, Number(m.reward ?? 100) | 0));
    const r = this.run(`INSERT INTO missions (title, description, kind, check_method, answer, reward, awards_shield)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      m.title, m.description, m.kind || 'individual', m.checkMethod || 'manual', m.answer || null, reward, m.awardsShield ? 1 : 0);
    this.audit(actor.id, 'save_mission', { id: Number(r.lastInsertRowid), title: m.title });
    return Number(r.lastInsertRowid);
  }

  updateMission(actor, id, m) {
    this.requireKind(actor, ['gm']);
    const cur = this.get('SELECT * FROM missions WHERE id = ?', id);
    if (!cur) throw new GameError('No such mission.');
    if (cur.status !== 'draft') throw new GameError('Only draft missions can be edited.');
    this.run('DELETE FROM missions WHERE id = ?', id);
    const newId = this.saveMission(actor, {
      title: m.title ?? cur.title, description: m.description ?? cur.description, kind: m.kind ?? cur.kind,
      checkMethod: m.checkMethod ?? cur.check_method, answer: m.answer ?? cur.answer, reward: m.reward ?? cur.reward,
      awardsShield: m.awardsShield ?? !!cur.awards_shield,
    });
    return newId;
  }

  loadStarterMissions(actor, list) {
    this.requireKind(actor, ['gm']);
    if (this.get('SELECT COUNT(*) n FROM missions').n > 0) throw new GameError('The mission library already has missions.');
    this.tx(() => { for (const m of list) this.saveMission(actor, m); });
    return list.length;
  }

  // Loads the one-week plan: each mission gets the school day it opens and the
  // last day it stays open. Missions already in the library keep their edits and
  // only get their days; missing ones are added as drafts.
  loadWeekPlan(actor, library, plan) {
    this.requireKind(actor, ['gm']);
    const byTitle = new Map(library.map((m) => [m.title, m]));
    let added = 0;
    this.tx(() => {
      for (const p of plan) {
        let row = this.get('SELECT id FROM missions WHERE title = ?', p.title);
        if (!row) {
          const m = byTitle.get(p.title);
          if (!m) throw new GameError(`The week plan names a mission that is not in the library: ${p.title}`);
          row = { id: this.saveMission(actor, m) };
          added++;
        }
        this.run('UPDATE missions SET plan_day = ?, plan_last_day = ? WHERE id = ?', p.day, p.lastDay ?? p.day, row.id);
      }
    });
    this.audit(actor.id, 'load_week_plan', { planned: plan.length, added });
    return { planned: plan.length, added };
  }

  // Which school day of the season today is: 1 on the first game day, counting
  // only days the game runs (no weekends or blackout dates).
  schoolDayNumber(s = this.season()) {
    const today = localParts(this.now(), s.config.timeZone).date;
    const off = new Set(this.blackouts().map((b) => b.date));
    let n = 0;
    for (let d = new Date(`${s.start_date}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (key > today) break;
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6 && !off.has(key)) n++;
    }
    return n;
  }

  // Opens the planned missions for a school day and closes the ones whose last
  // day has passed. Missions still marked EDIT ME stay closed and are listed.
  openPlannedDay(actor, day, { force = false } = {}) {
    this.requireKind(actor, ['gm']);
    const s = this.requireRunning();
    if (s.status !== 'active') throw new GameError('Missions open once roles are cast.');
    this.requireGameDay(s, force);
    const n = Number(day) || this.schoolDayNumber(s);
    if (n < 1) throw new GameError('The season has not started yet.');
    const opened = [];
    const needAnswer = [];
    const closed = [];
    this.tx(() => {
      for (const m of this.all("SELECT * FROM missions WHERE status = 'open' AND plan_last_day IS NOT NULL AND plan_last_day < ?", n)) {
        this.run("UPDATE missions SET status = 'closed' WHERE id = ?", m.id);
        closed.push(m.title);
      }
      for (const m of this.all("SELECT * FROM missions WHERE status = 'draft' AND plan_day = ? ORDER BY id", n)) {
        if (m.answer === 'EDIT ME') { needAnswer.push(m.title); continue; }
        this.run("UPDATE missions SET status = 'open', opened_at = COALESCE(opened_at, ?) WHERE id = ?", this.iso(), m.id);
        opened.push(m.title);
      }
    });
    if (opened.length) this.announce(`Day ${n} missions are open: ${opened.join(', ')}.`);
    this.audit(actor.id, 'open_planned_day', { day: n, opened, closed, needAnswer, force });
    return { day: n, opened, closed, needAnswer };
  }

  setMissionStatus(actor, id, status, { force = false } = {}) {
    this.requireKind(actor, ['gm']);
    const s = this.requireRunning();
    if (!['open', 'closed'].includes(status)) throw new GameError('Unknown mission status.');
    const m = this.get('SELECT * FROM missions WHERE id = ?', id);
    if (!m) throw new GameError('No such mission.');
    if (status === 'open') {
      if (s.status !== 'active') throw new GameError('Missions open once roles are cast.');
      if (m.answer === 'EDIT ME') throw new GameError('Set this mission\'s answer before opening it.');
      this.requireGameDay(s, force);
    }
    this.run('UPDATE missions SET status = ?, opened_at = COALESCE(opened_at, ?) WHERE id = ?', status, this.iso(), id);
    if (status === 'open') this.announce(`New mission: ${m.title}`);
    this.audit(actor.id, `mission_${status}`, { id, force });
  }

  submitMission(actor, missionId, { answer, photo } = {}) {
    this.requireKind(actor, ['player']);
    this.requireRunning();
    const m = this.get('SELECT * FROM missions WHERE id = ?', missionId);
    if (!m || m.status !== 'open') throw new GameError('That mission is not open.');
    const alive = actor.status === ALIVE;
    const ghostOk = ['murdered', 'banished', 'ghost'].includes(actor.status) && m.kind === 'kindness';
    if (!alive && !ghostOk) throw new GameError('Ghosts can only do kindness missions.');
    if (photo && (typeof photo !== 'string' || !photo.startsWith('data:image/') || photo.length > 2_800_000)) {
      throw new GameError('Photos must be an image under about 2 megabytes.');
    }
    const prior = this.get('SELECT * FROM submissions WHERE mission_id = ? AND player_id = ?', missionId, actor.id);
    if (prior && prior.status !== 'rejected') throw new GameError('You already turned this mission in.');
    let status = 'pending';
    let reason = null;
    if (['code', 'quiz'].includes(m.check_method)) {
      const accepted = String(m.answer).split('|').map(normalize);
      status = accepted.includes(normalize(answer)) ? 'approved' : 'rejected';
      if (status === 'rejected') reason = 'That answer is not right. You can try again.';
    } else if (m.check_method === 'photo' && !photo) {
      throw new GameError('This mission needs a photo.');
    }
    return this.tx(() => {
      if (prior) this.run('DELETE FROM submissions WHERE id = ?', prior.id);
      const r = this.run(`INSERT INTO submissions (mission_id, player_id, answer, photo, status, reason, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        missionId, actor.id, answer ? String(answer).slice(0, 500) : null, photo || null, status, reason, this.iso());
      const id = Number(r.lastInsertRowid);
      if (status === 'approved') this.award(id);
      return { id, status, reason };
    });
  }

  reviewSubmission(actor, id, approve, reason) {
    this.requireKind(actor, ['gm']);
    const sub = this.get('SELECT * FROM submissions WHERE id = ?', id);
    if (!sub || sub.status !== 'pending') throw new GameError('That submission is not waiting for review.');
    this.tx(() => {
      this.run('UPDATE submissions SET status = ?, reason = ? WHERE id = ?',
        approve ? 'approved' : 'rejected', reason ? String(reason).slice(0, 300) : null, id);
      if (approve) this.award(id);
      else this.notify(sub.player_id, `Your mission check-in was not accepted${reason ? `: ${reason}` : '.'} You can try again.`);
      this.audit(actor.id, approve ? 'approve_submission' : 'reject_submission', { id });
    });
  }

  award(submissionId) {
    const sub = this.get('SELECT * FROM submissions WHERE id = ?', submissionId);
    const m = this.get('SELECT * FROM missions WHERE id = ?', sub.mission_id);
    const reward = m.sabotaged ? Math.floor(m.reward / 2) : m.reward;
    this.run('UPDATE submissions SET reward_given = ? WHERE id = ?', reward, submissionId);
    this.run('UPDATE players SET points = points + ? WHERE id = ?', reward, sub.player_id);
    this.addToPot(reward, `Mission: ${m.title}`);
    const s = this.season();
    if (m.awards_shield && s.config.shields) {
      this.run("INSERT INTO items (player_id, kind, created_at) VALUES (?, 'shield', ?)", sub.player_id, this.iso());
      this.notify(sub.player_id, 'You earned a Shield. It protects you from one murder. Keep it secret if you like.');
    }
  }

  // ---------- rounds ----------
  currentRound() { return this.get('SELECT * FROM rounds ORDER BY number DESC LIMIT 1') || null; }
  requireRound(phases) {
    const r = this.currentRound();
    if (!r || !phases.includes(r.phase)) throw new GameError('That is not part of the game right now.');
    return r;
  }
  requireAlive(actor) {
    if (!actor || actor.kind !== 'player' || actor.status !== ALIVE) throw new GameError('Only players still in the game can do that.', 403);
  }
  requireTraitor(actor) {
    this.requireAlive(actor);
    if (this.roleOf(actor.id) !== 'traitor') throw new GameError('You do not have access to that.', 403);
  }

  startRound(actor, { force = false } = {}) {
    this.requireKind(actor, ['gm']);
    const s = this.requireRunning();
    if (s.status !== 'active') throw new GameError('The game is not running.');
    const cur = this.currentRound();
    if (cur && cur.phase !== 'done') throw new GameError('Finish the current round first.');
    this.requireGameDay(s, force);
    // The Final Roundtable starts when few players remain, or on the season's
    // last day, so the game always ends on time. It has no murder, and it can
    // run several roundtables in one day until the players vote to end.
    const today = localParts(this.now(), s.config.timeZone).date;
    const endgame = this.isFinal(s, today) ? 1 : 0;
    const number = (cur?.number || 0) + 1;
    this.run('INSERT INTO rounds (number, phase, endgame, vote_date, created_at) VALUES (?, ?, ?, ?, ?)',
      number, endgame ? 'vote' : 'murder', endgame, endgame ? today : null, this.iso());
    this.announce(endgame
      ? `Round ${number}: the Final Roundtable. No more murders. Vote carefully.`
      : `Round ${number} has begun. The Traitors are choosing.`);
    this.audit(actor.id, 'start_round', { number, endgame: !!endgame, force });
    return number;
  }

  traitorVote(actor, targetId) {
    this.requireRunning();
    this.requireTraitor(actor);
    const r = this.requireRound(['murder']);
    const target = this.player(targetId);
    if (!target || target.kind !== 'player' || target.status !== ALIVE || this.roleOf(target.id) !== 'faithful') {
      throw new GameError('Choose a Faithful player who is still in the game.');
    }
    if (target.away) throw new GameError('That player is away and cannot be chosen this week.');
    this.run(`INSERT INTO traitor_votes (round_id, traitor_id, target_id) VALUES (?, ?, ?)
              ON CONFLICT (round_id, traitor_id) DO UPDATE SET target_id = excluded.target_id`, r.id, actor.id, target.id);
  }

  sabotage(actor, missionId) {
    this.requireRunning();
    this.requireTraitor(actor);
    const r = this.requireRound(['murder', 'day', 'vote', 'revote']);
    if (r.sabotage_used) throw new GameError('The Traitors already used this week\'s sabotage.');
    const m = this.get('SELECT * FROM missions WHERE id = ?', missionId);
    if (!m || m.status !== 'open' || !['department', 'staff', 'puzzle', 'pair'].includes(m.kind)) {
      throw new GameError('Sabotage works only on an open group mission.');
    }
    this.tx(() => {
      this.run('UPDATE rounds SET sabotage_used = 1 WHERE id = ?', r.id);
      this.run('UPDATE missions SET sabotaged = 1 WHERE id = ?', m.id);
      this.announce(`The mission "${m.title}" was sabotaged. It now pays half.`);
      this.audit(actor.id, 'sabotage', { missionId: m.id, round: r.number });
    });
  }

  resolveMurder(actor, { force = false } = {}) {
    this.requireKind(actor, ['gm']);
    const s = this.requireRunning();
    const r = this.requireRound(['murder']);
    this.requireGameDay(s, force);
    const traitorIds = new Set(this.alivePlayers().filter((p) => p.role === 'traitor').map((p) => p.id));
    const votes = this.all('SELECT * FROM traitor_votes WHERE round_id = ?', r.id).filter((v) => {
      const t = this.player(v.target_id);
      return traitorIds.has(v.traitor_id) && t.status === ALIVE && !t.away;
    });
    // The names with the most votes are murdered, up to murdersPerRound.
    // A tie at the cut-off is settled by a random draw.
    const { counts } = tally(votes);
    const wanted = Math.max(1, Math.min(5, Number(s.config.murdersPerRound) || 1));
    const ranked = Object.entries(counts).map(([id, n]) => ({ id: Number(id), n, draw: this.rng.int(1_000_000) }))
      .sort((a, b) => b.n - a.n || a.draw - b.draw);
    const targets = ranked.slice(0, wanted).map((x) => x.id);
    const outcomes = [];
    this.tx(() => {
      for (const victimId of targets) {
        const shield = this.get("SELECT * FROM items WHERE player_id = ? AND kind = 'shield' AND used = 0 LIMIT 1", victimId);
        if (shield) {
          this.run('UPDATE items SET used = 1 WHERE id = ?', shield.id);
          outcomes.push({ victimId, result: 'shielded' });
          this.notify(victimId, 'The Traitors came for you last night, and your Shield saved you.');
          for (const id of traitorIds) this.notify(id, 'One of your murders failed last night.');
        } else {
          outcomes.push({ victimId, result: 'murdered' });
          this.run("UPDATE players SET status = 'murdered', out_round = ? WHERE id = ?", r.number, victimId);
          this.notify(victimId, 'You were murdered last night. Thank you for playing. You are now a Ghost.');
        }
      }
      const killed = outcomes.filter((o) => o.result === 'murdered').map((o) => o.victimId);
      const result = killed.length ? 'murdered' : outcomes.length ? 'shielded' : 'none';
      this.run("UPDATE rounds SET phase = 'day', murder_victim = ?, murder_result = ? WHERE id = ?",
        killed[0] ?? outcomes[0]?.victimId ?? null, result, r.id);
      this.announce(killed.length
        ? `Murdered last night: ${killed.map((id) => this.player(id).display_name).join(', ')}.`
        : 'Nobody was murdered last night.');
      this.audit(actor.id, 'resolve_murder', { round: r.number, result, murdered: killed.length, force });
      this.checkWin();
    });
    const killed = outcomes.filter((o) => o.result === 'murdered').map((o) => o.victimId);
    const result = killed.length ? 'murdered' : outcomes.length ? 'shielded' : 'none';
    return { result, victimId: killed[0] ?? null, victims: killed };
  }

  isFinal(s, today) {
    return this.aliveCounts().alive <= s.config.endgameAt || today >= s.end_date;
  }

  openVote(actor, { force = false } = {}) {
    this.requireKind(actor, ['gm']);
    const s = this.requireRunning();
    const r = this.requireRound(['day', 'vote']);
    this.requireGameDay(s, force);
    if (r.phase === 'day') {
      const today = localParts(this.now(), s.config.timeZone).date;
      // One roundtable a school day. Only the Final Roundtable may meet again.
      const final = this.isFinal(s, today);
      const already = this.get('SELECT number FROM rounds WHERE vote_date = ? AND id != ?', today, r.id);
      if (already && !final && !force) {
        throw new GameError('There has already been a roundtable today. The next one is on the next school day.');
      }
      this.run("UPDATE rounds SET phase = 'vote', vote_date = ?, endgame = ? WHERE id = ?", today, final ? 1 : r.endgame, r.id);
    }
    this.announce(this.currentRound().endgame
      ? 'The Final Roundtable is open. Cast your vote.'
      : 'The roundtable is open. Cast your vote.');
    this.audit(actor.id, 'open_vote', { round: r.number, force });
  }

  castVote(actor, targetId, { useDagger = false } = {}) {
    this.requireRunning();
    this.requireAlive(actor);
    const r = this.requireRound(['vote', 'revote']);
    const stage = r.phase === 'revote' ? 2 : 1;
    if (Number(targetId) === actor.id) throw new GameError('You cannot vote for yourself.');
    const target = this.player(targetId);
    if (!target || target.kind !== 'player' || target.status !== ALIVE) throw new GameError('Vote for a player still in the game.');
    if (stage === 2 && !JSON.parse(r.tie_ids || '[]').includes(target.id)) throw new GameError('This revote is only between the tied players.');
    let weight = 1;
    const s = this.season();
    this.tx(() => {
      if (useDagger) {
        if (!s.config.daggers) throw new GameError('Daggers are off this season.');
        const d = this.get("SELECT * FROM items WHERE player_id = ? AND kind = 'dagger' AND used = 0 LIMIT 1", actor.id);
        if (!d) throw new GameError('You do not have a Dagger.');
        this.run('UPDATE items SET used = 1 WHERE id = ?', d.id);
        weight = 2;
      } else {
        const prior = this.get('SELECT weight FROM votes WHERE round_id = ? AND stage = ? AND voter_id = ?', r.id, stage, actor.id);
        if (prior) weight = prior.weight; // keep a Dagger already played on this vote
      }
      this.run(`INSERT INTO votes (round_id, stage, voter_id, target_id, weight) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (round_id, stage, voter_id) DO UPDATE SET target_id = excluded.target_id, weight = excluded.weight`,
        r.id, stage, actor.id, target.id, weight);
    });
  }

  closeVote(actor) {
    this.requireKind(actor, ['gm']);
    this.requireRunning();
    const r = this.requireRound(['vote', 'revote']);
    const stage = r.phase === 'revote' ? 2 : 1;
    const votes = this.all('SELECT * FROM votes WHERE round_id = ? AND stage = ?', r.id, stage)
      .filter((v) => this.player(v.voter_id).status === ALIVE && this.player(v.target_id).status === ALIVE);
    const { counts, leaders } = tally(votes);
    const s = this.season();
    const names = (id) => this.player(id)?.display_name;
    const result = {
      stage,
      totals: Object.entries(counts).map(([id, n]) => ({ name: names(Number(id)), votes: n })).sort((a, b) => b.votes - a.votes),
      ballots: s.config.revealMode === 'names' ? votes.map((v) => ({ voter: names(v.voter_id), for: names(v.target_id) })) : null,
    };
    return this.tx(() => {
      if (leaders.length > 1 && stage === 1) {
        this.run("UPDATE rounds SET phase = 'revote', tie_ids = ?, result = ? WHERE id = ?",
          JSON.stringify(leaders), JSON.stringify({ first: result }), r.id);
        this.announce(`A tie between ${leaders.map(names).join(' and ')}. Revote between them now.`);
        this.audit(actor.id, 'close_vote_tie', { round: r.number });
        return { outcome: 'revote', tied: leaders.map(names), result };
      }
      const prev = JSON.parse(r.result || '{}');
      if (leaders.length !== 1) {
        this.run('UPDATE rounds SET result = ? WHERE id = ?', JSON.stringify({ ...prev, final: result, banished: null }), r.id);
        this.announce(leaders.length ? 'Still tied. Nobody is banished this week.' : 'No votes were cast. Nobody is banished this week.');
        this.audit(actor.id, 'close_vote_none', { round: r.number });
        this.afterBanishment(r, null);
        return { outcome: 'none', result };
      }
      const banished = this.player(leaders[0]);
      const role = this.roleOf(banished.id);
      this.run("UPDATE players SET status = 'banished', out_round = ? WHERE id = ?", r.number, banished.id);
      this.run('UPDATE rounds SET banished_id = ?, result = ? WHERE id = ?', banished.id,
        JSON.stringify({ ...prev, final: result, banished: { name: banished.display_name, role } }), r.id);
      if (role === 'traitor') {
        const pts = s.config.correctVotePoints;
        for (const v of votes.filter((x) => x.target_id === banished.id)) {
          this.run('UPDATE players SET points = points + ? WHERE id = ?', pts, v.voter_id);
        }
      }
      this.announce(`${banished.display_name} has been banished. ${banished.display_name} was ${role === 'traitor' ? 'a Traitor' : 'Faithful'}.`);
      this.notify(banished.id, 'You were banished at the roundtable. You are now a Ghost and can still do kindness missions.');
      this.audit(actor.id, 'close_vote_banish', { round: r.number });
      this.afterBanishment(r, banished.id, role);
      return { outcome: 'banished', name: banished.display_name, role, result };
    });
  }

  afterBanishment(r, banishedId, role) {
    if (this.checkWin()) {
      this.run("UPDATE rounds SET phase = 'done' WHERE id = ?", r.id);
      return;
    }
    const s = this.season();
    const counts = this.aliveCounts();
    if (role === 'traitor' && s.config.recruitment && counts.traitors === 1 && !r.endgame) {
      this.run('UPDATE rounds SET recruit_open = 1 WHERE id = ?', r.id);
      const last = this.alivePlayers().find((p) => p.role === 'traitor');
      this.notify(last.id, 'You are the last Traitor. You may offer one Faithful a place at your side this week.');
    }
    if (r.endgame || counts.alive <= s.config.endgameAt) {
      this.run("UPDATE rounds SET phase = 'endcheck', endgame = 1 WHERE id = ?", r.id);
      this.announce('Final decision: vote End Game if you believe every Traitor is gone, or Banish Again. It ends only if everyone votes End Game.');
      return;
    }
    this.finishRound(r.id);
  }

  finishRound(roundId) {
    const s = this.season();
    for (const p of this.alivePlayers()) {
      this.run('UPDATE players SET points = points + ? WHERE id = ?', s.config.survivalPoints, p.id);
    }
    this.run("UPDATE rounds SET phase = 'done' WHERE id = ?", roundId);
  }

  endVote(actor, choice) {
    this.requireRunning();
    this.requireAlive(actor);
    const r = this.requireRound(['endcheck']);
    if (!['end', 'continue'].includes(choice)) throw new GameError('Choose End Game or Banish Again.');
    this.run(`INSERT INTO end_votes (round_id, voter_id, choice) VALUES (?, ?, ?)
              ON CONFLICT (round_id, voter_id) DO UPDATE SET choice = excluded.choice`, r.id, actor.id, choice);
  }

  closeEndVote(actor) {
    this.requireKind(actor, ['gm']);
    this.requireRunning();
    const r = this.requireRound(['endcheck']);
    const alive = this.alivePlayers();
    const votes = this.all('SELECT * FROM end_votes WHERE round_id = ?', r.id);
    const ended = alive.length > 0 && alive.every((p) => votes.some((v) => v.voter_id === p.id && v.choice === 'end'));
    return this.tx(() => {
      if (ended) {
        const winner = alive.some((p) => p.role === 'traitor') ? 'traitors' : 'faithful';
        this.run("UPDATE rounds SET phase = 'done' WHERE id = ?", r.id);
        this.endSeason(winner);
        this.audit(actor.id, 'close_end_vote', { ended: true, winner });
        return { ended: true, winner };
      }
      this.announce('Not everyone voted End Game. The game goes on to another roundtable.');
      this.finishRound(r.id);
      this.audit(actor.id, 'close_end_vote', { ended: false });
      return { ended: false };
    });
  }

  offerRecruit(actor, targetId) {
    this.requireRunning();
    this.requireTraitor(actor);
    const r = this.currentRound();
    if (!r || !r.recruit_open || r.recruit_target) throw new GameError('There is no recruitment offer to make right now.');
    const t = this.player(targetId);
    if (!t || t.status !== ALIVE || this.roleOf(t.id) !== 'faithful') throw new GameError('Choose a Faithful player still in the game.');
    this.run("UPDATE rounds SET recruit_target = ?, recruit_status = 'offered' WHERE id = ?", t.id, r.id);
    this.notify(t.id, 'You have a secret offer waiting in My Role.');
    this.audit(actor.id, 'offer_recruit', { round: r.number });
  }

  answerRecruit(actor, accept) {
    this.requireRunning();
    this.requireAlive(actor);
    const r = this.get("SELECT * FROM rounds WHERE recruit_target = ? AND recruit_status = 'offered' ORDER BY number DESC LIMIT 1", actor.id);
    if (!r) throw new GameError('You have no offer waiting.');
    this.tx(() => {
      this.run('UPDATE rounds SET recruit_status = ?, recruit_open = 0 WHERE id = ?', accept ? 'accepted' : 'declined', r.id);
      if (accept) this.run("UPDATE roles SET role = 'traitor', recruited = 1 WHERE player_id = ?", actor.id);
      const traitor = this.alivePlayers().find((p) => p.role === 'traitor' && p.id !== actor.id);
      if (traitor) this.notify(traitor.id, accept ? 'Your offer was accepted. You have a new Traitor at your side.' : 'Your offer was turned down.');
      this.audit(actor.id, 'answer_recruit', { accepted: !!accept });
      this.checkWin();
    });
  }

  checkWin() {
    const s = this.season();
    if (!s || s.status !== 'active') return s?.status === 'ended';
    const { traitors, faithful } = this.aliveCounts();
    if (traitors === 0) { this.endSeason('faithful'); return true; }
    if (traitors >= faithful) { this.endSeason('traitors'); return true; }
    return false;
  }

  endSeason(winner) {
    this.run("UPDATE season SET status = 'ended', winner = ?, ended_at = ? WHERE id = 1", winner, this.iso());
    const s = this.season();
    this.announce(winner === 'faithful'
      ? `The Faithful win and share the pot of ${s.pot}. Every Traitor has been found.`
      : `The Traitors win and take the pot of ${s.pot}.`);
    this.audit(null, 'season_ended', { winner, seed: s.seed });
  }

  // Close the season by hand (for example, the calendar ran out).
  endSeasonNow(actor) {
    this.requireKind(actor, ['gm']);
    const s = this.requireSeason();
    if (s.status !== 'active') throw new GameError('The game is not running.');
    const winner = this.aliveCounts().traitors > 0 ? 'traitors' : 'faithful';
    this.tx(() => {
      this.endSeason(winner);
      this.audit(actor.id, 'end_season_now', { winner });
    });
    return winner;
  }

  // ---------- hideout ----------
  postHideout(actor, text) {
    this.requireRunning();
    this.requireTraitor(actor);
    const t = String(text || '').trim().slice(0, 1000);
    if (!t) throw new GameError('Write something first.');
    this.run('INSERT INTO hideout_messages (player_id, text, created_at) VALUES (?, ?, ?)', actor.id, t, this.iso());
  }

  // ---------- views ----------
  publicName(p) { return p ? { id: p.id, name: p.display_name, department: p.department } : null; }

  leaderboards() {
    const players = this.all("SELECT * FROM players WHERE kind = 'player' AND status != 'invited' ORDER BY points DESC, display_name");
    const depts = new Map();
    for (const p of players) {
      const d = depts.get(p.department) || { department: p.department, players: 0, points: 0 };
      d.players++;
      d.points += p.points;
      depts.set(p.department, d);
    }
    return {
      players: players.slice(0, 25).map((p) => ({ name: p.display_name, department: p.department, points: p.points, status: p.status })),
      departments: [...depts.values()]
        .map((d) => ({ ...d, average: Math.round(d.points / d.players) }))
        .sort((a, b) => b.average - a.average),
    };
  }

  meView(actor) {
    const s = this.season();
    const r = this.currentRound();
    const nowIso = this.iso();
    const notices = this.all('SELECT id, text, deliver_after FROM outbox WHERE player_id = ? AND deliver_after <= ? ORDER BY id DESC LIMIT 20',
      actor.id, nowIso);
    const view = {
      me: {
        id: actor.id, kind: actor.kind, email: actor.email, name: actor.display_name, department: actor.department,
        status: actor.status, away: !!actor.away, points: actor.points,
        shields: this.get("SELECT COUNT(*) n FROM items WHERE player_id = ? AND kind = 'shield' AND used = 0", actor.id).n,
        daggers: this.get("SELECT COUNT(*) n FROM items WHERE player_id = ? AND kind = 'dagger' AND used = 0", actor.id).n,
        roleReady: !!this.roleOf(actor.id),
      },
      season: s && {
        name: s.name, status: s.status, paused: !!s.paused, pot: s.pot, winner: s.winner,
        startDate: s.start_date, endDate: s.end_date, departments: s.config.departments,
        daggers: !!s.config.daggers, seedHash: s.seed_hash, seed: s.status === 'ended' ? s.seed : null,
      },
      counts: this.aliveCounts(),
      announcements: this.all('SELECT text, created_at FROM announcements ORDER BY id DESC LIMIT 15'),
      notices,
      round: null,
      missions: [],
      players: this.alivePlayers().map((p) => this.publicName(p)),
      leaderboards: this.leaderboards(),
    };
    if (r) {
      const stage = r.phase === 'revote' ? 2 : 1;
      const myVote = this.get('SELECT target_id FROM votes WHERE round_id = ? AND stage = ? AND voter_id = ?', r.id, stage, actor.id);
      const myEnd = this.get('SELECT choice FROM end_votes WHERE round_id = ? AND voter_id = ?', r.id, actor.id);
      const result = JSON.parse(r.result || 'null');
      view.round = {
        number: r.number, phase: r.phase, endgame: !!r.endgame,
        tied: JSON.parse(r.tie_ids || '[]').map((id) => this.publicName(this.player(id))),
        myVote: myVote?.target_id ?? null,
        myEndVote: myEnd?.choice ?? null,
        result: result && (result.final || result.first) ? result : null,
      };
    }
    if (s?.status === 'active' || s?.status === 'ended') {
      view.missions = this.all("SELECT id, title, description, kind, check_method, reward, awards_shield, sabotaged FROM missions WHERE status = 'open' ORDER BY id DESC")
        .map((m) => ({
          ...m,
          mine: this.get('SELECT status, reason FROM submissions WHERE mission_id = ? AND player_id = ?', m.id, actor.id) || null,
        }));
    }
    return view;
  }

  roleView(actor) {
    const role = this.roleOf(actor.id);
    if (!role) throw new GameError('Roles have not been cast yet.');
    const out = { role };
    if (role === 'traitor') {
      out.fellowTraitors = this.all(`SELECT p.display_name name, p.department, p.status FROM roles r JOIN players p ON p.id = r.player_id
                                      WHERE r.role = 'traitor' AND p.id != ?`, actor.id);
    }
    const offer = this.get("SELECT id FROM rounds WHERE recruit_target = ? AND recruit_status = 'offered'", actor.id);
    out.recruitOffer = !!offer;
    return out;
  }

  hideoutView(actor) {
    this.requireTraitor(actor);
    const r = this.currentRound();
    const votes = r ? this.all(`SELECT tv.traitor_id, p1.display_name traitor, p2.display_name target FROM traitor_votes tv
                                JOIN players p1 ON p1.id = tv.traitor_id JOIN players p2 ON p2.id = tv.target_id
                                WHERE tv.round_id = ?`, r.id) : [];
    return {
      murdersPerRound: this.season().config.murdersPerRound,
      round: r && { number: r.number, phase: r.phase, sabotageUsed: !!r.sabotage_used, recruitOpen: !!r.recruit_open && !r.recruit_target },
      targets: this.alivePlayers().filter((p) => p.role === 'faithful' && !p.away).map((p) => this.publicName(p)),
      votes,
      groupMissions: this.all("SELECT id, title FROM missions WHERE status = 'open' AND kind IN ('department','staff','puzzle','pair')"),
      messages: this.all(`SELECT h.text, h.created_at, p.display_name name FROM hideout_messages h JOIN players p ON p.id = h.player_id
                          ORDER BY h.id DESC LIMIT 50`),
    };
  }

  dashboardView(actor) {
    this.requireKind(actor, ['gm', 'sponsor']);
    const s = this.season();
    const isGm = actor.kind === 'gm';
    const showRoles = isGm && s && (!s.config.sealed || s.status === 'ended');
    const people = this.all('SELECT * FROM players ORDER BY kind, display_name, email').map((p) => ({
      id: p.id, email: p.email, kind: p.kind, evaluator: !!p.is_evaluator, name: p.display_name, department: p.department,
      lunch: p.lunch, status: p.status, away: !!p.away, late: !!p.late, points: p.points,
      role: showRoles || s?.status === 'ended' ? this.roleOf(p.id) : undefined,
    }));
    const byDept = {};
    for (const p of people.filter((x) => x.kind === 'player' && x.status !== 'invited')) byDept[p.department] = (byDept[p.department] || 0) + 1;
    const r = this.currentRound();
    let roundInfo = null;
    if (r) {
      const stage = r.phase === 'revote' ? 2 : 1;
      roundInfo = {
        number: r.number, phase: r.phase, endgame: !!r.endgame, murderResult: r.murder_result,
        votesIn: this.get('SELECT COUNT(*) n FROM votes WHERE round_id = ? AND stage = ?', r.id, stage).n,
        endVotesIn: this.get('SELECT COUNT(*) n FROM end_votes WHERE round_id = ?', r.id).n,
        traitorVotesIn: isGm && showRoles ? this.get('SELECT COUNT(*) n FROM traitor_votes WHERE round_id = ?', r.id).n : undefined,
        result: JSON.parse(r.result || 'null'),
      };
    }
    return {
      viewer: actor.kind,
      season: s && {
        name: s.name, status: s.status, paused: !!s.paused, startDate: s.start_date, endDate: s.end_date,
        config: s.config, approvedAt: s.approved_at, pot: s.pot, winner: s.winner, seedHash: s.seed_hash,
        seed: s.status === 'ended' ? s.seed : null,
      },
      checklistLabels: CHECKLIST_LABELS,
      blackouts: this.blackouts(),
      gameDayProblem: s ? gameDayProblem(this.now(), s, this.blackouts()) : null,
      counts: this.aliveCounts(),
      registeredByDepartment: byDept,
      people: isGm ? people : people.map(({ email, role, ...rest }) => rest),
      round: roundInfo,
      missions: isGm ? this.all('SELECT * FROM missions ORDER BY plan_day IS NULL, plan_day, id') : [],
      queue: isGm ? this.all(`SELECT s.id, s.answer, s.photo, s.created_at, m.title, p.display_name name FROM submissions s
                              JOIN missions m ON m.id = s.mission_id JOIN players p ON p.id = s.player_id
                              WHERE s.status = 'pending' ORDER BY s.id`) : [],
      concerns: this.all(`SELECT c.id, c.text, c.created_at, c.resolved, p.display_name name FROM concerns c
                          LEFT JOIN players p ON p.id = c.player_id ORDER BY c.resolved, c.id DESC LIMIT 50`),
      audit: isGm ? this.all('SELECT a.*, p.display_name actor FROM audit_log a LEFT JOIN players p ON p.id = a.actor_id ORDER BY a.id DESC LIMIT 100') : [],
      leaderboards: this.leaderboards(),
    };
  }

  seasonStory() {
    const s = this.requireSeason();
    if (s.status !== 'ended') throw new GameError('The full story opens when the season ends.');
    return {
      winner: s.winner, pot: s.pot, seed: s.seed, seedHash: s.seed_hash,
      roles: this.all(`SELECT p.display_name name, p.department, p.status, p.out_round, r.role, r.recruited FROM players p
                       JOIN roles r ON r.player_id = p.id ORDER BY r.role DESC, p.display_name`),
      rounds: this.all('SELECT number, murder_result, murder_victim, banished_id, result FROM rounds ORDER BY number').map((r) => ({
        number: r.number, murder: r.murder_result,
        victims: this.all("SELECT display_name FROM players WHERE status = 'murdered' AND out_round = ?", r.number).map((x) => x.display_name),
        result: JSON.parse(r.result || 'null'),
      })),
      audit: this.all('SELECT a.action, a.detail, a.created_at, p.display_name actor FROM audit_log a LEFT JOIN players p ON p.id = a.actor_id ORDER BY a.id'),
    };
  }

  exportData(actor) {
    this.requireKind(actor, ['gm']);
    const tables = ['season', 'blackout_dates', 'players', 'roles', 'missions', 'rounds', 'votes', 'traitor_votes',
      'end_votes', 'items', 'pot_ledger', 'announcements', 'concerns', 'audit_log'];
    const out = {};
    for (const t of tables) out[t] = this.all(`SELECT * FROM ${t}`);
    out.submissions = this.all('SELECT id, mission_id, player_id, answer, status, reason, reward_given, created_at FROM submissions');
    return out;
  }

  // Wipes all player data. The Game Master account stays so a new season can start.
  purge(actor) {
    this.requireKind(actor, ['gm']);
    const s = this.requireSeason();
    if (s.status !== 'ended') throw new GameError('End the season before deleting data.');
    this.tx(() => {
      for (const t of ['votes', 'traitor_votes', 'end_votes', 'items', 'submissions', 'hideout_messages', 'outbox', 'concerns',
        'roles', 'rounds', 'missions', 'pot_ledger', 'announcements', 'blackout_dates', 'audit_log', 'login_codes']) {
        this.run(`DELETE FROM ${t}`);
      }
      this.run("DELETE FROM sessions WHERE player_id IN (SELECT id FROM players WHERE kind != 'gm')");
      this.run("DELETE FROM players WHERE kind != 'gm'");
      this.run('DELETE FROM season');
    });
  }
}
