import { esc, logo, num } from './util.js';
import { MATCH_RE, fetchMatch, fetchRounds, makeSideOf, collect, summarize, avgOf } from './faceit.js';
import { getTeamLogo, setTeamLogo, storeImage } from './storage.js';
import { downloadPng, copyPng } from './export.js';

const TEAM_ID = 'c55b7815-3739-4199-b1b7-d55eade7e489';
const TEAM_NAME = 'TEAM KA6ANbl';
const CARD_TEAM_NAME = 'КАБАНЫ ЕСПОРТС';
const MAX_MATCHES = 25;
const CONCURRENCY = 3;

// FACEIT stat field names per map; verify against a real match response if a column stays at 0.
const SUM_STATS = {
  mvp: ['MVPs'],
  double: ['Double Kills'],
  triple: ['Triple Kills'],
  quadro: ['Quadro Kills'],
  penta: ['Penta Kills'],
  headshots: ['Headshots'],
  damage: ['Damage'],
  utilityCount: ['Utility Count'],
  utilityDamage: ['Utility Damage'],
  flashSuccess: ['Flash Successes'],
  enemiesFlashed: ['Enemies Flashed'],
  sniper: ['Sniper Kills'],
  knife: ['Knife Kills'],
  zeus: ['Zeus Kills'],
  pistol: ['Pistol Kills'],
  entryAttempts: ['Entry Count'],
  entryWins: ['Entry Wins'],
  clutchKills: ['Clutch Kills'],
  c1v1Wins: ['1v1Wins'],
  c1v1Count: ['1v1Count'],
  c1v2Wins: ['1v2Wins'],
  c1v2Count: ['1v2Count'],
};

const PCT_STATS = {
  adr: ['ADR'],
};

const $ = id => document.getElementById(id);
let seasonData = null;

const readStat = (ps, aliases) => {
  for (const key of aliases) {
    const v = num(ps[key]);
    if (v !== null) return v;
  }
  return null;
};

function setSeasonStatus(text, isError = false) {
  const el = $('seasonStatus');
  el.textContent = text;
  el.className = isError ? 'status error' : 'status';
}

function parseLinks(text) {
  const ids = new Set();
  let invalid = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(MATCH_RE);
    if (m) ids.add(m[1]);
    else invalid++;
  }
  return { ids: [...ids], invalid };
}

function ourSide(match) {
  return [1, 2].find(side => {
    const f = match.teams[`faction${side}`];
    return f?.faction_id === TEAM_ID || (f?.name || '').trim().toLowerCase() === TEAM_NAME.toLowerCase();
  }) ?? null;
}

function collectExtras(rounds, norm) {
  const out = new Map();
  for (const r of rounds) {
    for (const team of r.teams || []) {
      if (norm(team) !== 1) continue;
      for (const pl of team.players || []) {
        const ps = pl.player_stats || {};
        if (!out.has(pl.player_id)) out.set(pl.player_id, { sums: {}, pct: {} });
        const acc = out.get(pl.player_id);
        for (const [key, aliases] of Object.entries(SUM_STATS)) {
          acc.sums[key] = (acc.sums[key] || 0) + (readStat(ps, aliases) ?? 0);
        }
        for (const [key, aliases] of Object.entries(PCT_STATS)) {
          const v = readStat(ps, aliases);
          if (v !== null) (acc.pct[key] ??= []).push(v);
        }
      }
    }
  }
  return out;
}

async function processMatch(id) {
  const match = await fetchMatch(id);
  if (match.status !== 'FINISHED') return { skip: 'матч ещё не завершён' };
  const side = ourSide(match);
  if (!side) return { skip: 'команда не найдена в матче' };

  const rounds = await fetchRounds(id);
  const sideOf = makeSideOf(match);
  const norm = team => (sideOf(team) === side ? 1 : 2);
  const { players, maps } = collect(match, rounds, norm);
  const extras = collectExtras(rounds, norm);

  const records = new Map();
  for (const [pid, p] of players) {
    if (p.side !== 1) continue;
    const s = summarize(p);
    const ex = extras.get(pid) || { sums: {}, pct: {} };
    records.set(pid, {
      nick: s.nick,
      maps: p.mapCount,
      R: p.R,
      k: s.k,
      d: s.d,
      a: s.a,
      rtg: s.rtg,
      hsPct: s.hsPct,
      sums: ex.sums,
      pct: Object.fromEntries(Object.keys(PCT_STATS).map(key => [key, avgOf(ex.pct[key] || [])])),
    });
  }
  return { skip: null, maps, records };
}

