import { h, api, act, toast, when, signInCard } from './ui.js';

const root = document.getElementById('app');
const potEl = document.getElementById('pot');
let me = null;
let tab = sessionStorageGet('tab') || 'home';
let isTraitor = false;

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }

try { if (localStorage.getItem('large') === '1') document.body.classList.add('large'); } catch { /* ignore */ }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

async function load() {
  try {
    me = await api('/api/me');
  } catch (e) {
    if (e.status === 401) return renderSignIn();
    root.replaceChildren(h('div', { class: 'card' }, e.message));
    return;
  }
  if (me.me.kind !== 'player') {
    root.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Organizer account'),
      h('p', {}, 'You are signed in as the Game Master or principal sponsor.'),
      h('a', { href: 'admin.html' }, 'Open the organizer dashboard')));
    return;
  }
  isTraitor = false;
  if (me.me.roleReady) {
    // The role is fetched only to decide whether to show the Hideout tab.
    try { isTraitor = (await api('/api/role')).role === 'traitor' && me.me.status === 'active'; } catch { /* ignore */ }
  }
  render();
}

function renderSignIn() {
  document.getElementById('tabs').replaceChildren();
  potEl.textContent = '';
  root.replaceChildren(signInCard(load));
}

function render() {
  potEl.textContent = me.season ? `Pot ${me.season.pot}` : '';
  const s = me.season;
  if (!s || ['draft', 'approved'].includes(s.status)) {
    document.getElementById('tabs').replaceChildren();
    root.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Almost time'),
      h('p', {}, 'The season is being set up. Registration opens soon.'), signOutButton()));
    return;
  }
  if (me.me.status === 'invited') {
    document.getElementById('tabs').replaceChildren();
    root.replaceChildren(registerCard());
    return;
  }
  const tabs = [['home', 'Home'], ['missions', 'Missions'], ['vote', 'Vote'], ['role', 'My Role']];
  if (isTraitor) tabs.push(['hideout', 'Hideout']);
  tabs.push(['more', 'More']);
  if (!tabs.some(([k]) => k === tab)) tab = 'home';
  document.getElementById('tabs').replaceChildren(...tabs.map(([k, label]) =>
    h('button', { 'aria-current': k === tab ? 'page' : false, onclick: () => { tab = k; sessionStorageSet('tab', k); render(); } }, label)));
  const views = { home, missions, vote, role, hideout, more };
  const content = views[tab]();
  root.replaceChildren(...(s.paused ? [h('div', { class: 'card warn' }, 'The game is paused. Nothing happens until it starts again.')] : []), ...[content].flat());
}

function registerCard() {
  const name = h('input', { type: 'text', id: 'name', maxlength: 40, autocomplete: 'nickname' });
  const dept = h('select', { id: 'dept' }, h('option', { value: '' }, 'Choose one'),
    ...me.season.departments.map((d) => h('option', { value: d }, d)));
  const lunch = h('input', { type: 'text', id: 'lunch', maxlength: 20, placeholder: 'For example A lunch' });
  const boxes = {
    voluntary: 'I am joining because I want to. Nobody asked me to.',
    optOut: 'I know I can leave the game at any time with one button.',
    noClassTime: 'The game never happens during class time, in front of students, or involves students.',
    conduct: 'I have read the code of conduct: friendly play only, nothing touches anyone\'s real work, room or reputation.',
  };
  const inputs = Object.fromEntries(Object.keys(boxes).map((k) => [k, h('input', { type: 'checkbox', id: `c_${k}` })]));
  return h('div', { class: 'card' },
    h('h2', {}, `Join ${me.season.name}`),
    me.season.status === 'active' ? h('p', { class: 'muted' }, 'Roles are already cast, so you join as Faithful.') : null,
    h('label', { for: 'name' }, 'Display name (what other players see)'), name,
    h('label', { for: 'dept' }, 'Department'), dept,
    h('label', { for: 'lunch' }, 'Lunch period (optional, helps plan missions)'), lunch,
    ...Object.entries(boxes).map(([k, text]) => h('label', { class: 'check', for: `c_${k}` }, inputs[k], text)),
    h('button', {
      class: 'primary block',
      onclick: act(() => api('/api/register', {
        displayName: name.value, department: dept.value, lunch: lunch.value,
        consents: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.checked])),
      }), load),
    }, 'Join the game'),
  );
}

