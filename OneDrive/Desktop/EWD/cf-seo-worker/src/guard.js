/* URL safety checks — keeps the worker from being used to reach private
   networks or odd ports (SSRF). Applied to the requested URL and to every
   redirect hop. */

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

function isPrivateIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateIPv6(host) {
  if (!host.startsWith('[')) return false;
  const h = host.slice(1, -1).toLowerCase();
  return h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') ||
    h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb') ||
    h.startsWith('::ffff:');
}

/** Returns a parsed URL, or throws an Error with a user-readable message. */
export function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https URLs can be fetched');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are not allowed');
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') && !host.startsWith('[')) throw new Error('Hostname must be a public domain');
  if (host === 'localhost' || BLOCKED_SUFFIXES.some(s => host.endsWith(s))) throw new Error('Private hostnames are not allowed');
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) throw new Error('Private IP addresses are not allowed');
  if (!ALLOWED_PORTS.has(u.port)) throw new Error(`Port ${u.port} is not allowed`);
  return u;
}
