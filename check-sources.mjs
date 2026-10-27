import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = {};
try {
  const envFile = await readFile(path.join(root, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !line.trimStart().startsWith('#')) {
      config[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch {}
const env = key => process.env[key] || config[key] || '';

async function check(label, action) {
  try {
    const detail = await action();
    console.log(`${label}: ${detail}`);
  } catch (error) {
    const reason = error?.cause?.code || error?.code || error?.name || 'erro';
    console.log(`${label}: falhou (${reason})`);
  }
}

console.log('Teste neutro de conectividade; nenhuma consulta pessoal será enviada.');

await check('Eporner API', async () => {
  const url = new URL('https://www.eporner.com/api/v2/video/search/');
  url.search = new URLSearchParams({ query: 'sample', per_page: '1', page: '1', order: 'latest', format: 'json', gay: '2' });
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
  if (!response.ok) return `HTTP ${response.status}`;
  const data = await response.json();
  return `HTTP ${response.status}; JSON válido; ${Array.isArray(data.videos) ? data.videos.length : 0} resultado(s) nesta página`;
});

await check('Pornhub Webmaster endpoint', async () => {
  const url = new URL('https://www.pornhub.com/webmasters/search');
  url.searchParams.set('search', 'sample');
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' }, redirect: 'follow' });
  const type = response.headers.get('content-type') || 'tipo não informado';
  const body = await response.text();
  let shape = 'resposta não JSON';
  try {
    const data = JSON.parse(body);
    shape = Array.isArray(data.videos) ? `JSON; ${data.videos.length} resultado(s) nesta página` : 'JSON sem campo videos';
  } catch {}
  return `HTTP ${response.status}; ${type}; ${shape}`;
});

await check('RedGIFs site', async () => {
  const response = await fetch('https://www.redgifs.com/', { signal: AbortSignal.timeout(12000), redirect: 'follow' });
  return `HTTP ${response.status}; isto confirma apenas o site, não uma API pública`;
});
console.log('RedGIFs API: sem endpoint público oficial documentado; não testei endpoint interno/não documentado.');

if (env('REDDIT_CLIENT_ID') && env('REDDIT_CLIENT_SECRET')) {
  console.log('Reddit OAuth: credenciais encontradas sem exibir valores; teste o fluxo em http://127.0.0.1:8766/auth/reddit (ou na porta configurada).');
} else {
  console.log('Reddit OAuth: sem client ID/secret em .env; não é possível iniciar OAuth.');
}

if (env('BRAVE_API_KEY')) {
  await check('Brave Video Search API', async () => {
    const response = await fetch('https://api.search.brave.com/res/v1/videos/search', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { 'x-subscription-token': env('BRAVE_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ q: 'sample', count: 1, country: 'ALL', safesearch: 'strict' })
    });
    if (!response.ok) return `HTTP ${response.status}`;
    const data = await response.json();
    return `HTTP ${response.status}; ${Array.isArray(data.results) ? data.results.length : 0} resultado(s) de vídeo`;
  });
} else {
  console.log('Brave Video Search API: sem BRAVE_API_KEY em .env; não testada.');
}