function statusLine() {
  const st = me.me.status;
  if (st === 'active') return h('span', { class: 'pill good' }, me.me.away ? 'In the game (away)' : 'In the game');
  const words = { murdered: 'Ghost (murdered)', banished: 'Ghost (banished)', ghost: 'Ghost (opted out)', left: 'Left the game' };
  return h('span', { class: 'pill' }, words[st] || st);
}

function roundText(r) {
  if (!r) return 'The first round has not started yet.';
  const phases = {
    murder: 'Night: the Traitors are choosing.',
    day: 'Day: missions are open. The roundtable comes next.',
    vote: 'The roundtable is open. Vote now.',
    revote: 'Tie! Revote between the tied players.',
    endcheck: 'Final decision: End Game or Banish Again.',
    done: 'This round is over.',
  };
  return `Round ${r.number}${r.endgame ? ' (Final Roundtable)' : ''}. ${phases[r.phase]}`;
}

function home() {
  const s = me.season;
  const out = [];
  if (s.status === 'ended') {
    out.push(h('div', { class: 'card' }, h('h2', {}, s.winner === 'faithful' ? 'The Faithful win' : 'The Traitors win'),
      h('p', {}, `Final pot: ${s.pot}.`), h('button', { class: 'block', onclick: act(showStory) }, 'See the whole season story')));
  }
  out.push(h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h2', {}, `Hi, ${me.me.name}`), statusLine()),
    h('p', {}, roundText(me.round)),
    h('div', { class: 'stats' },
      h('div', {}, h('strong', {}, me.counts.alive), 'still in'),
      h('div', {}, h('strong', {}, me.me.points), 'your points'),
      h('div', {}, h('strong', {}, s.pot), 'prize pot')),
    me.me.shields ? h('p', { class: 'good small' }, `You hold ${me.me.shields} Shield${me.me.shields > 1 ? 's' : ''}. Only you can see this.`) : null,
  ));
  if (me.notices.length) {
    out.push(h('div', { class: 'card' }, h('h2', {}, 'For you'),
      h('ul', { class: 'list' }, me.notices.map((n) => h('li', {}, n.text, ' ', h('span', { class: 'muted small' }, when(n.deliver_after)))))));
  }
  out.push(h('div', { class: 'card' }, h('h2', {}, 'Announcements'),
    me.announcements.length
      ? h('ul', { class: 'list' }, me.announcements.map((a) => h('li', {}, a.text, ' ', h('span', { class: 'muted small' }, when(a.created_at)))))
      : h('p', { class: 'muted' }, 'Nothing yet.')));
  return out;
}

function missions() {
  if (!me.missions.length) return h('div', { class: 'card' }, h('h2', {}, 'Missions'), h('p', { class: 'muted' }, 'No missions are open right now.'));
  return me.missions.map((m) => {
    const answer = h('input', { type: 'text', 'aria-label': 'Answer' });
    const photo = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Photo' });
    const mine = m.mine;
    const done = mine && mine.status !== 'rejected';
    const methodText = { code: 'Type the code word', quiz: 'Type your answer', photo: 'Send a photo', manual: 'Check in; the Game Master confirms it' };
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', {}, m.title), h('span', { class: 'pill' }, `${m.sabotaged ? Math.floor(m.reward / 2) : m.reward} to the pot`)),
      h('p', {}, m.description),
      m.sabotaged ? h('p', { class: 'bad small' }, 'This mission was sabotaged and pays half.') : null,
      m.awards_shield ? h('p', { class: 'good small' }, 'Completing this one earns a secret Shield.') : null,
      done
        ? h('p', { class: mine.status === 'approved' ? 'good' : 'warn' }, mine.status === 'approved' ? 'Done. Thank you!' : 'Sent. Waiting for the Game Master.')
        : [
          mine?.status === 'rejected' ? h('p', { class: 'bad small' }, mine.reason || 'Not accepted. Try again.') : null,
          h('p', { class: 'muted small' }, methodText[m.check_method]),
          m.check_method === 'photo'
            ? [h('p', { class: 'warn small' }, 'No students, no student work, and no names on screens or papers in your photo.'), photo]
            : answer,
          h('button', {
            class: 'primary block',
            onclick: act(async () => {
              let img = null;
              if (m.check_method === 'photo') {
                if (!photo.files[0]) throw new Error('Choose a photo first.');
                img = await shrinkImage(photo.files[0]);
              }
              return api('/api/missions/submit', { missionId: m.id, answer: answer.value, photo: img });
            }, (r) => { toast(r.status === 'approved' ? 'Correct! Added to the pot.' : r.status === 'rejected' ? r.reason : 'Sent for review.'); return load(); }),
          }, 'Check in'),
        ]);
  });
}

