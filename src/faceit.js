import { num, sleep } from './util.js';

const API = 'https://open.faceit.com/data/v4/';
const API_KEY = 'Bearer 1fd29ee8-74a6-4518-8d3d-5ea62ac2f1a6';
const MAP_FALLBACK = 'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/';

export const MATCH_RE = /https?:\/\/\S*?(1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\S*/i;

export async function faceitGet(path) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API + path, { headers: { Authorization: API_KEY } });
    } catch {
      throw new Error('Нет связи с FACEIT. Проверьте интернет.');
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429) throw new Error('FACEIT временно ограничил запросы. Попробуйте через минуту.');
    if (res.status === 404) throw new Error('Не найдено на FACEIT. Проверьте ссылку.');
    if (!res.ok) throw new Error(`Ошибка FACEIT (${res.status}). Попробуйте позже.`);
    return res.json();
  }
}

export const fetchMatch = id => faceitGet(`matches/${id}`);

export async function fetchRounds(id) {
  const stats = await faceitGet(`matches/${id}/stats`);
  return [...(stats.rounds || [])].sort((a, b) => a.match_round - b.match_round);
}

export function makeSideOf(match) {
  const f = match.teams;
  return team => {
    if (team.team_id === f.faction1.faction_id) return 1;
    if (team.team_id === f.faction2.faction_id) return 2;
    const ids = (team.players || []).map(p => p.player_id);
    return (f.faction1.roster || []).some(p => ids.includes(p.player_id)) ? 1 : 2;
  };
}

function mapImage(match, mapId, key) {
  if (!key) return null;
  const entities = match.voting?.map?.entities || [];
  const ent = entities.find(e => e.class_name === mapId || (e.name || '').toLowerCase() === key);
  return ent?.image_lg || ent?.image_sm || `${MAP_FALLBACK}de_${key}.png`;
}

export function collect(match, rounds, sideOf) {
  const players = new Map();
  const maps = [];
  for (const r of rounds) {
    const rs = r.round_stats || {};
    const key = (rs.Map || '').replace(/^de_/, '');
    const played = Number(rs.Rounds) || (rs.Score || '').split('/').reduce((s, x) => s + (Number(x) || 0), 0);
    const roundTeams = r.teams || [];

    const finalScore = side => num(roundTeams.find(t => sideOf(t) === side)?.team_stats?.['Final Score']);
    let s1 = finalScore(1), s2 = finalScore(2);
    if (s1 === null || s2 === null) [s1, s2] = (rs.Score || '').split('/').map(x => Number(x) || 0);
    maps.push({ name: key, img: mapImage(match, rs.Map, key), s: [s1, s2] });

    for (const team of roundTeams) {
      const side = sideOf(team);
      for (const pl of team.players || []) {
        const ps = pl.player_stats || {};
        if (!players.has(pl.player_id)) {
          players.set(pl.player_id, { nick: pl.nickname, side, k: 0, d: 0, a: 0, t3: 0, t4: 0, t5: 0, R: 0, adr_w: 0, hs: [], ratings: [], mapCount: 0 });
        }
        const p = players.get(pl.player_id);
        p.mapCount++;
        p.R += played;
        p.k += num(ps.Kills) || 0;
        p.d += num(ps.Deaths) || 0;
        p.a += num(ps.Assists) || 0;
        p.t3 += num(ps['Triple Kills']) || 0;
        p.t4 += num(ps['Quadro Kills']) || 0;
        p.t5 += num(ps['Penta Kills']) || 0;
        const adr = num(ps.ADR);
        p.adr_w += adr !== null ? adr * played : (num(ps.Damage) || 0);
        const hs = num(ps['Headshots %']);
        if (hs !== null) p.hs.push(hs);
        p.ratings.push(['Rating', 'FACEIT Rating', 'Player Rating'].map(k => num(ps[k])).find(v => v !== null) ?? null);
      }
    }
  }
  return { players, maps };
}

export const avgOf = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export function calcRating(p) {
  const R = Math.max(p.R, 1);
  const kpr = p.k / R, dpr = p.d / R, apr = p.a / R;
  const mk = (p.k + 4 * p.t3 + 9 * p.t4 + 16 * p.t5) / R / 1.4;
  const imp = 2.13 * kpr + 0.42 * apr - 0.41;
  const kast = Math.min(1, Math.max(0.45, (kpr + 0.7 * apr + (1 - dpr)) * 0.58));
  return 0.73 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * imp + 0.0032 * (p.adr_w / R) + 0.1587 + mk * 0.05;
}

export function summarize(p) {
  const R = Math.max(p.R, 1);
  const rtg = p.ratings.every(v => v !== null)
    ? avgOf(p.ratings)
    : calcRating(p);
  return {
    nick: p.nick,
    k: p.k,
    d: p.d,
    a: p.a,
    adr: (p.adr_w / R).toFixed(1),
    hsPct: p.hs.length ? avgOf(p.hs) : null,
    rtg,
  };
}
