// Small helpers shared by the player app and the organizer dashboard.
// Every piece of text goes in through textContent, never as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export async function api(path, body) {
  const opts = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
export function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// Wrap a button action: disable while running, show errors as a toast.
export function act(fn, done) {
  return async (e) => {
    const btn = e?.currentTarget;
    if (btn) btn.disabled = true;
    try {
      const r = await fn(e);
      if (done) await done(r);
    } catch (err) {
      toast(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  };
}

export const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function signInCard(onDone, title) {
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'email', required: true });
  const code = h('input', { type: 'text', id: 'code', autocomplete: 'one-time-code', autocapitalize: 'characters' });
  return h('div', { class: 'card' },
    h('h2', {}, title || 'Sign in'),
    h('p', { class: 'muted small' }, 'Use your school email and the sign-in code from the Game Master (printed or sent to you). There are no passwords.'),
    h('label', { for: 'email' }, 'School email'), email,
    h('label', { for: 'code' }, 'Sign-in code'), code,
    h('button', { class: 'primary block', onclick: act(() => api('/api/login', { email: email.value, code: code.value }), onDone) }, 'Sign in'),
    h('button', { class: 'block', onclick: act(() => api('/api/request-code', { email: email.value }), (r) => toast(r.message)) }, 'Send me a new code'),
  );
}