// Resize photos on the phone before sending, to keep uploads small.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => reject(new Error('That file is not a picture.'));
    img.src = URL.createObjectURL(file);
  });
}

function vote() {
  const r = me.round;
  const out = [];
  if (r?.result) out.push(resultCard(r));
  if (!r || !['vote', 'revote', 'endcheck'].includes(r.phase)) {
    out.unshift(h('div', { class: 'card' }, h('h2', {}, 'Roundtable'), h('p', { class: 'muted' }, 'Voting is closed right now.')));
    return out;
  }
  if (me.me.status !== 'active') {
    out.unshift(h('div', { class: 'card' }, h('h2', {}, 'Roundtable'), h('p', { class: 'muted' }, 'Ghosts watch the roundtable but do not vote.')));
    return out;
  }
  if (r.phase === 'endcheck') {
    out.unshift(h('div', { class: 'card' }, h('h2', {}, 'End the game?'),
      h('p', {}, 'The game ends only if every remaining player chooses End Game. If any Traitor is still here when it ends, the Traitors take the pot.'),
      r.myEndVote ? h('p', { class: 'good' }, `Your choice: ${r.myEndVote === 'end' ? 'End Game' : 'Banish Again'}. You can change it until the vote closes.`) : null,
      h('button', { class: 'primary block', onclick: act(() => api('/api/end-vote', { choice: 'end' }), load) }, 'End Game'),
      h('button', { class: 'block', onclick: act(() => api('/api/end-vote', { choice: 'continue' }), load) }, 'Banish Again')));
    return out;
  }
  const candidates = r.phase === 'revote' ? r.tied : me.players.filter((p) => p.id !== me.me.id);
  const dagger = me.season.daggers && me.me.daggers ? h('input', { type: 'checkbox', id: 'dagger' }) : null;
  out.unshift(h('div', { class: 'card' },
    h('h2', {}, r.phase === 'revote' ? 'Revote' : 'Who is a Traitor?'),
    h('p', { class: 'muted small' }, 'Your vote is secret until the roundtable closes. You can change it until then.'),
    dagger ? h('label', { class: 'check', for: 'dagger' }, dagger, 'Play my Dagger (this vote counts twice)') : null,
    candidates.filter((p) => p.id !== me.me.id).map((p) => h('button', {
      class: `choice${r.myVote === p.id ? ' selected' : ''}`,
      'aria-pressed': r.myVote === p.id ? 'true' : 'false',
      onclick: act(() => api('/api/vote', { targetId: p.id, useDagger: dagger?.checked }), () => { toast(`Vote saved: ${p.name}`); return load(); }),
    }, h('span', {}, p.name), h('span', { class: 'muted small' }, p.department)))));
  return out;
}

function resultCard(r) {
  const res = r.result.final || r.result.first;
  return h('div', { class: 'card' }, h('h2', {}, `Round ${r.number} result`),
    r.result.banished ? h('p', {}, `${r.result.banished.name} was banished and was ${r.result.banished.role === 'traitor' ? 'a Traitor' : 'Faithful'}.`) : null,
    h('ul', { class: 'list' }, res.totals.map((t) => h('li', {}, `${t.name}: ${t.votes}`))),
    res.ballots ? h('details', {}, h('summary', {}, 'Every vote'), h('ul', { class: 'list' }, res.ballots.map((b) => h('li', {}, `${b.voter} voted for ${b.for}`)))) : null);
}

function role() {
  if (!me.me.roleReady) return h('div', { class: 'card' }, h('h2', {}, 'My Role'), h('p', { class: 'muted' }, 'Roles have not been cast yet.'));
  const secret = h('div', { class: 'secret' }, '');
  const extra = h('div', {});
  const box = h('div', { class: 'reveal', tabindex: 0, role: 'button', 'aria-label': 'Press and hold to see your role' },
    h('p', {}, 'Make sure nobody is looking.'), secret, extra, h('p', { class: 'muted small' }, 'Press and hold to see your role. It hides when you let go.'));
  let holding = false;
  const show = async () => {
    holding = true;
    try {
      const r = await api('/api/role');
      if (!holding) return;
      secret.textContent = r.role === 'traitor' ? 'You are a Traitor' : 'You are Faithful';
      extra.replaceChildren(r.fellowTraitors?.length ? h('p', {}, `Your fellow Traitors: ${r.fellowTraitors.map((t) => t.name).join(', ')}`) : '');
    } catch (e) { toast(e.message); }
  };
  const hide = () => { holding = false; secret.textContent = ''; extra.replaceChildren(); };
  box.addEventListener('pointerdown', (e) => { e.preventDefault(); show(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) box.addEventListener(ev, hide);
  box.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.repeat) { e.preventDefault(); show(); } });
  box.addEventListener('keyup', (e) => { if (e.key === ' ') hide(); });
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', hide);
  const cards = [h('div', { class: 'card' }, h('h2', {}, 'My Role'), box,
    h('p', { class: 'muted small' }, 'Showing anyone your role screen, or a screenshot of it, removes you from the game.'))];
  cards.push(recruitCard());
  return cards;
}

