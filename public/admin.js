import { h, api, act, toast, when, signInCard } from './ui.js';

const root = document.getElementById('app');
let d = null;
let force = false;

async function load() {
  try {
    d = await api('/api/admin');
  } catch (e) {
    if (e.status === 401) return root.replaceChildren(signInCard(load, 'Organizer sign in'));
    if (e.status === 403) return root.replaceChildren(h('div', { class: 'card' }, 'This page is for the Game Master and the principal sponsor. ', h('a', { href: '/' }, 'Go to the player app')));
    return root.replaceChildren(h('div', { class: 'card' }, e.message));
  }
  render();
}

const post = (path, body = {}) => api(path, body);
const isGm = () => d.viewer === 'gm';
const btn = (label, path, body, opts = {}) => h('button', {
  class: opts.class || '',
  onclick: act(async () => {
    if (opts.confirm && !window.confirm(opts.confirm)) throw new Error('Cancelled.');
    return post(path, typeof body === 'function' ? body() : { ...body, force });
  }, async (r) => { if (opts.done) opts.done(r); else toast('Done.'); await load(); }),
}, label);

function render() {
  document.getElementById('pot').textContent = d.season ? `Pot ${d.season.pot}` : '';
  const s = d.season;
  const cards = [];
  cards.push(statusCard());
  if (isGm() && (!s || s.status === 'draft')) cards.push(seasonForm());
  if (s) cards.push(checklistCard());
  if (isGm()) cards.push(peopleCard());
  if (s && ['active', 'ended'].includes(s.status) || (s && isGm())) cards.push(roundCard());
  if (isGm() && s) cards.push(missionsCard(), queueCard());
  cards.push(playersCard(), concernsCard(), boardsCard());
  if (isGm()) cards.push(endCard(), auditCard());
  root.replaceChildren(h('div', { class: 'grid2' }, cards.filter(Boolean)));
}

function statusCard() {
  const s = d.season;
  const words = { draft: 'Draft: waiting for setup and principal approval', approved: 'Approved: finish the checklist, then open registration',
    registration: 'Registration is open', active: 'The game is running', ended: 'The season has ended' };
  return h('div', { class: 'card' },
    h('h2', {}, s ? s.name : 'No season yet'),
    s ? h('p', {}, words[s.status], s.paused ? ' (paused)' : '') : h('p', {}, 'Set up the season below.'),
    s ? h('p', { class: 'small muted' }, `${s.startDate} to ${s.endDate}. ${d.counts.alive} players still in.`) : null,
    d.gameDayProblem ? h('p', { class: 'warn small' }, `Not a game day: ${d.gameDayProblem}`) : null,
    s?.seedHash ? h('p', { class: 'small muted' }, `Role draw fingerprint: ${s.seedHash}`) : null,
    s && s.status !== 'ended' ? btn(s.paused ? 'Resume the game' : 'Pause the game', '/api/admin/pause', { paused: !s.paused }, { class: s.paused ? 'primary' : 'danger' }) : null,
    d.viewer === 'sponsor' && s?.status === 'draft' ? approveBlock() : null,
    h('p', {}, h('a', { href: '/' }, 'Open the player app')),
    h('button', { onclick: act(() => api('/api/logout', {}), load) }, 'Sign out'),
  );
}

function approveBlock() {
  const c = d.season.config;
  return h('div', {},
    h('h3', {}, 'Your approval'),
    h('ul', {},
      h('li', {}, `Season dates: ${d.season.startDate} to ${d.season.endDate}`),
      h('li', {}, `Blackout dates: ${d.blackouts.map((b) => `${b.date}${b.label ? ` ${b.label}` : ''}`).join(', ') || 'none yet'}`),
      h('li', {}, `Evaluators play as Faithful only: ${c.evaluatorsFaithfulOnly ? 'yes' : 'no'}`),
      h('li', {}, 'Rules: no class time, no students, no money from staff, opt out any time, data deleted after the season.')),
    btn('Approve this season', '/api/admin/approve', {}, { class: 'primary', confirm: 'Approve the season as described?' }));
}

