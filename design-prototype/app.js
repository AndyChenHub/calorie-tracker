/* Plate — AI calorie tracker (demo, no backend). */
(() => {
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- Icons ---------------- */
const svg = (p, extra = '') => `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg></span>`;
const I = {
  flame: svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  minus: svg('<path d="M5 12h14"/>', 'stroke-width="2.4"'),
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>'),
  sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>'),
  scan: svg('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>'),
  barcode: svg('<path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14"/>', 'stroke-width="1.6"'),
  label: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  bookmark: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  dumbbell: svg('<path d="m6.5 6.5 11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 'stroke-width="2.4"'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 'stroke-width="2.6"'),
  zap: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>', 'stroke-width="2.4"'),
  activity: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  drop: svg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>'),
  drum: svg('<path d="M15.4 15.63a7.88 6 135 1 1 6.23-6.23 4.3 3.3 135 0 0-6.23 6.23"/><path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59"/>'),
  wheat: svg('<path d="M2 22 16 8"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/>'),
  heart: svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 15l.7 2.1 2.3.9-2.3.7L19 21l-.7-2.3L16 18l2.3-.9z"/>'),
  swap: svg('<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  scale: svg('<path d="M12 3v3M5 21h14a2 2 0 0 0 2-2l-1.5-9a2 2 0 0 0-2-1.7h-11a2 2 0 0 0-2 1.7L3 19a2 2 0 0 0 2 2z"/><path d="m12 13 2-3"/>'),
  down: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>', 'stroke-width="2.4"'),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="m9 20 3-6 3 3v4M7 12l3-4 4 1 3 3M10 8l-1 5"/>'),
};

/* ---------------- Data ---------------- */
const FOODS = [
  { id: 'avocado-toast', name: 'Avocado Toast & Egg', kcal: 420, p: 18, c: 38, f: 22, health: 8, ing: [['Sourdough', 180], ['Avocado', 160], ['Poached egg', 72], ['Chili flakes', 8]] },
  { id: 'poke-bowl', name: 'Salmon Poke Bowl', kcal: 610, p: 34, c: 68, f: 21, health: 9, ing: [['Sushi rice', 260], ['Salmon', 190], ['Avocado', 80], ['Edamame', 50], ['Cucumber', 10], ['Sesame', 20]] },
  { id: 'yogurt-bowl', name: 'Greek Yogurt & Berries', kcal: 310, p: 20, c: 42, f: 7, health: 9, ing: [['Greek yogurt', 150], ['Granola', 100], ['Berries', 35], ['Honey', 25]] },
  { id: 'chicken-salad', name: 'Chicken Caesar Salad', kcal: 480, p: 42, c: 16, f: 27, health: 7, ing: [['Grilled chicken', 220], ['Caesar dressing', 140], ['Croutons', 70], ['Parmesan', 40], ['Romaine', 10]] },
  { id: 'pasta', name: 'Spaghetti Bolognese', kcal: 720, p: 32, c: 92, f: 24, health: 6, ing: [['Spaghetti', 380], ['Beef ragù', 270], ['Parmesan', 60], ['Basil', 10]] },
  { id: 'smoothie', name: 'Green Smoothie', kcal: 240, p: 6, c: 46, f: 4, health: 9, ing: [['Banana', 105], ['Spinach', 10], ['Mango', 70], ['Chia seeds', 55]] },
  { id: 'burger', name: 'Cheeseburger & Fries', kcal: 1080, p: 41, c: 96, f: 58, health: 3, ing: [['Brioche bun', 220], ['Beef patty', 300], ['Cheddar', 110], ['Fries', 420], ['Sauce', 30]] },
  { id: 'oats', name: 'PB Banana Overnight Oats', kcal: 460, p: 17, c: 58, f: 18, health: 8, ing: [['Rolled oats', 190], ['Peanut butter', 190], ['Banana', 55], ['Chia', 25]] },
];
const EXERCISES = [
  { name: 'Run', minutes: 30, kcal: 310, intensity: 'High', icon: 'activity', desc: '30 min · 5:40 /km' },
  { name: 'Weight lifting', minutes: 45, kcal: 220, intensity: 'Medium', icon: 'dumbbell', desc: '45 min · full body' },
  { name: 'Walk', minutes: 40, kcal: 150, intensity: 'Low', icon: 'walk', desc: '40 min · easy pace' },
];
const food = id => FOODS.find(f => f.id === id);
const imgSrc = id => `assets/${id}.jpg`;
const img = (id, cls = '') => `<img class="${cls}" src="${imgSrc(id)}" alt="" loading="lazy" draggable="false">`;

const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = n => Math.round(n).toLocaleString('en-US');
const tm = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const uid = () => Math.random().toString(36).slice(2, 10);
const TODAY = dkey(new Date());
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------------- State ---------------- */
const KEY = 'plate.v1';
const defaults = () => ({
  goals: { kcal: 2250, p: 160, c: 220, f: 70, water: 8, steps: 10000 },
  logs: {}, water: {}, steps: {},
  prefs: { addBurned: true, rollover: false, reminders: true },
  profile: { name: 'Alex Morgan', weight: 78.4, goalWeight: 72, start: 84.6, height: 180 },
  ui: { eaten: false },
});
function seed(s) {
  const rnd = mulberry(42);
  for (let i = 1; i < 21; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dkey(d);
    const pool = [...FOODS].sort(() => rnd() - .5).slice(0, 3 + (i % 2));
    s.logs[k] = pool.map((f, j) => mkFood(f.id, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8 + j * 4, 10 + j * 7)));
    if (i % 3 === 0) s.logs[k].push(mkEx(EXERCISES[i % 3], new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 30)));
    s.water[k] = 4 + Math.floor(rnd() * 5);
    s.steps[k] = 5200 + Math.floor(rnd() * 6500);
  }
  const ago = h => new Date(Date.now() - h * 3600e3);
  s.logs[TODAY] = [mkFood('poke-bowl', ago(.6)), mkEx(EXERCISES[0], ago(2.4)), mkFood('yogurt-bowl', ago(3.3))];
  s.water[TODAY] = 3; s.steps[TODAY] = 6240;
}
function mkFood(fid, date) { return { id: uid(), type: 'food', food: fid, servings: 1, time: date.toISOString(), status: 'done' }; }
function mkEx(ex, date) { return { id: uid(), type: 'exercise', name: ex.name, minutes: ex.minutes, kcal: ex.kcal, intensity: ex.intensity, icon: ex.icon, time: date.toISOString() }; }
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.goals) { Object.values(s.logs).flat().forEach(e => { if (e.status === 'pending') e.status = 'done'; }); return s; } } catch (e) {}
  const s = defaults(); seed(s); return s;
}
let S = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
let sel = TODAY;