function recruitCard() {
  const card = h('div', { class: 'card hidden' });
  api('/api/role').then((r) => {
    if (!r.recruitOffer) return;
    card.classList.remove('hidden');
    card.replaceChildren(h('h2', {}, 'A secret offer'),
      h('p', {}, 'The last Traitor has invited you to join them. If you accept, you become a Traitor for the rest of the season.'),
      h('button', { class: 'primary block', onclick: act(() => api('/api/recruit/answer', { accept: true }), load) }, 'Accept and become a Traitor'),
      h('button', { class: 'block', onclick: act(() => api('/api/recruit/answer', { accept: false }), load) }, 'Decline and stay Faithful'));
  }).catch(() => {});
  return card;
}

function hideout() {
  const wrap = h('div', {}, h('div', { class: 'card' }, 'Loading the Hideout...'));
  api('/api/hideout').then((d) => {
    const msg = h('textarea', { 'aria-label': 'Message to the Traitors', maxlength: 1000 });
    const cards = [];
    cards.push(h('div', { class: 'card' }, h('h2', {}, 'The Hideout'),
      h('p', { class: 'muted small' }, 'Only Traitors see this. Write as if anyone could read it later, and keep it friendly.')));
    if (d.round?.phase === 'murder') {
      cards.push(h('div', { class: 'card' }, h('h2', {}, 'Choose tonight\'s target'),
        h('p', { class: 'muted small' }, d.murdersPerRound > 1 ? `Each of you names one target. The ${d.murdersPerRound} names with the most votes are murdered, so split your votes. Ties are settled by a random draw.` : 'Most votes wins. A tie is settled by a random draw.'),
        d.votes.length ? h('p', { class: 'small' }, `Votes so far: ${d.votes.map((v) => `${v.traitor} chose ${v.target}`).join('; ')}`) : null,
        d.targets.map((p) => h('button', { class: 'choice', onclick: act(() => api('/api/hideout/vote', { targetId: p.id }), () => { toast(`You chose ${p.name}`); render(); }) },
          h('span', {}, p.name), h('span', { class: 'muted small' }, p.department)))));
    }
    if (d.round && !d.round.sabotageUsed && ['murder', 'day', 'vote', 'revote'].includes(d.round.phase) && d.groupMissions.length) {
      cards.push(h('div', { class: 'card' }, h('h2', {}, 'Sabotage card (once a day)'),
        h('p', { class: 'muted small' }, 'Halves what one open group mission pays. It never touches anyone\'s real work.'),
        d.groupMissions.map((m) => h('button', { class: 'choice', onclick: act(() => api('/api/hideout/sabotage', { missionId: m.id }), load) }, m.title))));
    }
    if (d.round?.recruitOpen) {
      cards.push(h('div', { class: 'card' }, h('h2', {}, 'Recruit one Faithful'),
        h('p', { class: 'muted small' }, 'You are the last Traitor. You may make one secret offer today.'),
        d.targets.map((p) => h('button', { class: 'choice', onclick: act(() => api('/api/hideout/recruit', { targetId: p.id }), () => { toast('Offer sent.'); render(); }) }, p.name))));
    }
    cards.push(h('div', { class: 'card' }, h('h2', {}, 'Traitor talk'), msg,
      h('button', { class: 'primary block', onclick: act(() => api('/api/hideout/message', { text: msg.value }), render) }, 'Send'),
      h('ul', { class: 'list' }, d.messages.map((m) => h('li', {}, h('strong', {}, m.name), ': ', m.text, ' ', h('span', { class: 'muted small' }, when(m.created_at)))))));
    wrap.replaceChildren(...cards);
  }).catch((e) => wrap.replaceChildren(h('div', { class: 'card' }, e.message)));
  return wrap;
}