function seasonForm() {
  const s = d.season;
  const c = s?.config || {};
  const name = h('input', { type: 'text', value: s?.name || 'Spring Staff Traitors' });
  const start = h('input', { type: 'date', value: s?.startDate || '' });
  const end = h('input', { type: 'date', value: s?.endDate || '' });
  const domain = h('input', { type: 'text', value: c.emailDomain || '', placeholder: 'school.org' });
  const blackouts = h('textarea', {}, d.blackouts.map((b) => `${b.date} ${b.label || ''}`.trim()).join('\n'));
  const count = h('input', { type: 'number', min: 2, max: 5, value: c.traitorCount || '' });
  const murders = h('input', { type: 'number', min: 1, max: 5, value: c.murdersPerRound || 1 });
  const checks = {
    evaluatorsFaithfulOnly: ['Evaluators (principal and assistant principals) play as Faithful only', c.evaluatorsFaithfulOnly ?? true],
    sealed: ['Sealed mode: hide roles from me, the Game Master, until the season ends', c.sealed ?? false],
    recruitment: ['Allow recruitment by the last Traitor', c.recruitment ?? true],
    shields: ['Shields on', c.shields ?? true],
    daggers: ['Daggers on (one double vote)', c.daggers ?? false],
  };
  const boxes = Object.fromEntries(Object.entries(checks).map(([k, [, v]]) => [k, h('input', { type: 'checkbox', checked: v })]));
  const reveal = h('select', {}, h('option', { value: 'totals' }, 'Show totals only (friendlier)'), h('option', { value: 'names' }, 'Show every vote by name'));
  reveal.value = c.revealMode || 'totals';
  const bells = h('textarea', {}, (c.bellSchedule || []).map((b) => `${b.start}-${b.end}`).join('\n'));
  const depts = h('textarea', {}, (c.departments || []).join('\n'));
  return h('div', { class: 'card' }, h('h2', {}, 'Season setup'),
    h('label', {}, 'Season name'), name,
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Start date (a Monday)'), start), h('div', {}, h('label', {}, 'End date (that Friday)'), end)),
    h('p', { class: 'muted small' }, 'One roundtable a school day. On the end date the Final Roundtable runs whatever the player count.'),
    h('label', {}, 'Staff email domain (only these addresses can join)'), domain,
    h('label', {}, 'Blackout dates, one per line: 2027-03-16 Spring break'), blackouts,
    h('label', {}, 'Number of Traitors (blank means about one per nine players)'), count,
    h('label', {}, 'Murders per night (one week: 1 for about 15 players, 2 for 18 to 20)'), murders,
    h('label', {}, 'Roundtable reveal'), reveal,
    ...Object.entries(checks).map(([k, [label]]) => h('label', { class: 'check' }, boxes[k], label)),
    h('label', {}, 'Bell schedule: class periods, one per line (no notifications during these)'), bells,
    h('label', {}, 'Departments, one per line'), depts,
    h('button', {
      class: 'primary block',
      onclick: act(() => post('/api/admin/season', {
        name: name.value, startDate: start.value, endDate: end.value,
        blackouts: blackouts.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ date: l.slice(0, 10), label: l.slice(10).trim() })),
        config: {
          emailDomain: domain.value.trim(), traitorCount: count.value ? Number(count.value) : null, murdersPerRound: Number(murders.value) || 1, revealMode: reveal.value,
          ...Object.fromEntries(Object.entries(boxes).map(([k, el]) => [k, el.checked])),
          bellSchedule: bells.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [a, b] = l.split('-'); return { start: a.trim(), end: b.trim() }; }),
          departments: depts.value.split('\n').map((l) => l.trim()).filter(Boolean),
        },
      }), () => { toast('Season saved.'); return load(); }),
    }, 'Save season'));
}

function checklistCard() {
  const c = d.season.config.checklist;
  return h('div', { class: 'card' }, h('h2', {}, 'Before registration opens'),
    h('ul', { class: 'list' }, Object.entries(d.checklistLabels).map(([k, label]) => h('li', { class: 'row' },
      h('span', {}, c[k] ? '✓ ' : '○ ', label),
      isGm() && k !== 'principalApproved' && d.season.status !== 'ended'
        ? btn(c[k] ? 'Undo' : 'Mark done', '/api/admin/checklist', { key: k, value: !c[k] }) : null))),
    isGm() && d.season.status === 'approved' ? btn('Open registration', '/api/admin/open-registration', {}, { class: 'primary' }) : null,
    isGm() && d.season.status === 'registration'
      ? [h('p', {}, 'Registered so far: ', Object.entries(d.registeredByDepartment).map(([k, v]) => `${k} ${v}`).join(', ') || 'nobody yet'),
        btn('Cast roles now (closes registration for Traitors)', '/api/admin/cast', {}, { class: 'primary', confirm: 'Cast roles now? This cannot be undone.', done: (r) => toast(`${r.traitors} Traitors cast among ${r.players} players.`) })]
      : null);
}

