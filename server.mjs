import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
function readEnv() {
  try {
    const raw = requireEnvFile;
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
}
let requireEnvFile = '';
try { requireEnvFile = await readFile(path.join(ROOT, '.env'), 'utf8'); } catch {}
readEnv();

const PORT = Number(process.env.PORT || 8765);
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const REDDIT_REDIRECT_URI = process.env.REDDIT_REDIRECT_URI || `http://127.0.0.1:${PORT}/auth/callback`;
const sessions = new Map();
const oauthStates = new Map();
const SESSION_COOKIE = 'amao_session';
const USER_AGENT = 'web:local-media-scroller:0.2 (personal use)';

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  return raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
}
function sessionFor(req) {
  const sid = cookieValue(req, SESSION_COOKIE);
  return sid ? sessions.get(sid) : undefined;
}
function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self' https: data: blob:; frame-src https:; img-src 'self' https: data:; media-src https: blob:; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'", ...headers });
  res.end(body);
}
function json(res, status, data) { send(res, status, JSON.stringify(data)); }
function redirect(res, location, headers = {}) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers }); res.end(); }

async function exchangeToken(params, grantType) {
  const basic = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ ...params, grant_type: grantType })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Reddit OAuth ${response.status}: ${data.error || 'token unavailable'}`);
  return data;
}
async function redditToken(session) {
  if (!session?.accessToken) return null;
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;
  if (!session.refreshToken) { sessions.delete(session.id); return null; }
  try {
    const data = await exchangeToken({ refresh_token: session.refreshToken }, 'refresh_token');
    session.accessToken = data.access_token;
    session.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    return session.accessToken;
  } catch { sessions.delete(session.id); return null; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, await readFile(path.join(ROOT, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, { reddit: Boolean(await redditToken(sessionFor(req))) });
    }
    if (req.method === 'GET' && url.pathname === '/api/eporner') {
      const allowed = new URLSearchParams();
      for (const key of ['query', 'per_page', 'page', 'order', 'format', 'gay']) if (url.searchParams.has(key)) allowed.set(key, url.searchParams.get(key));
      const upstream = await fetch(`https://www.eporner.com/api/v2/video/search/?${allowed}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      return send(res, upstream.status, await upstream.text());
    }
    if (req.method === 'GET' && url.pathname === '/api/pornhub') {
      const query = (url.searchParams.get('query') || '').trim().slice(0, 300);
      if (!query) return json(res, 400, { error: 'query_required' });
      const page = String(Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)));
      const sort = url.searchParams.get('order') || 'latest';
      const ordering = sort === 'top-weekly' ? 'mostviewed' : sort === 'most-popular' ? 'mostviewed' : 'newest';
      const params = new URLSearchParams({ search: query, page, ordering });
      if (sort === 'top-weekly') params.set('period', 'weekly');
      const upstream = await fetch(`https://www.pornhub.com/webmasters/search?${params}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      return send(res, upstream.status, await upstream.text());
    }
    if (req.method === 'GET' && url.pathname === '/auth/reddit') {
      if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return send(res, 503, 'Configure REDDIT_CLIENT_ID e REDDIT_CLIENT_SECRET no .env para conectar o Reddit. Feche esta aba e veja README.md.', 'text/plain; charset=utf-8');
      const state = randomBytes(24).toString('hex');
      const sid = randomBytes(24).toString('hex');
      oauthStates.set(state, { sid, createdAt: Date.now() });
      const auth = new URL('https://www.reddit.com/api/v1/authorize');
      auth.search = new URLSearchParams({ client_id: REDDIT_CLIENT_ID, response_type: 'code', state, redirect_uri: REDDIT_REDIRECT_URI, duration: 'permanent', scope: 'read' }).toString();
      return redirect(res, auth.toString());
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state') || '';
      const saved = oauthStates.get(state); oauthStates.delete(state);
      if (!saved || Date.now() - saved.createdAt > 10 * 60_000 || url.searchParams.has('error')) return send(res, 400, 'OAuth cancelado ou state inválido. Volte ao app e tente novamente.', 'text/plain; charset=utf-8');
      const code = url.searchParams.get('code');
      if (!code) return send(res, 400, 'O Reddit não retornou um código OAuth.', 'text/plain; charset=utf-8');
      const token = await exchangeToken({ code, redirect_uri: REDDIT_REDIRECT_URI }, 'authorization_code');
      sessions.set(saved.sid, { id: saved.sid, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 });
      return redirect(res, '/', { 'Set-Cookie': `${SESSION_COOKIE}=${saved.sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      const sid = cookieValue(req, SESSION_COOKIE); if (sid) sessions.delete(sid);
      return send(res, 204, '', 'text/plain; charset=utf-8', { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    if (req.method === 'GET' && url.pathname === '/api/reddit/search') {
      const session = sessionFor(req), token = await redditToken(session);
      if (!token) return json(res, 401, { error: 'reddit_not_connected' });
      const q = (url.searchParams.get('q') || '').trim().slice(0, 300);
      if (!q) return json(res, 400, { error: 'query_required' });
      const p = new URLSearchParams({ q, limit: '50', sort: url.searchParams.get('sort') === 'new' ? 'new' : 'relevance', t: 'all', type: 'link', restrict_sr: 'false' });
      const after = url.searchParams.get('after'); if (after) p.set('after', after.slice(0, 120));
      const upstream = await fetch(`https://oauth.reddit.com/search?${p}`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (!upstream.ok) return json(res, upstream.status, { error: 'reddit_api_error', status: upstream.status });
      const raw = await upstream.json();
      const items = (raw.data?.children || []).map(({ data: x }) => {
        const redditVideo = x.media?.reddit_video || x.secure_media?.reddit_video;
        const previewVideo = x.preview?.reddit_video_preview;
        const sourceUrl = x.url_overridden_by_dest || x.url || `https://www.reddit.com${x.permalink}`;
        return {
          id: `rd:${x.name || x.id}`, title: x.title, url: `https://www.reddit.com${x.permalink}`,
          media: redditVideo?.fallback_url || previewVideo?.fallback_url || '',
          thumb: /^https?:/.test(x.thumbnail || '') ? x.thumbnail : (x.preview?.images?.[0]?.source?.url || '').replaceAll('&amp;', '&'),
          duration: redditVideo?.duration || previewVideo?.duration || 0, date: new Date(Number(x.created_utc || 0) * 1000).toISOString(),
          kind: (redditVideo?.fallback_url || previewVideo?.fallback_url) ? 'native' : 'link', over18: Boolean(x.over_18), sourceUrl
        };
      });
      return json(res, 200, { items, after: raw.data?.after || null });
    }
    if (req.method === 'GET' && url.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch (error) {
    console.error('request_failed', { path: new URL(req.url, 'http://localhost').pathname, name: error?.name || 'Error' });
    return json(res, 502, { error: 'upstream_unavailable' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`À mão ativo em http://127.0.0.1:${PORT}`);
  console.log(`Reddit OAuth: ${REDDIT_CLIENT_ID ? 'configurado' : 'pendente (.env)'}`);
});

