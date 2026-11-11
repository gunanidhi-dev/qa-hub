// Minimal hash router with params, query string and an async "leave guard" for unsaved changes.

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/dashboard';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/dashboard', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function buildHash(path, query = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function createRouter(routes, onRoute) {
  const compiled = routes.map((r) => {
    const keys = [];
    const re = new RegExp(`^${r.path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    return { ...r, re, keys };
  });
  let current = null;
  let guard = null;
  let lastHash = location.hash;

  function match(path) {
    for (const r of compiled) {
      const m = r.re.exec(path);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }

  async function handle() {
    const hash = location.hash;
    if (guard && hash !== lastHash) {
      const allowed = await guard();
      if (!allowed) {
        history.replaceState(null, '', lastHash || '#/dashboard');
        return;
      }
    }
    lastHash = hash;
    const { path, query } = parseHash(hash);
    const found = match(path);
    if (!found) {
      location.replace('#/dashboard');
      return;
    }
    current = { path, query, params: found.params, route: found.route };
    onRoute(current);
  }

  return {
    start() {
      window.addEventListener('hashchange', handle);
      if (!location.hash) history.replaceState(null, '', '#/dashboard');
      lastHash = location.hash;
      handle();
    },
    go(path, query = {}, { replace = false } = {}) {
      const hash = buildHash(path, query);
      if (hash === location.hash) return handle();
      if (replace) {
        history.replaceState(null, '', hash);
        handle();
      } else location.hash = hash;
    },
    /** Update the query string without re-rendering (e.g. filters). */
    setQuery(query) {
      const hash = buildHash(current.path, query);
      history.replaceState(null, '', hash);
      lastHash = hash;
      current = { ...current, query };
    },
    refresh: () => current && onRoute(current),
    setGuard(fn) { guard = fn; },
    clearGuard() { guard = null; },
    get current() { return current; },
  };
}
