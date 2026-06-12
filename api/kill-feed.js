const OWNER = process.env.GITHUB_OWNER || 'h334dshot-arch';
const REPO = process.env.GITHUB_REPO || 'ZERO-PVE';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const KILL_FEED_PATH = process.env.GITHUB_KILL_FEED_PATH || 'kill-feed.json';
const TOKEN = process.env.GITHUB_TOKEN;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Stats-Secret');
  res.setHeader('Cache-Control', 'no-store');
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

async function readKillFeed() {
  if (!TOKEN) {
    throw new Error('Missing GITHUB_TOKEN in Vercel environment variables');
  }

  const encodedPath = KILL_FEED_PATH.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;

  try {
    const current = await githubRequest(`${url}?ref=${encodeURIComponent(BRANCH)}`);
    const json = Buffer.from(current.content || '', 'base64').toString('utf8');
    const feed = JSON.parse(json);
    return Array.isArray(feed) ? feed : [];
  } catch (error) {
    if (error.message.includes('GitHub 404')) {
      return [];
    }
    throw error;
  }
}

function eventTime(event) {
  const value = Date.parse(event.receivedAt || event.timestamp || '');
  return Number.isFinite(value) ? value : 0;
}

function buildRanking(feed, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const players = new Map();

  for (const event of feed) {
    if (eventTime(event) < cutoff || event.teamKill) {
      continue;
    }

    const key = event.killerGUID || event.killerName;
    if (!key || key === 'AI' || key === 'World') {
      continue;
    }

    const current = players.get(key) || {
      name: event.killerName || 'Unknown',
      guid: event.killerGUID || '',
      kills: 0,
      deaths: 0,
      teamKills: 0,
    };

    current.name = event.killerName || current.name;
    current.kills += 1;
    players.set(key, current);
  }

  for (const event of feed) {
    if (eventTime(event) < cutoff) {
      continue;
    }

    const victimKey = event.victimGUID || event.victimName;
    if (victimKey && victimKey !== 'AI' && victimKey !== 'World') {
      const victim = players.get(victimKey) || {
        name: event.victimName || 'Unknown',
        guid: event.victimGUID || '',
        kills: 0,
        deaths: 0,
        teamKills: 0,
      };
      victim.name = event.victimName || victim.name;
      victim.deaths += 1;
      players.set(victimKey, victim);
    }

    if (event.teamKill) {
      const killerKey = event.killerGUID || event.killerName;
      if (killerKey && killerKey !== 'AI' && killerKey !== 'World') {
        const killer = players.get(killerKey) || {
          name: event.killerName || 'Unknown',
          guid: event.killerGUID || '',
          kills: 0,
          deaths: 0,
          teamKills: 0,
        };
        killer.teamKills += 1;
        players.set(killerKey, killer);
      }
    }
  }

  return [...players.values()]
    .map((player) => ({
      ...player,
      score: player.kills - player.teamKills * 2,
    }))
    .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths)
    .slice(0, 50);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const feed = await readKillFeed();
    return res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      feed: feed.slice(0, 100),
      weekly: buildRanking(feed, 7),
      monthly: buildRanking(feed, 30),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