function peopleCard() {
  const emails = h('textarea', { placeholder: 'One email per line, or paste a list' });
  const kind = h('select', {}, h('option', { value: 'player' }, 'Players'), h('option', { value: 'sponsor' }, 'Principal sponsor'));
  const evaluator = h('input', { type: 'checkbox' });
  const codes = h('div', {});
  const one = h('input', { type: 'email', placeholder: 'email for a fresh code' });
  const showCodes = (list) => codes.replaceChildren(h('h3', {}, 'Sign-in codes (print and hand out; each works once)'),
    h('table', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Code')), list.map((c) => h('tr', {}, h('td', {}, c.email), h('td', {}, h('strong', {}, c.code))))),
    h('button', { onclick: () => window.print() }, 'Print'));
  return h('div', { class: 'card' }, h('h2', {}, 'Allow list and sign-in codes'),
    h('p', { class: 'muted small' }, 'Only people on this list can join. Codes are shown once here; staff without a school email or phone can play with a printed code and paper ballots you enter.'),
    emails, h('label', {}, 'Add as'), kind,
    h('label', { class: 'check' }, evaluator, 'These people formally evaluate teachers'),
    h('button', { class: 'primary block', onclick: act(() => post('/api/admin/people', { emails: emails.value, kind: kind.value, evaluator: evaluator.checked }), (r) => { emails.value = ''; showCodes(r.codes); }) }, 'Add and make codes'),
    h('div', { class: 'row' }, one, h('button', { onclick: act(() => post('/api/admin/new-code', { email: one.value }), (r) => showCodes([r])) }, 'New code')),
    codes);
}

function roundCard() {
  const s = d.season;
  const r = d.round;
  if (!s || s.status !== 'active') {
    return r?.result ? h('div', { class: 'card' }, h('h2', {}, 'Last roundtable'), resultBlock(r.result)) : null;
  }
  const forceBox = h('input', { type: 'checkbox', checked: force, onchange: (e) => { force = e.target.checked; } });
  const phaseWords = { murder: 'Night: Traitors are voting', day: 'Day: missions, roundtable next', vote: 'Roundtable open', revote: 'Tie revote open', endcheck: 'End Game decision open', done: 'Round finished' };
  return h('div', { class: 'card' }, h('h2', {}, r ? `Round ${r.number}${r.endgame ? ' (final)' : ''}` : 'Rounds'),
    r ? h('p', {}, phaseWords[r.phase]) : h('p', {}, 'No round yet.'),
    r && ['vote', 'revote'].includes(r.phase) ? h('p', {}, `Votes in: ${r.votesIn} of ${d.counts.alive}`) : null,
    r?.phase === 'endcheck' ? h('p', {}, `Choices in: ${r.endVotesIn} of ${d.counts.alive}`) : null,
    r?.traitorVotesIn !== undefined && r.phase === 'murder' ? h('p', { class: 'small muted' }, `Traitor votes in: ${r.traitorVotesIn}`) : null,
    isGm() ? h('div', { class: 'row' },
      (!r || r.phase === 'done') ? btn('Start next round', '/api/admin/round/start', {}, { class: 'primary' }) : null,
      r?.phase === 'murder' ? btn('Process the murder', '/api/admin/round/murder', {}, { class: 'primary', done: (x) => toast(x.result === 'murdered' ? `${x.victims.length} murdered.` : x.result === 'shielded' ? 'A Shield stopped the murder.' : 'Nobody was murdered.') }) : null,
      r?.phase === 'day' ? btn('Open the roundtable', '/api/admin/round/open-vote', {}, { class: 'primary' }) : null,
      ['vote', 'revote'].includes(r?.phase) ? btn('Close the vote and reveal', '/api/admin/round/close-vote', {}, { class: 'primary', confirm: 'Close the vote now?', done: (x) => toast(x.outcome === 'banished' ? `${x.name} banished (${x.role}).` : x.outcome === 'revote' ? `Tie: ${x.tied.join(' and ')}. Revote open.` : 'Nobody banished.') }) : null,
      r?.phase === 'endcheck' ? btn('Close the End Game vote', '/api/admin/round/close-end-vote', {}, { class: 'primary', done: (x) => toast(x.ended ? `Game over: ${x.winner} win.` : 'The game goes on.') }) : null) : null,
    isGm() ? h('label', { class: 'check' }, forceBox, 'Override: allow this step on a non-game day (logged)') : null,
    r?.result ? resultBlock(r.result) : null);
}

function resultBlock(res) {
  const show = res.final || res.first;
  return h('div', {}, h('h3', {}, 'Result to project'),
    res.banished ? h('p', {}, h('strong', {}, `${res.banished.name} was ${res.banished.role === 'traitor' ? 'a Traitor' : 'Faithful'}.`)) : null,
    h('ul', { class: 'list' }, show.totals.map((t) => h('li', {}, `${t.name}: ${t.votes}`))),
    show.ballots ? h('ul', { class: 'list small' }, show.ballots.map((b) => h('li', {}, `${b.voter} voted for ${b.for}`))) : null);
}

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const dayName = (n) => DAY_NAMES[n] || `day ${n}`;
const planDays = (m) => (m.plan_last_day && m.plan_last_day !== m.plan_day ? `${dayName(m.plan_day)} to ${dayName(m.plan_last_day)}` : dayName(m.plan_day));

function missionsCard() {
  const title = h('input', { type: 'text', placeholder: 'Title' });
  const desc = h('textarea', { placeholder: 'What to do. Remember: outside class time, no students, no money.' });
  const kind = h('select', {}, ['individual', 'pair', 'department', 'staff', 'kindness', 'puzzle'].map((k) => h('option', { value: k }, k)));
  const method = h('select', {}, [['manual', 'Game Master confirms'], ['code', 'Code word'], ['quiz', 'Quiz answer'], ['photo', 'Photo']].map(([v, l]) => h('option', { value: v }, l)));
  const answer = h('input', { type: 'text', placeholder: 'Answer or code (several allowed: A|B)' });
  const reward = h('input', { type: 'number', value: 100, min: 0 });
  const shield = h('input', { type: 'checkbox' });
  return h('div', { class: 'card' }, h('h2', {}, 'Missions'),
    d.missions.length === 0 ? btn('Load the 30 starter missions', '/api/admin/missions/starter', {}, { class: 'primary', done: (r) => toast(`${r.added} missions added as drafts.`) }) : null,
    !d.missions.some((m) => m.plan_day) ? btn('Load the one-week plan (Monday to Friday)', '/api/admin/missions/week-plan', {}, { done: (r) => toast(`${r.planned} missions given a day, ${r.added} added as drafts.`) }) : null,
    d.missions.some((m) => m.plan_day) && d.season.status === 'active'
      ? btn("Open today's planned missions", '/api/admin/missions/open-day', {}, { class: 'primary', done: (r) => toast(`Day ${r.day}: opened ${r.opened.length}, closed ${r.closed.length}.${r.needAnswer.length ? ` Set an answer first for: ${r.needAnswer.join(', ')}.` : ''}`) })
      : null,
    h('details', {}, h('summary', {}, 'New mission'),
      title, desc, h('div', { class: 'row' }, kind, method), answer, h('label', {}, 'Pot reward'), reward,
      h('label', { class: 'check' }, shield, 'Completing it earns a Shield'),
      h('button', { class: 'primary block', onclick: act(() => post('/api/admin/missions', { title: title.value, description: desc.value, kind: kind.value, checkMethod: method.value, answer: answer.value, reward: Number(reward.value), awardsShield: shield.checked }), load) }, 'Add mission')),
    h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, h('th', {}, 'Mission'), h('th', {}, 'Check'), h('th', {}, 'Status'), h('th', {}, '')),
      d.missions.map((m) => h('tr', {},
        h('td', {}, m.title, m.sabotaged ? h('span', { class: 'bad small' }, ' (sabotaged)') : null, h('div', { class: 'muted small' }, `${m.kind}, ${m.reward}${m.awards_shield ? ', shield' : ''}${m.plan_day ? `, ${planDays(m)}` : ''}`)),
        h('td', { class: 'small' }, m.check_method, m.answer ? h('div', { class: m.answer === 'EDIT ME' ? 'warn' : 'muted' }, m.answer) : null),
        h('td', {}, m.status),
        h('td', {},
          m.status === 'draft' && ['code', 'quiz'].includes(m.check_method) ? h('button', { onclick: act(() => { const a = window.prompt('Answer (several allowed: A|B)', m.answer || ''); if (!a) throw new Error('Not changed.'); return post('/api/admin/missions/update', { id: m.id, answer: a }); }, load) }, 'Set answer') : null,
          m.status !== 'open' && d.season.status === 'active' ? btn('Open', '/api/admin/missions/status', { id: m.id, status: 'open' }) : null,
          m.status === 'open' ? btn('Close', '/api/admin/missions/status', { id: m.id, status: 'closed' }) : null))))));
}

