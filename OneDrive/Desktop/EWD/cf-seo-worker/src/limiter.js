/* Usage limits for public Website Growth scans (Durable Object, free plan).
   One global instance keeps exact counts — unlike KV it has no daily write
   cap and increments are atomic:
     - daily scan sessions per visitor IP and in total
     - a request budget per session (every /fetch, /check, /measure call),
       restricted to the sites the visitor entered for page fetches. */
import { DurableObject } from 'cloudflare:workers';

const SESSION_TTL_MS = 20 * 60 * 1000;

export class Limiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
  }

  async startSession({ ip, hosts, budget, ipDaily, globalDaily }) {
    const day = new Date().toISOString().slice(0, 10);
    const ipKey = `ip:${day}:${ip}`, allKey = `all:${day}`;
    const counts = await this.ctx.storage.get([ipKey, allKey]);
    const ipN = counts.get(ipKey) || 0, allN = counts.get(allKey) || 0;
    if (ipN >= ipDaily) return { error: 'limit_reached' };
    if (allN >= globalDaily) return { error: 'busy' };

    const sid = crypto.randomUUID();
    const session = { hosts, remaining: budget, exp: Date.now() + SESSION_TTL_MS };
    this.sessions.set(sid, session);
    await this.ctx.storage.put({ [ipKey]: ipN + 1, [allKey]: allN + 1, [`s:${sid}`]: session });
    if (Math.random() < 0.05) await this.cleanup(day);
    return { sid, exp: session.exp, budget };
  }

  /** kind: 'fetch' (page bodies — only the session's own sites), 'sitemap' (any host), 'check' or 'measure'. */
  async consume(sid, host, kind) {
    let s = this.sessions.get(sid);
    if (!s) {
      s = await this.ctx.storage.get(`s:${sid}`);
      if (s) this.sessions.set(sid, s);
    }
    if (!s || s.exp < Date.now()) return { error: 'session_expired' };
    if (kind === 'fetch' && !s.hosts.includes(host)) return { error: 'host_not_allowed' };
    if (s.remaining <= 0) return { error: 'budget_exhausted' };
    s.remaining--;
    if (s.remaining % 10 === 0) await this.ctx.storage.put(`s:${sid}`, s); // survive eviction without a write per request
    return { ok: true, remaining: s.remaining };
  }

  async cleanup(today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const keys = await this.ctx.storage.list({ limit: 1000 });
    const stale = [];
    for (const [k, v] of keys) {
      if ((k.startsWith('ip:') || k.startsWith('all:')) && !k.includes(today) && !k.includes(yesterday)) stale.push(k);
      if (k.startsWith('s:') && v.exp < Date.now()) { stale.push(k); this.sessions.delete(k.slice(2)); }
    }
    if (stale.length) await this.ctx.storage.delete(stale.slice(0, 128));
  }
}