function totals(k) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, burned: 0 };
  (S.logs[k] || []).forEach(e => {
    if (e.type === 'exercise') { t.burned += e.kcal; return; }
    if (e.status !== 'done') return;
    const f = food(e.food), m = e.servings;
    t.kcal += f.kcal * m; t.p += f.p * m; t.c += f.c * m; t.f += f.f * m;
  });
  return t;
}
function streak() {
  let n = 0; const d = new Date();
  if (!(S.logs[dkey(d)] || []).some(e => e.type === 'food')) d.setDate(d.getDate() - 1);
  while ((S.logs[dkey(d)] || []).some(e => e.type === 'food')) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------------- Ring + count helpers ---------------- */
const lastPct = {}, lastNum = {};
function ring(key, size, sw, pct, color, inner = '', track = '#EFEFF2', dash = '') {
  pct = Math.max(0, Math.min(1, pct || 0));
  const r = (size - sw) / 2, C = 2 * Math.PI * r, from = lastPct[key] ?? 0; lastPct[key] = pct;
  const h = size / 2;
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>
    <circle class="rv" data-to="${C * (1 - pct)}" data-c="${C}" cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="${pct > .01 ? 'round' : 'butt'}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - from)}" transform="rotate(-90 ${h} ${h})"/>
  </svg><div class="ring-in">${inner}</div></div>`;
}
function kick(root = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.rv[data-to]', root).forEach(c => { c.style.strokeDashoffset = c.dataset.to; })));
}
function countUp(el, key, to) {
  if (!el) return;
  const from = lastNum[key] ?? 0; lastNum[key] = to;
  const t0 = performance.now(), d = 900;
  const step = t => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---------------- Home ---------------- */
function renderWeek() {
  const now = new Date(), dow = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - dow);
  let h = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const k = dkey(d), fut = d > now && k !== TODAY, t = totals(k), pct = t.kcal / S.goals.kcal;
    const col = pct > 1.08 ? 'var(--p)' : '#0B0B0C';
    h += `<button class="day ${k === sel ? 'sel' : ''} ${fut ? 'future' : ''}" data-k="${k}">
      <div class="d-ring">${ring('wk' + k, 36, 2.5, pct, col, '', t.kcal ? '#E6E6EA' : '#CFCFD5', t.kcal ? '' : '2.5 3.2')}<span class="d-l">${'MTWTFSS'[i]}</span></div>
      <span class="d-n">${d.getDate()}</span></button>`;
  }
  $('#week').innerHTML = h;
  $$('.day', $('#week')).forEach(b => b.onclick = () => { sel = b.dataset.k; renderHome(); });
}

function renderSummary() {
  const t = totals(sel), g = S.goals;
  const budget = g.kcal + (S.prefs.addBurned ? t.burned : 0);
  const left = budget - t.kcal, eaten = S.ui.eaten;
  const big = eaten ? t.kcal : Math.abs(left);
  const over = !eaten && left < 0;
  const mac = (k, name, color, icon) => {
    const v = t[k], goal = g[k], l = goal - v;
    const val = eaten ? Math.round(v) : Math.abs(Math.round(l));
    const lbl = eaten ? `${name} <b>eaten</b>` : (l < 0 ? `${name} <b class="over">over</b>` : `${name} left`);
    return `<div class="card macro"><div><div class="v num">${val}g</div><div class="l">${lbl}</div></div>
      ${ring('m' + k, 66, 6.5, v / goal, color, `<span class="${'c' + k}">${icon}</span>`)}</div>`;
  };
  $('#page-1').innerHTML = `
    <div class="card hero" id="hero">
      <div><div class="big num"><span id="big">${fmt(lastNum.big ?? 0)}</span></div>
      <div class="lbl ${over ? 'over' : ''}">Calories <b>${eaten ? 'eaten' : over ? 'over' : 'left'}</b> ${I.swap.replace('class="ic"', 'class="ic swap"')}</div></div>
      ${ring('hero', 118, 10, t.kcal / budget, over ? 'var(--p)' : '#0B0B0C', I.flame)}
    </div>
    <div class="macros">${mac('p', 'Protein', 'var(--p)', I.drum)}${mac('c', 'Carbs', 'var(--c)', I.wheat)}${mac('f', 'Fats', 'var(--f)', I.drop)}</div>`;
  countUp($('#big'), 'big', big);
  $('#hero').onclick = () => { S.ui.eaten = !S.ui.eaten; save(); renderSummary(); };

  const steps = S.steps[sel] || 0, water = S.water[sel] || 0, stepK = Math.round(steps * 0.04);
  $('#page-2').innerHTML = `
    <div class="p2">
      <div class="card mini">
        <div class="row"><div><div class="v num">${fmt(steps)}</div><div class="l">of ${fmt(g.steps)} steps</div></div></div>
        ${ring('steps', 76, 7, steps / g.steps, '#0B0B0C', I.walk)}
      </div>
      <div class="card mini">
        <div class="row"><div><div class="v num">${fmt(t.burned + stepK)}<small> kcal</small></div><div class="l">Calories burned</div></div><span class="badge">${I.flame}</span></div>
        <div class="sub-lines"><div><span>Steps</span><span>+${stepK}</span></div><div><span>Workouts</span><span>+${t.burned}</span></div></div>
      </div>
    </div>
    <div class="card water">
      <span class="badge" style="color:var(--f)">${I.drop}</span>
      <div class="info"><div class="v num">${water * 250} ml</div><div class="l">Water · ${water}/${g.water} glasses</div>
        <div class="glasses">${Array.from({ length: g.water }, (_, i) => `<i class="${i < water ? 'full' : ''}"></i>`).join('')}</div></div>
      <button class="round" id="w-minus">${I.minus}</button><button class="round dark" id="w-plus">${I.plus}</button>
    </div>`;
  $('#w-plus').onclick = () => { S.water[sel] = Math.min(g.water + 4, water + 1); save(); renderSummary(); };
  $('#w-minus').onclick = () => { S.water[sel] = Math.max(0, water - 1); save(); renderSummary(); };
  kick($('#carousel'));
}

const STATUS = [[0, 'Uploading photo…'], [18, 'Separating ingredients…'], [48, 'Breaking down macros…'], [78, 'Final checks…']];
const statusText = p => STATUS.filter(s => p >= s[0]).pop()[1];

function logCard(e) {
  if (e.type === 'exercise') return `<div class="log ex" data-id="${e.id}">
    <div class="ex-ic">${I[e.icon] || I.dumbbell}</div>
    <div class="log-body"><div class="log-top"><span class="log-name">${e.name}</span><span class="pill">${tm(e.time)}</span></div>
    <div class="log-kcal">${I.flame}<b class="num">${e.kcal}</b> calories</div>
    <div class="log-sub">Intensity: ${e.intensity} · ${e.minutes} min</div></div></div>`;
  const f = food(e.food);
  if (e.status === 'pending') return `<div class="log pending" data-id="${e.id}">
    <div class="log-img">${img(f.id)}<div class="scrim"></div>${ring('pend' + e.id, 54, 5, e.progress / 100, '#fff', `<span class="pp">${Math.round(e.progress)}%</span>`, 'rgba(255,255,255,.25)')}</div>
    <div class="log-body"><div class="log-name status">${statusText(e.progress)}</div><div class="sk w80"></div>
    <div class="sk-row"><span class="sk w20"></span><span class="sk w20"></span><span class="sk w20"></span></div>
    <div class="notify">We'll let you know when it's done</div></div></div>`;
  const m = e.servings;
  return `<div class="log" data-id="${e.id}">
    <div class="log-img">${img(f.id)}</div>
    <div class="log-body"><div class="log-top"><span class="log-name">${f.name}${m !== 1 ? ` ×${m}` : ''}</span><span class="pill">${tm(e.time)}</span></div>
    <div class="log-kcal">${I.flame}<b class="num">${fmt(f.kcal * m)}</b> calories</div>
    <div class="mrow"><span><span class="cp">${I.drum}</span>${Math.round(f.p * m)}g</span><span><span class="cc">${I.wheat}</span>${Math.round(f.c * m)}g</span><span><span class="cf">${I.drop}</span>${Math.round(f.f * m)}g</span></div></div></div>`;
}
function renderLog() {
  const list = [...(S.logs[sel] || [])].sort((a, b) => new Date(b.time) - new Date(a.time));
  $('#log-count').textContent = list.length ? `${list.length} item${list.length > 1 ? 's' : ''}` : '';
  $('#log').innerHTML = list.length ? list.map(logCard).join('') :
    `<div class="empty"><b>Nothing logged ${sel === TODAY ? 'yet' : 'this day'}</b>Tap + to snap your first meal</div>`;
  $$('.log', $('#log')).forEach((el, i) => {
    el.style.animationDelay = `${i * 40}ms`;
    if (!el.classList.contains('pending')) el.onclick = () => openDetail(el.dataset.id);
  });
  kick($('#log'));
}
function renderHome() { renderWeek(); renderSummary(); renderLog(); renderStreak(); }
function renderStreak() { $('#streak-btn').innerHTML = `${I.flame}<span class="num">${streak()}</span>`; }

/* carousel dots */
$('#carousel').addEventListener('scroll', e => {
  const i = Math.round(e.target.scrollLeft / e.target.clientWidth);
  $$('#dots i').forEach((d, j) => d.classList.toggle('on', i === j));
}, { passive: true });

/* ---------------- Tabs ---------------- */
const TABS = { home: ['Home', I.home], progress: ['Progress', I.chart], settings: ['Settings', I.sliders] };
$$('.tab').forEach(t => { const [l, ic] = TABS[t.dataset.tab]; t.innerHTML = `${ic}<span>${l}</span>`; t.onclick = () => go(t.dataset.tab); });
function go(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['home', 'progress', 'settings'].forEach(s => $('#screen-' + s).classList.toggle('hidden', s !== tab));
  if (tab === 'home') renderHome();
  if (tab === 'progress') renderProgress();
  if (tab === 'settings') renderSettings();
}

/* ---------------- FAB / quick actions ---------------- */
const fab = $('#fab'), quick = $('#quick'), backdrop = $('#backdrop');
fab.innerHTML = I.plus;
quick.innerHTML = `
  <button class="qa primary" data-a="scan">${I.scan}<div><b>Scan food</b><small>Snap a photo, AI does the rest</small></div></button>
  <button class="qa" data-a="exercise">${I.dumbbell}<div><b>Log exercise</b><small>Run, lift, walk</small></div></button>
  <button class="qa" data-a="saved">${I.bookmark}<div><b>Saved foods</b><small>Your go-to meals</small></div></button>
  <button class="qa" data-a="db">${I.search}<div><b>Food database</b><small>Search & add</small></div></button>`;
let quickOpen = false;
function setQuick(open) {
  quickOpen = open; fab.classList.toggle('open', open); quick.classList.toggle('open', open);
  backdrop.classList.remove('dark'); backdrop.classList.toggle('open', open);
}
fab.onclick = () => setQuick(!quickOpen);
backdrop.onclick = () => { setQuick(false); closeSheet(); };
$$('.qa', quick).forEach(b => b.onclick = () => {
  setQuick(false);
  const a = b.dataset.a;
  if (a === 'scan') openCamera();
  if (a === 'exercise') openExercise();
  if (a === 'saved') openLibrary(true);
  if (a === 'db') openLibrary(false);
});

/* ---------------- Sheet ---------------- */
const sheet = $('#sheet');
function openSheet(html, after) {
  $('#sheet-body').innerHTML = html; after && after();
  backdrop.classList.add('dark', 'open'); sheet.classList.add('open'); fab.style.opacity = 0; fab.style.pointerEvents = 'none';
}
function closeSheet() {
  sheet.classList.remove('open'); if (!quickOpen) backdrop.classList.remove('open');
  fab.style.opacity = ''; fab.style.pointerEvents = '';
}
function openLibrary(saved) {
  const list = saved ? FOODS.filter(f => f.health >= 8) : FOODS;
  const row = f => `<div class="lib-item" data-f="${f.name.toLowerCase()}"><div class="th">${img(f.id)}</div>
    <div class="meta"><b>${f.name}</b><span>${f.kcal} kcal · P ${f.p}g · C ${f.c}g · F ${f.f}g</span></div>
    <button class="round dark" data-add="${f.id}">${I.plus}</button></div>`;
  openSheet(`<h2>${saved ? 'Saved foods' : 'Food database'}</h2><p class="sub">${saved ? 'Meals you log the most' : 'Search thousands of verified foods'}</p>
    <label class="search">${I.search}<input id="q" placeholder="Search foods" autocomplete="off"></label>
    <div id="lib">${list.map(row).join('')}</div>`, () => {
    $('#q').oninput = e => { const q = e.target.value.toLowerCase(); $$('.lib-item').forEach(r => r.style.display = r.dataset.f.includes(q) ? '' : 'none'); };
    $$('[data-add]').forEach(b => b.onclick = () => {
      addEntry(mkFood(b.dataset.add, new Date())); closeSheet(); toast(`${food(b.dataset.add).name} added`);
    });
  });
}
function openExercise() {
  openSheet(`<h2>Log exercise</h2><p class="sub">Calories burned are added back to your budget</p>
    ${EXERCISES.map((x, i) => `<button class="ex-opt" data-i="${i}"><span class="badge">${I[x.icon]}</span><div><b>${x.name}</b><span>${x.desc}</span></div><span class="k num">+${x.kcal}</span></button>`).join('')}`,
    () => $$('.ex-opt').forEach(b => b.onclick = () => { const x = EXERCISES[b.dataset.i]; addEntry(mkEx(x, new Date())); closeSheet(); toast(`${x.name} · +${x.kcal} kcal`); }));
}
function addEntry(e) {
  sel = TODAY; (S.logs[TODAY] ||= []).push(e); save();
  go('home'); $('#screen-home').scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- Camera + AI scan ---------------- */
const cam = $('#camera'); let camIdx = 0;
function openCamera() {
  camIdx = Math.floor(Math.random() * FOODS.length);
  cam.innerHTML = `
    <div class="cam-view">${img(FOODS[camIdx].id)}</div>
    <div class="cam-top"><button class="glass" id="cam-x">${I.x}</button><span class="t">Scanner</span><button class="glass" id="cam-next" title="Try another dish">${I.swap}</button></div>
    <div class="frame"><i></i><i></i><i></i><i></i><div class="scanline"></div></div>
    <div class="cam-hint">Center your meal in the frame</div>
    <div class="modes"><button class="mode on">${I.scan}Scan food</button><button class="mode">${I.barcode}Barcode</button><button class="mode">${I.label}Food label</button><button class="mode">${I.image}Library</button></div>
    <div class="shutter-row"><button class="glass" id="cam-flash">${I.zap}</button><button class="shutter" id="shutter" aria-label="Capture"></button><button class="glass" id="cam-swap">${I.image}</button></div>`;
  cam.classList.add('open'); $('#device').classList.add('camera-open');
  $('#cam-x').onclick = closeCamera;
  const next = () => { camIdx = (camIdx + 1) % FOODS.length; const im = $('.cam-view img', cam); im.style.opacity = 0; setTimeout(() => { im.src = imgSrc(FOODS[camIdx].id); im.style.opacity = 1; }, 200); };
  $('#cam-next').onclick = next; $('#cam-swap').onclick = next;
  $('#cam-flash').onclick = e => e.currentTarget.style.background = e.currentTarget.style.background ? '' : 'rgba(255,214,10,.9)';
  $$('.mode', cam).forEach(m => m.onclick = () => { $$('.mode', cam).forEach(x => x.classList.toggle('on', x === m)); });
  $('#shutter').onclick = capture;
}
function closeCamera() { cam.classList.remove('open'); $('#device').classList.remove('camera-open'); }
function capture() {
  const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  const e = { ...mkFood(FOODS[camIdx].id, new Date()), status: 'pending', progress: 0 };
  setTimeout(() => { closeCamera(); addEntry(e); runAnalysis(e); }, 220);
}
function runAnalysis(e) {
  const t0 = performance.now(), dur = 4200;
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    e.progress = 100 * (1 - Math.pow(1 - k, 2.2));
    const card = $(`.log[data-id="${e.id}"]`);
    if (card) {
      const c = $('.rv', card); c.style.transition = 'none'; c.style.strokeDashoffset = c.dataset.c * (1 - e.progress / 100);
      $('.pp', card).textContent = Math.round(e.progress) + '%';
      $('.status', card).textContent = statusText(e.progress);
    }
    if (k < 1) return requestAnimationFrame(tick);
    e.status = 'done'; delete e.progress; save();
    renderLog(); renderSummary(); renderWeek();
    const nc = $(`.log[data-id="${e.id}"]`); nc && nc.classList.add('pop');
    toast('Meal analyzed');
    setTimeout(() => openDetail(e.id), 700);
  };
  requestAnimationFrame(tick);
}

/* ---------------- Detail ---------------- */
const detail = $('#detail');
function findEntry(id) { for (const k in S.logs) { const e = S.logs[k].find(x => x.id === id); if (e) return [k, e]; } return []; }
function openDetail(id) {
  const [k, e] = findEntry(id); if (!e || e.type !== 'food') return;
  const f = food(e.food);
  const render = () => {
    const m = e.servings;
    detail.innerHTML = `
      <div class="d-hero">${img(f.id)}
        <div class="d-bar"><button class="glass" id="d-x">${I.back}</button><span class="d-title">Nutrition</span><button class="glass" id="d-del">${I.trash}</button></div></div>
      <div class="d-body">
        <div class="d-meta"><span class="pill">${I.bookmark.replace('class="ic"', 'class="ic" style="width:12px;height:12px;display:inline-block;vertical-align:-1px"')} ${tm(e.time)}</span>
          <span class="ai-note">${I.sparkle}AI estimate · 94% confidence</span></div>
        <div class="d-name"><h2>${f.name}</h2>
          <div class="stepper"><button id="s-m">${I.minus}</button><span class="num" id="s-v">${m}</span><button id="s-p">${I.plus}</button></div></div>
        <div class="card kcal-card"><span class="badge">${I.flame}</span><div><div class="l">Calories</div><div class="v num">${fmt(f.kcal * m)}</div></div></div>
        <div class="d-macros">
          <div class="card d-macro"><span class="cp">${I.drum}</span><div><div class="l">Protein</div><div class="v num">${Math.round(f.p * m)}g</div></div></div>
          <div class="card d-macro"><span class="cc">${I.wheat}</span><div><div class="l">Carbs</div><div class="v num">${Math.round(f.c * m)}g</div></div></div>
          <div class="card d-macro"><span class="cf">${I.drop}</span><div><div class="l">Fats</div><div class="v num">${Math.round(f.f * m)}g</div></div></div>
        </div>
        <div class="card health"><span class="badge">${I.heart}</span><div class="info"><div class="top-row"><span>Health score</span><span>${f.health}/10</span></div>
          <div class="bar"><i style="width:${f.health * 10}%;background:${f.health >= 7 ? 'var(--ok)' : f.health >= 5 ? 'var(--c)' : 'var(--p)'}"></i></div></div></div>
        <div class="ing-head"><h4>Ingredients</h4><span class="muted" style="font-size:13px">${f.ing.length} detected</span></div>
        <div class="ings">${f.ing.map(([n, c]) => `<span class="ing">${n}<span>${Math.round(c * m)} kcal</span></span>`).join('')}<span class="ing add">+ Add</span></div>
      </div>
      <div class="d-actions"><button class="btn line" id="d-fix">${I.sparkle}Fix results</button><button class="btn dark" id="d-done">Done</button></div>`;
    $('#d-x').onclick = $('#d-done').onclick = closeDetail;
    $('#s-m').onclick = () => { e.servings = Math.max(.5, m - .5); save(); render(); };
    $('#s-p').onclick = () => { e.servings = Math.min(5, m + .5); save(); render(); };
    $('#d-fix').onclick = () => toast('Tip: describe the fix, e.g. “no fries”');
    $('#d-del').onclick = () => { S.logs[k] = S.logs[k].filter(x => x.id !== e.id); save(); closeDetail(); toast('Entry removed'); };
  };
  render(); detail.scrollTop = 0;
  requestAnimationFrame(() => detail.classList.add('open'));
}
function closeDetail() { detail.classList.remove('open'); renderHome(); }

/* ---------------- Toast ---------------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.innerHTML = `${I.check}${msg}`; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- Progress ---------------- */
let range = 90;
function weightSeries() {
  const rnd = mulberry(7), n = 180, out = []; let w = S.profile.start;
  for (let i = 0; i < n; i++) { w += -0.036 + (rnd() - .5) * .38; out.push(w); }
  const diff = S.profile.weight - out[n - 1];
  return out.map((v, i) => v + diff * (i / (n - 1)));
}
function smooth(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
function weightChart() {
  const all = weightSeries(), data = all.slice(-range), step = Math.max(1, Math.floor(data.length / 28));
  const pts = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  const W = 318, H = 170, L = 30, T = 12, B = 22;
  const goal = S.profile.goalWeight;
  const mn = Math.floor(Math.min(...pts, goal) - 1), mx = Math.ceil(Math.max(...pts) + 1);
  const x = i => L + (i / (pts.length - 1)) * (W - L - 6), y = v => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  const P = pts.map((v, i) => [x(i), y(v)]), d = smooth(P);
  const grid = [0, 1, 2, 3].map(i => { const v = mn + (mx - mn) * i / 3; return `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#F0F0F2"/><text x="0" y="${y(v) + 3.5}">${v.toFixed(0)}</text>`; }).join('');
  const last = P[P.length - 1];
  const labels = range === 30 ? ['4w', '3w', '2w', '1w', 'Now'] : range === 90 ? ['3mo', '2mo', '1mo', 'Now'] : ['6mo', '4mo', '2mo', 'Now'];
  const xl = labels.map((l, i) => `<text x="${L + (i / (labels.length - 1)) * (W - L - 20)}" y="${H - 4}">${l}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B0B0C" stop-opacity=".14"/><stop offset="1" stop-color="#0B0B0C" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xl}
    <line x1="${L}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--ok)" stroke-dasharray="4 4" stroke-width="1.5"/>
    <text x="${W - 46}" y="${y(goal) - 6}" style="fill:var(--ok);font-weight:600">Goal ${goal}</text>
    <path class="fadein" d="${d} L${last[0]},${H - B} L${L},${H - B} Z" fill="url(#wg)"/>
    <path class="draw" pathLength="1" d="${d}" fill="none" stroke="#0B0B0C" stroke-width="2.5" stroke-linecap="round"/>
    <circle class="fadein" cx="${last[0]}" cy="${last[1]}" r="5" fill="#fff" stroke="#0B0B0C" stroke-width="2.5"/>
  </svg>`;
}
function weekBars() {
  const now = new Date(), dow = (now.getDay() + 6) % 7, W = 318, H = 160, B = 22, T = 10, bw = 26;
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(now.getDate() - dow + i); return d; });
  const max = Math.max(S.goals.kcal * 1.3, ...days.map(d => totals(dkey(d)).kcal));
  const y = v => T + (1 - v / max) * (H - T - B), gap = (W - 7 * bw) / 7;
  let bars = '';
  days.forEach((d, i) => {
    const t = totals(dkey(d)), x = gap / 2 + i * (bw + gap);
    let base = H - B;
    [['p', t.p * 4, 'var(--p)'], ['c', t.c * 4, 'var(--c)'], ['f', t.f * 9, 'var(--f)']].forEach(([_, v, col], j) => {
      const h = (v / max) * (H - T - B); if (h <= 0) return;
      bars += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="${j === 2 ? 7 : 2}" fill="${col}" style="animation-delay:${i * 50}ms"/>`;
      base -= h;
    });
    if (!t.kcal) bars += `<rect x="${x}" y="${H - B - 6}" width="${bw}" height="6" rx="3" fill="#EEEEF1"/>`;
    bars += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle" ${dkey(d) === TODAY ? 'style="fill:#0B0B0C;font-weight:700"' : ''}>${'MTWTFSS'[i]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="bars">${bars}
    <line x1="0" x2="${W}" y1="${y(S.goals.kcal)}" y2="${y(S.goals.kcal)}" stroke="#0B0B0C" stroke-dasharray="3 4" stroke-opacity=".5"/>
    <text x="${W}" y="${y(S.goals.kcal) - 5}" text-anchor="end">Goal ${fmt(S.goals.kcal)}</text></svg>`;
}
function renderProgress() {
  const p = S.profile, bmi = p.weight / Math.pow(p.height / 100, 2), st = streak();
  const lost = (p.start - p.weight).toFixed(1), pct = Math.round(((p.start - p.weight) / (p.start - p.goalWeight)) * 100);
  const now = new Date(), dow = (now.getDay() + 6) % 7;
  const sd = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(now.getDate() - dow + i); return `<span class="${(S.logs[dkey(d)] || []).some(e => e.type === 'food') ? 'on' : ''}">${'MTWTFSS'[i]}</span>`; }).join('');
  const bmiPos = Math.max(0, Math.min(100, (bmi - 15) / 25 * 100));
  const tag = bmi < 18.5 ? ['Underweight', '#E8F0FE', '#2F6FE0'] : bmi < 25 ? ['Healthy', '#E6F8EE', '#1E9E5A'] : bmi < 30 ? ['Overweight', '#FFF5DC', '#B7821A'] : ['Obese', '#FFE9E7', '#D6453A'];
  $('#screen-progress').innerHTML = `
    <h1 class="page-title">Progress</h1>
    <div class="grid2">
      <div class="card wcard"><span class="l">Current weight</span><div class="v num">${p.weight.toFixed(1)}<small>kg</small></div>
        <div class="goal">Goal <b>${p.goalWeight} kg</b></div>
        ${`<div class="bar"><i style="width:${pct}%;background:var(--ink)"></i></div>`}
        <button class="btn-sm" id="log-w">${I.scale}Log weight</button></div>
      <div class="card streak-card"><span class="flame">${I.flame}</span><div class="v num">${st}</div><div class="l">Day streak</div><div class="sdots">${sd}</div></div>
    </div>
    <div class="card chart-card chart">
      <div class="chart-head"><h4>Goal progress</h4><span class="delta">${I.down.replace('class="ic"', 'class="ic" style="width:13px;height:13px"')}${lost} kg · ${pct}% to goal</span></div>
      <div class="seg" id="seg">${[[30, '1M'], [90, '3M'], [180, '6M']].map(([v, l]) => `<button data-r="${v}" class="${v === range ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="wchart">${weightChart()}</div>
    </div>
    <div class="card chart-card chart">
      <div class="chart-head"><h4>This week's energy</h4><span class="muted" style="font-size:13px">${fmt(Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(now.getDate() - dow + i); return totals(dkey(d)).kcal; }).reduce((a, b) => a + b, 0))} kcal</span></div>
      ${weekBars()}
      <div class="legend"><span><i style="background:var(--p)"></i>Protein</span><span><i style="background:var(--c)"></i>Carbs</span><span><i style="background:var(--f)"></i>Fats</span></div>
    </div>
    <div class="card chart-card bmi">
      <div class="chart-head"><h4>Your BMI</h4><span class="muted" style="font-size:13px">${p.height} cm</span></div>
      <div style="margin-top:10px"><span class="v num">${bmi.toFixed(1)}</span><span class="bmi-tag" style="background:${tag[1]};color:${tag[2]}">${tag[0]}</span></div>
      <div class="bmi-bar"><i style="left:${bmiPos}%"></i></div>
      <div class="legend"><span><i style="background:var(--f)"></i>Under</span><span><i style="background:var(--ok)"></i>Healthy</span><span><i style="background:#F0C23B"></i>Over</span><span><i style="background:var(--p)"></i>Obese</span></div>
    </div>`;
  $$('#seg button').forEach(b => b.onclick = () => { range = +b.dataset.r; $$('#seg button').forEach(x => x.classList.toggle('on', x === b)); $('#wchart').innerHTML = weightChart(); });
  $('#log-w').onclick = () => {
    openSheet(`<h2>Log weight</h2><p class="sub">Small steps, big change</p>
      <div style="display:flex;align-items:center;justify-content:center;gap:22px;margin:18px 0 26px">
        <button class="round" id="wm">${I.minus}</button><div style="font-size:56px;font-weight:700;letter-spacing:-.05em" class="num"><span id="wv">${p.weight.toFixed(1)}</span><small style="font-size:20px;color:var(--muted)"> kg</small></div><button class="round" id="wp">${I.plus}</button></div>
      <button class="btn dark" style="width:100%" id="wsave">Save</button>`, () => {
      let v = p.weight; const upd = () => $('#wv').textContent = v.toFixed(1);
      $('#wm').onclick = () => { v = Math.round((v - .1) * 10) / 10; upd(); };
      $('#wp').onclick = () => { v = Math.round((v + .1) * 10) / 10; upd(); };
      $('#wsave').onclick = () => { p.weight = v; save(); closeSheet(); renderProgress(); toast(`Weight logged · ${v.toFixed(1)} kg`); };
    });
  };
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const g = S.goals, p = S.profile;
  const goalRow = (k, label, unit, step, color) => `<div class="srow"><span class="lbl">${color ? `<i class="dot" style="background:${color}"></i>` : ''}${label}</span>
    <span class="val num">${fmt(g[k])}${unit}</span><span class="mini-step"><button data-g="${k}" data-s="${-step}">${I.minus}</button><button data-g="${k}" data-s="${step}">${I.plus}</button></span></div>`;
  const tog = (k, label) => `<div class="srow"><span class="lbl">${label}</span><button class="switch ${S.prefs[k] ? 'on' : ''}" data-t="${k}"></button></div>`;
  $('#screen-settings').innerHTML = `
    <h1 class="page-title">Settings</h1>
    <div class="card profile"><div class="avatar">${p.name.split(' ').map(s => s[0]).join('')}</div>
      <div style="flex:1"><div class="n">${p.name}</div><div class="s">${p.height} cm · ${p.weight.toFixed(1)} kg · goal ${p.goalWeight} kg</div></div></div>
    <div class="group-label">Daily goals</div>
    <div class="card group">${goalRow('kcal', 'Calories', '', 50, '#0B0B0C')}${goalRow('p', 'Protein', 'g', 5, 'var(--p)')}${goalRow('c', 'Carbs', 'g', 5, 'var(--c)')}${goalRow('f', 'Fats', 'g', 5, 'var(--f)')}${goalRow('steps', 'Steps', '', 500)}${goalRow('water', 'Water', ' gl', 1)}</div>
    <div class="group-label">Preferences</div>
    <div class="card group">${tog('addBurned', 'Add burned calories to budget')}${tog('rollover', 'Roll over unused calories')}${tog('reminders', 'Meal reminders')}</div>
    <div class="card group"><button class="danger" id="reset">Reset demo data</button></div>
    <p class="foot">Plate · demo build · AI estimates are simulated</p>`;
  $$('[data-g]').forEach(b => b.onclick = () => { const k = b.dataset.g; g[k] = Math.max(0, g[k] + +b.dataset.s); save(); renderSettings(); });
  $$('[data-t]').forEach(b => b.onclick = () => { const k = b.dataset.t; S.prefs[k] = !S.prefs[k]; save(); b.classList.toggle('on'); });
  $('#reset').onclick = () => { localStorage.removeItem(KEY); S = load(); save(); sel = TODAY; toast('Demo data reset'); renderSettings(); };
}

/* ---------------- Clock ---------------- */
const clock = () => { const d = new Date(); $('#clock').textContent = `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`; };
clock(); setInterval(clock, 30000);

save();
renderHome();
})();