function queueCard() {
  return h('div', { class: 'card' }, h('h2', {}, `Check-ins to review (${d.queue.length})`),
    d.queue.length ? h('ul', { class: 'list' }, d.queue.map((q) => h('li', {},
      h('strong', {}, q.name), ` for ${q.title}`, h('div', { class: 'muted small' }, when(q.created_at)),
      q.answer ? h('p', {}, q.answer) : null,
      q.photo ? h('img', { class: 'thumb', src: q.photo, alt: 'Check-in photo' }) : null,
      h('div', { class: 'row' },
        btn('Approve', '/api/admin/review', { id: q.id, approve: true }, { class: 'primary' }),
        btn('Reject', '/api/admin/review', () => ({ id: q.id, approve: false, reason: window.prompt('Reason (the player sees this)') || '' })))))) : h('p', { class: 'muted' }, 'Nothing waiting.'));
}

function playersCard() {
  const players = d.people.filter((p) => p.kind === 'player');
  return h('div', { class: 'card' }, h('h2', {}, `Players (${players.length})`),
    d.season?.config?.sealed && d.season.status !== 'ended' && isGm() ? h('p', { class: 'small muted' }, 'Sealed mode: roles are hidden from you until the season ends.') : null,
    h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Department'), h('th', {}, 'Status'), h('th', {}, 'Points'), h('th', {}, '')),
      players.map((p) => h('tr', {},
        h('td', {}, p.name || h('span', { class: 'muted' }, p.email || 'not registered'), p.evaluator ? h('span', { class: 'pill' }, 'evaluator') : null,
          p.role ? h('div', { class: p.role === 'traitor' ? 'bad small' : 'small muted' }, p.role) : null),
        h('td', {}, p.department || ''),
        h('td', {}, p.status, p.away ? ' (away)' : '', p.late ? ' (late)' : ''),
        h('td', {}, p.points),
        h('td', {}, isGm() && p.status === 'active' ? [
          btn(p.away ? 'Back' : 'Away', '/api/away', { playerId: p.id, away: !p.away }),
          btn('Left school', '/api/admin/left', { playerId: p.id }, { confirm: 'Mark this player as having left the game?' })] : null))))));
}

