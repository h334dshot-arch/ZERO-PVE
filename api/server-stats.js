const OWNER = process.env.GITHUB_OWNER || 'h334dshot-arch';
const REPO = process.env.GITHUB_REPO || 'ZERO-PVE';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = process.env.GITHUB_STATS_PATH || 'server-stats.json';
const KILL_FEED_PATH = process.env.GITHUB_KILL_FEED_PATH || 'kill-feed.json';
const TOKEN = process.env.GITHUB_TOKEN;
const API_SECRET = process.env.STATS_API_SECRET || '';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Stats-Secret');
}

function normalizeStats(input) {
  const body = input && typeof input === 'object' ? input : {};
  const operation = normalizeOperationName(body.operation || body.operationName || body.map || body.world || body.mission);
  const players = Array.isArray(body.players)
    ? body.players.map((p) => String(p)).filter(Boolean).slice(0, 128)
    : [];

  return {
    map: operation,
    operation,
    sessionKey: normalizeSessionKey(operation),
    fps: Number.isFinite(Number(body.fps)) ? Math.round(Number(body.fps)) : 0,
    ai: Number.isFinite(Number(body.ai ?? body.ai_characters)) ? Math.round(Number(body.ai ?? body.ai_characters)) : 0,
    vehicles: Number.isFinite(Number(body.vehicles ?? body.registered_vehicles))
      ? Math.round(Number(body.vehicles ?? body.registered_vehicles))
      : 0,
    uptime_seconds: Number.isFinite(Number(body.uptime_seconds ?? body.uptimeSeconds))
      ? Math.max(0, Math.round(Number(body.uptime_seconds ?? body.uptimeSeconds)))
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

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0h00m';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function normalizeOperationName(value) {
  const operation = String(value || '').trim();
  if (!operation || operation.toLowerCase() === 'unknown') return 'Unknown';
  return operation;
}

function normalizeSessionKey(value) {
  return normalizeOperationName(value).trim().toLowerCase().replace(/\s+/g, ' ');
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

  await writeGitHubJson(FILE_PATH, stats, 'Update server stats');
}

async function readGitHubFile() {
  if (!TOKEN) {
    throw new Error('Missing GITHUB_TOKEN in Vercel environment variables');
  }

  return readGitHubJson(FILE_PATH);
}

async function readGitHubJson(path, fallback = null) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;
  let current = null;

  try {
    current = await githubRequest(`${url}?ref=${encodeURIComponent(BRANCH)}`);
  } catch (error) {
    if (fallback !== null && error.message.includes('GitHub 404')) {
      return fallback;
    }
    throw error;
  }

  const json = Buffer.from(current.content || '', 'base64').toString('utf8');
  return JSON.parse(json);
}

async function writeGitHubJson(path, data, message) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;
  let sha = null;

  try {
    const current = await githubRequest(`${url}?ref=${encodeURIComponent(BRANCH)}`);
    sha = current.sha;
  } catch (error) {
    if (!error.message.includes('GitHub 404')) {
      throw error;
    }
  }

  const content = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8').toString('base64');
  const body = {
    message,
    content,
    branch: BRANCH,
  };

  if (sha) {
    body.sha = sha;
  }

  await githubRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function normalizeKill(input) {
  const body = input && typeof input === 'object' ? input : {};
  const killerName = String(body.killerName || body.killer_name || 'Unknown');
  const killerGUID = String(body.killerGUID || body.killer_guid || '');
  const victimName = String(body.victimName || body.victim_name || 'Unknown');
  const victimGUID = String(body.victimGUID || body.victim_guid || '');
  const suicide = isSamePlayer(killerGUID, victimGUID, killerName, victimName);
  const friendlyFire = parseBool(
    body.friendlyFire ?? body.friendly_fire ?? body.isFriendlyFire ?? body.is_friendly_fire
  );
  const teamKill =
    parseBool(body.teamKill ?? body.team_kill ?? body.teamkill ?? body.tk ?? body.isTeamKill ?? body.is_team_kill) ||
    friendlyFire ||
    looksLikeTeamKill(body, victimName);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: 'player_killed',
    receivedAt: new Date().toISOString(),
    timestamp: String(body.timestamp || new Date().toISOString()),
    killerName,
    killerGUID,
    victimName,
    victimGUID,
    weapon: String(body.weapon || 'Unknown'),
    vehicleName: String(body.vehicleName || body.vehicle_name || ''),
    distance: String(body.distance || '0'),
    teamKill,
    friendlyFire,
    suicide,
    killerType: getActorType(killerGUID, killerName),
    victimType: getActorType(victimGUID, victimName),
    uptimeSeconds: Number.isFinite(Number(body.uptime_seconds ?? body.uptimeSeconds))
      ? Math.max(0, Math.round(Number(body.uptime_seconds ?? body.uptimeSeconds)))
      : null,
  };
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

