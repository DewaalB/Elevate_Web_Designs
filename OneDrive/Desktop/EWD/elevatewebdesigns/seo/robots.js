/* robots.txt parsing and matching, following RFC 9309 (as Google does):
   the most specific user-agent group wins, the longest matching rule
   wins, and on a tie Allow beats Disallow. Supports * and $ wildcards. */

export const AUDIT_AGENT = 'elevateseoaudit';

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let group = null;
  let lastWasAgent = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!group || !lastWasAgent) { group = { agents: [], rules: [], crawlDelay: null }; groups.push(group); }
      group.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (!group) continue;
    if (field === 'allow' || field === 'disallow') {
      if (value) group.rules.push({ allow: field === 'allow', path: value });
      // An empty Disallow means "allow everything" — no rule needed.
    } else if (field === 'crawl-delay') {
      const n = parseFloat(value);
      if (Number.isFinite(n)) group.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

/** Rules that apply to a crawler, e.g. 'googlebot' or AUDIT_AGENT. */
export function rulesFor(parsed, agent) {
  agent = agent.toLowerCase();
  let best = null, bestLen = -1;
  for (const g of parsed.groups) {
    for (const a of g.agents) {
      if (a !== '*' && agent.includes(a) && a.length > bestLen) { best = a; bestLen = a.length; }
    }
  }
  const match = best ?? '*';
  const groups = parsed.groups.filter(g => g.agents.includes(match));
  return {
    agent: match,
    rules: groups.flatMap(g => g.rules),
    crawlDelay: groups.map(g => g.crawlDelay).find(d => d != null) ?? null,
  };
}

function ruleRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** pathWithQuery: e.g. '/shop?page=2'. */
export function isAllowed(rules, pathWithQuery) {
  let verdict = true, bestLen = -1;
  for (const r of rules) {
    if (!ruleRegex(r.path).test(pathWithQuery)) continue;
    const len = r.path.length;
    if (len > bestLen || (len === bestLen && r.allow)) { verdict = r.allow; bestLen = len; }
  }
  return verdict;
}
