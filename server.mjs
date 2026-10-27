import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let envText = '';
try { envText = await readFile(path.join(ROOT, '.env'), 'utf8'); } catch {}
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !line.trimStart().startsWith('#') && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const PORT = Number(process.env.PORT || 8765);
const CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.REDDIT_REDIRECT_URI || `http://127.0.0.1:${PORT}/auth/callback`;
const sessions = new Map();
const oauthStates = new Map();
const SESSION_COOKIE = 'amao_session';
const USER_AGENT = 'web:amao-reddit-client:0.3 (personal use)';

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  return raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
}
function sessionFor(req) {
  const sid = cookieValue(req, SESSION_COOKIE);
  return sid ? sessions.get(sid) : undefined;
}
function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self' https: data: blob:; frame-src https:; img-src 'self' https: data:; media-src https: blob:; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'",
    ...headers
  });
  res.end(body);
}
function json(res, status, data) { send(res, status, JSON.stringify(data)); }
function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end();
}

async function exchangeToken(params, grantType) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ ...params, grant_type: grantType }),
    signal: AbortSignal.timeout(15000)
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
  } catch {
    sessions.delete(session.id);
    return null;
  }
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
    if (req.method === 'GET' && url.pathname === '/auth/reddit') {
      if (!CLIENT_ID || !CLIENT_SECRET) {
        return send(res, 503, 'Configure REDDIT_CLIENT_ID e REDDIT_CLIENT_SECRET no .env. Veja README.md.', 'text/plain; charset=utf-8');
      }
      const state = randomBytes(24).toString('hex');
      const sid = randomBytes(24).toString('hex');
      oauthStates.set(state, { sid, createdAt: Date.now() });
      const auth = new URL('https://www.reddit.com/api/v1/authorize');
      auth.search = new URLSearchParams({
        client_id: CLIENT_ID, response_type: 'code', state, redirect_uri: REDIRECT_URI,
        duration: 'permanent', scope: 'read'
      }).toString();
      return redirect(res, auth.toString());
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state') || '';
      const saved = oauthStates.get(state);
      oauthStates.delete(state);
      if (!saved || Date.now() - saved.createdAt > 10 * 60_000 || url.searchParams.has('error')) {
        return send(res, 400, 'OAuth cancelado ou state inválido. Volte ao app e tente novamente.', 'text/plain; charset=utf-8');
      }
      const code = url.searchParams.get('code');
      if (!code) return send(res, 400, 'O Reddit não retornou um código OAuth.', 'text/plain; charset=utf-8');
      const token = await exchangeToken({ code, redirect_uri: REDIRECT_URI }, 'authorization_code');
      sessions.set(saved.sid, {
        id: saved.sid, accessToken: token.access_token, refreshToken: token.refresh_token,
        expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
      });
      return redirect(res, '/', {
        'Set-Cookie': `${SESSION_COOKIE}=${saved.sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`
      });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      const sid = cookieValue(req, SESSION_COOKIE);
      if (sid) sessions.delete(sid);
      return send(res, 204, '', 'text/plain; charset=utf-8', {
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/reddit/search') {
      const session = sessionFor(req);
      const token = await redditToken(session);
      if (!token) return json(res, 401, { error: 'reddit_not_connected' });
      const query = (url.searchParams.get('q') || '').trim().slice(0, 300);
      if (!query) return json(res, 400, { error: 'query_required' });
      const params = new URLSearchParams({
        q: query, limit: '50',
        sort: url.searchParams.get('sort') === 'new' ? 'new' : 'relevance',
        t: 'all', type: 'link', restrict_sr: 'false'
      });
      const after = url.searchParams.get('after');
      if (after) params.set('after', after.slice(0, 120));
      const upstream = await fetch(`https://oauth.reddit.com/search?${params}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (!upstream.ok) return json(res, upstream.status, { error: 'reddit_api_error', status: upstream.status });
      const raw = await upstream.json();
      const items = (raw.data?.children || []).map(({ data: item }) => {
        const video = item.media?.reddit_video || item.secure_media?.reddit_video || item.preview?.reddit_video_preview;
        return {
          id: `rd:${item.name || item.id}`,
          title: item.title,
          url: `https://www.reddit.com${item.permalink}`,
          media: video?.fallback_url || '',
          thumb: /^https?:/.test(item.thumbnail || '') ? item.thumbnail : (item.preview?.images?.[0]?.source?.url || '').replaceAll('&amp;', '&'),
          duration: video?.duration || 0,
          date: new Date(Number(item.created_utc || 0) * 1000).toISOString(),
          community: item.subreddit_name_prefixed || '',
          kind: video?.fallback_url ? 'video' : 'link',
          restricted: Boolean(item.over_18)
        };
      });
      return json(res, 200, { items, after: raw.data?.after || null });
    }
    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
    }
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch (error) {
    console.error('request_failed', { path: new URL(req.url, 'http://localhost').pathname, name: error?.name || 'Error' });
    return json(res, 502, { error: 'upstream_unavailable' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`À mão ativo em http://127.0.0.1:${PORT}`);
  console.log(`Reddit OAuth: ${CLIENT_ID ? 'configurado' : 'pendente (.env)'}`);
});