function looksLikeTeamKill(body, victimName) {
  const weapon = normalizeActor(body.weapon);
  const victim = normalizeActor(victimName || body.victimName || body.victim_name);
  const eventKind = normalizeActor(body.eventKind || body.event_kind || body.kind || body.type);

  return (
    weapon.includes('friendly') ||
    weapon.includes('team kill') ||
    victim.includes('friendly') ||
    eventKind.includes('teamkill') ||
    eventKind.includes('team_kill') ||
    eventKind === 'tk'
  );
}

function normalizeActor(value) {
  return String(value || '').trim().toLowerCase();
}

function getActorType(guid, name) {
  const id = normalizeActor(guid || name);
  if (!id) return 'unknown';
  if (id === 'ai') return 'ai';
  if (id === 'world') return 'world';
  return 'player';
}

function isSamePlayer(killerGUID, victimGUID, killerName, victimName) {
  const kg = normalizeActor(killerGUID);
  const vg = normalizeActor(victimGUID);
  if (kg && vg && kg === vg && kg !== 'ai' && kg !== 'world') return true;

  const kn = normalizeActor(killerName);
  const vn = normalizeActor(victimName);
  return Boolean(kn && vn && kn === vn && kn !== 'ai' && kn !== 'world');
}

function isKnownMap(map) {
  const value = String(map || '').trim().toLowerCase();
  return Boolean(value && value !== 'unknown');
}

function shouldResetKillFeed(previousStats, nextStats) {
  if (!previousStats || !nextStats) {
    return false;
  }

  const previousUptime = Number(previousStats.uptime_seconds ?? previousStats.uptimeSeconds ?? 0);
  const nextUptime = Number(nextStats.uptime_seconds ?? nextStats.uptimeSeconds ?? 0);
  if (Number.isFinite(previousUptime) && Number.isFinite(nextUptime) && nextUptime + 120 < previousUptime) {
    return true;
  }

  const previousSession = normalizeSessionKey(previousStats.sessionKey || previousStats.operation || previousStats.map);
  const nextSession = normalizeSessionKey(nextStats.sessionKey || nextStats.operation || nextStats.map);
  if (isKnownMap(previousSession) && isKnownMap(nextSession) && previousSession !== nextSession) {
    return true;
  }

  return false;
}

async function resetKillFeedForNewSession(nextStats, preserveNewUptimeEvents) {
  if (!preserveNewUptimeEvents) {
    await writeGitHubJson(KILL_FEED_PATH, [], 'Reset kill feed for new session');
    return;
  }

  const current = await readGitHubJson(KILL_FEED_PATH, []);
  const feed = Array.isArray(current) ? current : [];
  const nextUptime = Number(nextStats.uptime_seconds ?? nextStats.uptimeSeconds ?? 0);
  const preserved = feed.filter((event) => {
    const eventUptime = Number(event.uptimeSeconds);
    return Number.isFinite(eventUptime) && eventUptime <= nextUptime + 120;
  });

  await writeGitHubJson(KILL_FEED_PATH, preserved.slice(0, 5000), 'Reset kill feed for new session');
}

function shouldResetKillFeedForEvent(event, feed) {
  if (!event || !Array.isArray(feed) || !feed.length || event.uptimeSeconds === null) {
    return false;
  }

  const latest = feed.find((item) => Number.isFinite(Number(item.uptimeSeconds)));
  if (!latest) {
    return false;
  }

  return event.uptimeSeconds + 120 < Number(latest.uptimeSeconds);
}

async function appendKillEvent(input) {
  const event = normalizeKill(input);
  const current = await readGitHubJson(KILL_FEED_PATH, []);
  const feed = Array.isArray(current) ? current : [];
  const nextFeed = shouldResetKillFeedForEvent(event, feed) ? [] : feed;
  nextFeed.unshift(event);
  await writeGitHubJson(KILL_FEED_PATH, nextFeed.slice(0, 5000), 'Update kill feed');
  return event;
}

export default async function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    try {
      const stats = await readGitHubFile();
      return res.status(200).json(stats);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: error.message });
    }
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
    const body = await readBody(req);
    if (body.eventType === 'player_killed' || body.event_type === 'player_killed') {
      const kill = await appendKillEvent(body);
      return res.status(200).json({ ok: true, kill });
    }

    const stats = normalizeStats(body);
    const previousStats = await readGitHubFile().catch(() => null);
    await updateGitHubFile(stats);
    if (shouldResetKillFeed(previousStats, stats)) {
      const previousUptime = Number(previousStats?.uptime_seconds ?? previousStats?.uptimeSeconds ?? 0);
      const nextUptime = Number(stats.uptime_seconds ?? stats.uptimeSeconds ?? 0);
      const restarted = Number.isFinite(previousUptime) && Number.isFinite(nextUptime) && nextUptime + 120 < previousUptime;
      await resetKillFeedForNewSession(stats, restarted);
    }
    return res.status(200).json({ ok: true, stats });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