function concernsCard() {
  const open = d.concerns.filter((c) => !c.resolved);
  return h('div', { class: 'card' }, h('h2', {}, `Concerns (${open.length} open)`),
    d.concerns.length ? h('ul', { class: 'list' }, d.concerns.map((c) => h('li', { class: c.resolved ? 'muted' : '' },
      h('div', { class: 'small muted' }, `${c.name || 'The game'} · ${when(c.created_at)}`), c.text,
      !c.resolved ? btn('Mark handled', '/api/admin/concern/resolve', { id: c.id }) : null))) : h('p', { class: 'muted' }, 'None.'));
}

function boardsCard() {
  return h('div', { class: 'card' }, h('h2', {}, 'Leaderboards'),
    h('h3', {}, 'Departments (average per player)'),
    h('ul', { class: 'list' }, d.leaderboards.departments.map((x) => h('li', {}, `${x.department}: ${x.average} (${x.players})`))),
    h('h3', {}, 'Top players'),
    h('ul', { class: 'list' }, d.leaderboards.players.slice(0, 10).map((p) => h('li', {}, `${p.name}: ${p.points}`))));
}

function endCard() {
  const s = d.season;
  if (!s) return null;
  const confirmBox = h('input', { type: 'text', placeholder: 'Type DELETE' });
  return h('div', { class: 'card' }, h('h2', {}, 'End of season'),
    s.status === 'active' ? btn('End the season now', '/api/admin/end-season', {}, { class: 'danger', confirm: 'End the season now? Whoever is left decides the winner.' }) : null,
    h('p', {}, h('a', { href: '/api/admin/export', download: 'staff-traitors-export.json' }, 'Download all game data')),
    s.status === 'ended' ? [h('p', { class: 'small muted' }, 'Delete all player data within 30 days of the season ending. Download it first if you need a copy.'),
      confirmBox, btn('Delete all player data', '/api/admin/purge', () => ({ confirm: confirmBox.value }), { class: 'danger' })] : null);
}

function auditCard() {
  return h('div', { class: 'card' }, h('h2', {}, 'Audit log'),
    h('p', { class: 'small muted' }, 'Every organizer action is recorded. Players can read the full story when the season ends.'),
    h('div', { class: 'scroll' }, h('table', {}, d.audit.map((a) => h('tr', {},
      h('td', { class: 'small muted' }, when(a.created_at)), h('td', {}, a.actor || 'system'), h('td', {}, a.action), h('td', { class: 'small' }, a.detail || ''))))));
}

load();