function more() {
  const concern = h('textarea', { 'aria-label': 'Your concern', maxlength: 2000 });
  const lb = me.leaderboards;
  return [
    h('div', { class: 'card' }, h('h2', {}, 'Leaderboards'),
      h('h3', {}, 'Departments (average points per player)'),
      h('ul', { class: 'list' }, lb.departments.map((d) => h('li', {}, `${d.department}: ${d.average} `, h('span', { class: 'muted small' }, `(${d.players} players)`)))),
      h('h3', {}, 'Players'),
      h('ul', { class: 'list' }, lb.players.map((p) => h('li', {}, `${p.name} (${p.department}): ${p.points}`)))),
    h('div', { class: 'card' }, h('h2', {}, 'How to play'),
      h('ul', {},
        h('li', {}, 'Faithful find and banish the Traitors at the daily roundtable. Traitors try to survive to Friday.'),
        h('li', {}, 'Missions add to the shared pot. Some earn a secret Shield against one murder.'),
        h('li', {}, 'Never play during class time, in front of students, or in student areas.'),
        h('li', {}, 'Lying about your role out loud is part of the game. Touching anyone\'s real work, room or reputation is not.'),
        h('li', {}, 'The prize is free or donated. Nobody pays anything.'))),
    h('div', { class: 'card' }, h('h2', {}, 'Settings'),
      me.me.status === 'active' ? h('button', { class: 'block', onclick: act(() => api('/api/away', { away: !me.me.away }), load) },
        me.me.away ? 'I am back' : 'I am away (out, on leave, at training)') : null,
      h('button', { class: 'block', onclick: () => { document.body.classList.toggle('large'); try { localStorage.setItem('large', document.body.classList.contains('large') ? '1' : '0'); } catch { /* ignore */ } } }, 'Larger text on or off'),
      signOutButton()),
    h('div', { class: 'card' }, h('h2', {}, 'Report a concern'),
      h('p', { class: 'muted small' }, 'Goes privately to the Game Master and the principal sponsor.'), concern,
      h('button', { class: 'block', onclick: act(() => api('/api/concern', { text: concern.value }), () => { concern.value = ''; toast('Sent privately. Thank you.'); }) }, 'Send privately')),
    me.me.status === 'active' || me.me.status === 'invited'
      ? h('div', { class: 'card' }, h('h2', {}, 'Leave the game'),
        h('p', { class: 'muted small' }, 'You can leave at any time, no questions asked. You become a Ghost and keep your points.'),
        h('button', { class: 'danger block', onclick: act(async () => { if (!window.confirm('Leave the game for good?')) throw new Error('Still in the game.'); return api('/api/opt-out', {}); }, load) }, 'Leave the game'))
      : null,
  ];
}

function signOutButton() {
  return h('button', { class: 'block', onclick: act(() => api('/api/logout', {}), load) }, 'Sign out');
}

async function showStory() {
  const st = await api('/api/story');
  root.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'The whole season'),
    h('p', {}, `${st.winner === 'faithful' ? 'The Faithful' : 'The Traitors'} won a pot of ${st.pot}.`),
    h('h3', {}, 'Who was who'),
    h('ul', { class: 'list' }, st.roles.map((r) => h('li', {}, `${r.name} (${r.department}): ${r.role === 'traitor' ? (r.recruited ? 'Traitor (recruited)' : 'Traitor') : 'Faithful'}, ${r.status}`))),
    h('h3', {}, 'Round by round'),
    h('ul', { class: 'list' }, st.rounds.map((r) => h('li', {}, `Round ${r.number}: `,
      r.murder === 'murdered' ? `${r.victims.join(', ')} murdered. ` : r.murder === 'shielded' ? 'A Shield stopped the murder. ' : '',
      r.result?.banished ? `${r.result.banished.name} was banished (${r.result.banished.role}).` : 'Nobody was banished.'))),
    h('h3', {}, 'Check the draw'),
    h('p', { class: 'small' }, `The random seed, kept secret all season: ${st.seed}`),
    h('p', { class: 'small muted' }, `Its fingerprint, shown since casting day: ${st.seedHash}`),
    h('button', { class: 'block', onclick: render }, 'Back')));
}

load();
// Refresh the screens that change on their own, never one with a half-typed answer.
setInterval(() => { if (me && !document.hidden && (tab === 'home' || tab === 'vote')) load(); }, 30000);
