const OWNER = process.env.GITHUB_OWNER || 'h334dshot-arch';
const REPO = process.env.GITHUB_REPO || 'ZERO-PVE';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = process.env.GITHUB_STATS_PATH || 'server-stats.json';
const TOKEN = process.env.GITHUB_TOKEN;
const API_SECRET = process.env.STATS_API_SECRET || '';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Stats-Secret');
}

function normalizeStats(input) {
  const body = input && typeof input === 'object' ? input : {};
  const players = Array.isArray(body.players)
    ? body.players.map((p) => String(p)).filter(Boolean).slice(0, 128)
    : [];

  return {
    map: String(body.map || body.world || body.mission || 'Unknown'),
    fps: Number.isFinite(Number(body.fps)) ? Math.round(Number(body.fps)) : 0,
    ai: Number.isFinite(Number(body.ai ?? body.ai_characters)) ? Math.round(Number(body.ai ?? body.ai_characters)) : 0,
    vehicles: Number.isFinite(Number(body.vehicles ?? body.registered_vehicles))
      ? Math.round(Number(body.vehicles ?? body.registered_vehicles))
      : 0,
    uptime: String(body.uptime || formatUptime(Number(body.uptime_seconds || 0))),
    updatedAt: new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    }),
    players,
  };
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0h00m';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok) {
    const msg = data && data.message ? data.message : response.statusText;
    throw new Error(`GitHub ${response.status}: ${msg}`);
  }

  return data;
}

async function updateGitHubFile(stats) {
  if (!TOKEN) {
    throw new Error('Missing GITHUB_TOKEN in Vercel environment variables');
  }

  const encodedPath = FILE_PATH.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;
  const current = await githubRequest(`${url}?ref=${encodeURIComponent(BRANCH)}`);
  const content = Buffer.from(`${JSON.stringify(stats, null, 2)}\n`, 'utf8').toString('base64');

  await githubRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update server stats',
      content,
      sha: current.sha,
      branch: BRANCH,
    }),
  });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, endpoint: '/api/server-stats' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (API_SECRET) {
    const provided = req.headers['x-stats-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (provided !== API_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  try {
    const stats = normalizeStats(req.body);
    await updateGitHubFile(stats);
    return res.status(200).json({ ok: true, stats });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