function aggregate(list) {
  const players = new Map();
  const maps = new Map();
  for (const m of list) {
    for (const [pid, r] of m.records) {
      if (!players.has(pid)) {
        players.set(pid, { nick: r.nick, maps: 0, R: 0, k: 0, d: 0, a: 0, rtg: [], kd: [], swing: [], hs: [], sums: {}, pct: {} });
      }
      const a = players.get(pid);
      a.nick = r.nick;
      a.maps += r.maps;
      a.R += r.R;
      a.k += r.k;
      a.d += r.d;
      a.a += r.a;
      a.rtg.push(r.rtg);
      a.kd.push(r.k / Math.max(r.d, 1));
      a.swing.push(r.k - r.d);
      if (r.hsPct !== null) a.hs.push(r.hsPct);
      for (const [key, v] of Object.entries(r.sums)) a.sums[key] = (a.sums[key] || 0) + v;
      for (const [key, v] of Object.entries(r.pct)) (a.pct[key] ??= []).push(v);
    }
    for (const map of m.maps) {
      if (!maps.has(map.name)) maps.set(map.name, { name: map.name, wins: 0, losses: 0, diff: 0 });
      const ms = maps.get(map.name);
      if (map.s[0] > map.s[1]) ms.wins++;
      else if (map.s[0] < map.s[1]) ms.losses++;
      ms.diff += map.s[0] - map.s[1];
    }
  }
  return {
    players: [...players.values()].sort((x, y) => avgOf(y.rtg) - avgOf(x.rtg)),
    maps: [...maps.values()].sort((x, y) => (y.wins + y.losses) - (x.wins + x.losses)),
  };
}

