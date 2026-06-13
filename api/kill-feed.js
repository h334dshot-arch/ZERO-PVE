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

async function readJsonFile(path, fallback) {
  if (!TOKEN) {
    throw new Error('Missing GITHUB_TOKEN in Vercel environment variables');
  }

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;

  try {
    const current = await githubRequest(`${url}?ref=${encodeURIComponent(BRANCH)}`);
    const json = Buffer.from(current.content || '', 'base64').toString('utf8');
    const data = JSON.parse(json);
    return Array.isArray(data) ? data : fallback;
  } catch (error) {
    if (error.message.includes('GitHub 404')) {
      return fallback;
    }
    throw error;
  }
}

async function readKillFeed() {
  return readJsonFile(KILL_FEED_PATH, []);
}

function eventTime(event) {
  const value = Date.parse(event.receivedAt || event.timestamp || '');
  return Number.isFinite(value) ? value : 0;
}

function normalizeActor(value) {
  return String(value || '').trim().toLowerCase();
}

function actorType(guid, name) {
  const id = normalizeActor(guid || name);
  if (!id) return 'unknown';
  if (id === 'ai') return 'ai';
  if (id === 'world') return 'world';
  return 'player';
}

function isPlayer(guid, name) {
  return actorType(guid, name) === 'player';
}

function isSuicide(event) {
  if (event.suicide === true) return true;

  const killerGUID = normalizeActor(event.killerGUID);
  const victimGUID = normalizeActor(event.victimGUID);
  if (killerGUID && victimGUID && killerGUID === victimGUID && killerGUID !== 'ai' && killerGUID !== 'world') {
    return true;
  }

  const killerName = normalizeActor(event.killerName);
  const victimName = normalizeActor(event.victimName);
  return Boolean(killerName && victimName && killerName === victimName && killerName !== 'ai' && killerName !== 'world');
}

function parseBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function isTeamKill(event) {
  if (!event) return false;

  const weapon = normalizeActor(event.weapon);
  const victim = normalizeActor(event.victimName);

  return (
    parseBool(event.teamKill ?? event.team_kill ?? event.teamkill ?? event.tk ?? event.isTeamKill ?? event.is_team_kill) ||
    parseBool(event.friendlyFire ?? event.friendly_fire ?? event.isFriendlyFire ?? event.is_friendly_fire) ||
    weapon.includes('friendly') ||
    weapon.includes('team kill') ||
    victim.includes('friendly')
  );
}

function getPlayerKey(guid, name) {
  if (!isPlayer(guid, name)) return '';
  return guid || name || '';
}

function getOrCreatePlayer(players, key, name, guid) {
  const current = players.get(key) || {
    name: name || 'Unknown',
    guid: guid || '',
    kills: 0,
    deaths: 0,
    teamKills: 0,
  };

  current.name = name || current.name;
  current.guid = guid || current.guid;
  players.set(key, current);
  return current;
}

function buildRanking(feed, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const players = new Map();

  for (const event of feed) {
    if (eventTime(event) < cutoff) {
      continue;
    }

    const killerKey = getPlayerKey(event.killerGUID, event.killerName);
    const victimKey = getPlayerKey(event.victimGUID, event.victimName);
    const suicide = isSuicide(event);

    const teamKill = isTeamKill(event);

    if (killerKey && !teamKill && !suicide) {
      const killer = getOrCreatePlayer(players, killerKey, event.killerName, event.killerGUID);
      killer.kills += 1;
    }

    if (victimKey) {
      const victim = getOrCreatePlayer(players, victimKey, event.victimName, event.victimGUID);
      victim.deaths += 1;
    }

    if (killerKey && teamKill) {
      const killer = getOrCreatePlayer(players, killerKey, event.killerName, event.killerGUID);
      killer.teamKills += 1;
    }
  }

  return [...players.values()]
    .map((player) => ({
      ...player,
      score: player.kills - player.teamKills * 2,
    }))
    .sort((a, b) => b.kills - a.kills || b.score - a.score || a.teamKills - b.teamKills || a.deaths - b.deaths)
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
    const weekly = buildRanking(feed, 7);
    const monthly = buildRanking(feed, 30);

    return res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      feed: feed.slice(0, 100),
      weekly,
      monthly,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