async function mapLimit(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function seasonCard(index, title, headers, rows) {
  return `<div class="season-item">
    <section class="season-card">
      <header class="sc-head">${logo(getTeamLogo(TEAM_ID), CARD_TEAM_NAME, 'sc-logo')}<div><div class="sc-team">${esc(CARD_TEAM_NAME)}</div><h2>${esc(title)}</h2></div></header>
      <table>
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </section>
    <div class="line">
      <button class="btn" data-action="download" data-index="${index}">Скачать PNG</button>
      <button class="btn" data-action="copy" data-index="${index}">Скопировать картинку</button>
    </div>
  </div>`;
}

function renderSeason() {
  const players = seasonData.players;
  const s = (a, key) => a.sums[key] || 0;
  const sections = [
    ['Общая статистика',
      ['Игрок', 'Карт', 'K', 'D', 'A', 'Ср. рейтинг', 'Ср. K/D', 'K/R', 'Swing за матч', 'HS', 'HS %', '2K', '3K', '4K', '5K', 'MVP'],
      players.map(a => [
        a.nick, a.maps, a.k, a.d, a.a, avgOf(a.rtg).toFixed(2), avgOf(a.kd).toFixed(2),
        (a.k / Math.max(a.R, 1)).toFixed(2), avgOf(a.swing).toFixed(1),
        s(a, 'headshots'), `${Math.round(avgOf(a.hs))}%`,
        s(a, 'double'), s(a, 'triple'), s(a, 'quadro'), s(a, 'penta'), s(a, 'mvp'),
      ])],
    ['Расширенная статистика',
      ['Игрок', 'Урон', 'ADR', 'Гранаты', 'Урон гранатами', 'Успешных флешей', 'Ослеплено врагов'],
      players.map(a => [
        a.nick, s(a, 'damage'), avgOf(a.pct.adr || []).toFixed(1), s(a, 'utilityCount'),
        s(a, 'utilityDamage'), s(a, 'flashSuccess'), s(a, 'enemiesFlashed'),
      ])],
    ['Энтри-статистика',
      ['Игрок', 'Попытки энтри', 'Энтри-убийства', 'Энтри-смерти', 'Разница', '% раундов с энтри', 'Успешность энтри %'],
      players.map(a => {
        const att = s(a, 'entryAttempts'), wins = s(a, 'entryWins'), losses = att - wins;
        return [
          a.nick, att, wins, losses, wins - losses,
          `${(att / Math.max(a.R, 1) * 100).toFixed(1)}%`,
          `${(att ? wins / att * 100 : 0).toFixed(1)}%`,
        ];
      })],
    ['Дополнительно',
      ['Игрок', 'Пистолетные', 'Снайперские', 'Ножевые', 'Zeus'],
      players.map(a => [a.nick, s(a, 'pistol'), s(a, 'sniper'), s(a, 'knife'), s(a, 'zeus')])],
    ['Клатчи',
      ['Игрок', 'Ситуаций', 'Побед в клатчах', 'Клатчей проиграно', 'Успех %', 'Клатч-убийства', '1v1 побед', '1v2 побед'],
      players.map(a => {
        const attempts = s(a, 'c1v1Count') + s(a, 'c1v2Count');
        const won = s(a, 'c1v1Wins') + s(a, 'c1v2Wins');
        return [
          a.nick, attempts, won, attempts - won,
          `${(attempts ? won / attempts * 100 : 0).toFixed(1)}%`,
          s(a, 'clutchKills'), s(a, 'c1v1Wins'), s(a, 'c1v2Wins'),
        ];
      })],
    ['Статистика по картам',
      ['Карта', 'Победы', 'Поражения', 'Win Rate %', 'Разница раундов'],
      seasonData.maps.map(m => {
        const games = m.wins + m.losses;
        return [
          m.name.toUpperCase(), m.wins, m.losses,
          `${(games ? m.wins / games * 100 : 0).toFixed(1)}%`,
          `${m.diff > 0 ? '+' : ''}${m.diff}`,
        ];
      })],
  ];
  $('seasonResults').innerHTML = sections.map(([title, headers, rows], i) => seasonCard(i, title, headers, rows)).join('');
}

async function runSeason() {
  const { ids, invalid } = parseLinks($('seasonLinks').value);
  if (!ids.length) return setSeasonStatus('Вставьте ссылки на матчи FACEIT (по одной в строке).', true);
  if (ids.length > MAX_MATCHES) return setSeasonStatus(`Можно указать не больше ${MAX_MATCHES} матчей.`, true);

  const runBtn = $('seasonRun');
  runBtn.disabled = true;
  const results = [];
  let done = 0;
  const progress = () => setSeasonStatus(`⏳ Загрузка матчей: ${done} из ${ids.length}`);
  progress();

  await mapLimit(ids, CONCURRENCY, async id => {
    try {
      results.push({ id, data: await processMatch(id) });
    } catch (e) {
      results.push({ id, error: e.message });
    }
    done++;
    progress();
  });
  runBtn.disabled = false;

  const ok = results.filter(r => r.data && !r.data.skip);
  const skipped = results.length - ok.length;
  if (!ok.length) {
    return setSeasonStatus(`Не нашёл завершённых матчей с командой ${TEAM_NAME} в этой выборке.`, true);
  }
  seasonData = aggregate(ok.map(r => r.data));
  renderSeason();
  const notes = [
    skipped ? `пропущено ${skipped}` : '',
    invalid ? `не распознано ссылок ${invalid}` : '',
  ].filter(Boolean);
  setSeasonStatus(`✅ Готово: учтено матчей ${ok.length}${notes.length ? `, ${notes.join(', ')}` : ''}.`);
}

async function onResultClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.season-item').querySelector('.season-card');
  const n = Number(btn.dataset.index) + 1;
  const isDownload = btn.dataset.action === 'download';
  setSeasonStatus('⏳ Подготовка картинки...');
  try {
    if (isDownload) {
      await downloadPng(card, `season-${n}.png`);
      setSeasonStatus('✅ Готово!');
    } else {
      await copyPng(card);
      setSeasonStatus('✅ Картинка скопирована в буфер обмена!');
    }
  } catch {
    setSeasonStatus('Не удалось выполнить экспорт картинки.', true);
  }
}

async function saveSeasonLogo() {
  const fileInput = $('seasonLogoFile');
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    await storeImage(file, url => setTeamLogo(TEAM_ID, url));
    if (seasonData) renderSeason();
    setSeasonStatus('✅ Логотип команды сохранён!');
  } catch (e) {
    setSeasonStatus(e.message, true);
  }
}

export function initSeason() {
  $('seasonRun').onclick = runSeason;
  $('seasonLogoBtn').onclick = () => $('seasonLogoFile').click();
  $('seasonLogoFile').onchange = saveSeasonLogo;
  $('seasonResults').onclick = onResultClick;
}
