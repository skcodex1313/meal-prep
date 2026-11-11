import { state, save, getRecipe, allRecipes, upsertRecipe, deleteRecipe, profileById, uid, slot, exportData, replaceState, resetRecipeIndex, defaultDayMeals } from './store.js';
import { FOODS, FOOD_LIST } from './foods.js';
import { TASKS } from './recipes.js';
import { MEALS, MEAL_LABEL, ACTIVITY, GOALS, DEFAULT_SPLIT, targets, perServing, autoPortion, mealTarget, normIng, ingFood, fmtQty, r0, invalidateNutrition, bmi, dietOf, DIET_ICON, niceNum } from './nutrition.js';
import {
  today, addDays, weekStart, weekDates, fmtDate, isWorkday, dow, DAY, slotRecipes, portionOf, slotNutrition, dayIntake,
  groceryList, prepPlan, dayCooking, nightBefore, scaledIngredients, autoFill, mealSetting, enabledMeals, ingredientPrep, prepName, nextPlannedDate,
} from './planner.js';
import { recipeText, dayCookText, groceryText, prepText, weekPlanText, waLink } from './share.js';
import { lineChart, barChart, bindCharts } from './chart.js';

// ════════════════════════ helpers ════════════════════════
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet-root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = (o) => esc(JSON.stringify(o));
const fmt = (n) => Math.round(n || 0).toLocaleString('en-IN');
const pColor = (p) => `var(--p${(state.profiles.indexOf(p) % 3) + 1})`;
const pDot = (p) => `<span class="dot" style="background:${pColor(p)}"></span>`;
const CAT_EMOJI = { breakfast: '🍳', main: '🍛', side: '🫓', soup: '🥣', salad: '🥗', snack: '🥜' };
const emoji = (r) => (r.cuisine === 'Asian' && r.cat === 'main' ? '🥢' : CAT_EMOJI[r.cat] || '🍽️');
const active = (r) => (r.prep || 0) + (r.cook || 0);
const METHOD = { airfryer: 'Air fryer', microwave: 'Microwave' };
const isNoPrep = (r) => r.noPrep || (!r.wk?.length && !r.wkCustom?.length && !r.nt?.length && !r.pre?.length && !(r.ing || []).some((x) => FOODS[normIng(x).f]?.chop));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const mult = (m) => `×${+(+m).toFixed(2)}`;

const SHARE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
/** One or two letters per person, unique within the household. */
function initials(p) {
  const first = (x) => (x.name || '?').trim()[0].toUpperCase();
  const clash = state.profiles.some((x) => x !== p && first(x) === first(p));
  return clash ? (p.name || '??').trim().slice(0, 2) : first(p);
}

/** Toast at the bottom, above the tab bar. With `undo`, shows an Undo button for 5 s. */
function toast(msg, { undo, ms = 2400 } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="toast-undo">Undo</button>' : ''}`;
  if (undo) t.querySelector('button').addEventListener('click', () => { undo(); t.remove(); });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), undo ? 5000 : ms);
}
/** Run a destructive change with an Undo toast instead of a confirm() dialog. */
function withUndo(msg, fn) {
  const snap = JSON.parse(JSON.stringify(state));
  fn();
  save(); render(); if (ui.sheet) renderSheet();
  toast(msg, { undo: () => { replaceState(snap); resetRecipeIndex(); render(); if (ui.sheet) renderSheet(); } });
}

const ui = {
  rf: { meal: 'all', cuisine: 'all', tag: 'all', diet: 'all', q: '' },
  prepTab: 'grocery',
  meProfile: null,
  planWeek: weekStart(),
  prepWeek: [5, 6, 0].includes(new Date().getDay()) ? addDays(weekStart(), 7) : weekStart(),
  recipePortions: {},
  draft: null,
  ai: { meal: 'l', diet: 'nonveg', cuisine: 'Any', have: '', notes: '', loading: false, results: [], error: '', importText: '' },
  sheet: null,
  todayOpen: {},
  step: {},
  planView: 'day',
  planDay: null,
};

// ════════════════════════ router ════════════════════════
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}

let lastRoute = '';
function render() {
  const { parts, q } = parseHash();
  const route = parts.join('/');
  const keepScroll = route === lastRoute;
  const y = lockedY ?? window.scrollY;
  lastRoute = route;

  if (!state.profiles.length && parts[0] !== 'profile') { location.hash = '#/profile/new'; return; }

  const [p0, p1] = parts;
  let html, tab = p0 || 'today';
  try {
    switch (p0) {
      case undefined: html = viewToday(); tab = 'today'; break;
      case 'plan': html = viewPlan(); break;
      case 'prep': html = viewPrep(); break;
      case 'cook': html = parts[2] === 'steps' ? viewSteps(p1) : viewCook(p1 || today()); tab = 'plan'; break;
      case 'settings': html = viewSettings(); tab = 'me'; break;
      case 'setup': html = viewSetup(); tab = 'today'; break;
      case 'recipes': html = viewRecipes(); break;
      case 'recipe': html = viewRecipe(p1); tab = 'recipes'; break;
      case 'edit': html = viewEditor(p1, q); tab = 'recipes'; break;
      case 'ai': html = viewAI(); tab = 'recipes'; break;
      case 'me': html = viewMe(); break;
      case 'profile': html = viewProfile(p1); tab = 'me'; break;
      default: html = viewToday(); tab = 'today';
    }
  } catch (e) {
    console.error(e);
    html = `<div class="card warn"><b>Something went wrong.</b><p class="small">${esc(e.message)}</p><a class="btn" href="#/">Go home</a></div>`;
  }
  $app.innerHTML = html;
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  const focus = p0 === 'cook' && parts[2] === 'steps';
  document.getElementById('tabs').classList.toggle('hidden', !state.profiles.length || focus || p0 === 'setup');
  document.body.classList.toggle('focus-mode', focus);
  document.body.classList.toggle('has-action-bar', !!$app.querySelector('.action-bar'));
  bindCharts($app);
  if (p0 === 'recipes') renderRecipeList();
  if (p0 === 'cook') requestWakeLock(); else releaseWakeLock();
  if (lockedY === null) window.scrollTo(0, keepScroll ? y : 0);
}
window.addEventListener('hashchange', () => { if (ui.sheet) closeSheet(false); render(); });
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

// ════════════════════════ shared bits ════════════════════════
function meter(label, val, target, unit) {
  const pct = target ? Math.min(100, (val / target) * 100) : 0;
  const over = target && val > target * 1.05;
  return `<div class="meter-row"><span>${label}</span><div class="meter ${over ? 'over' : ''}" role="meter" aria-valuenow="${r0(val)}" aria-valuemax="${r0(target)}"><i style="width:${pct}%"></i></div><span class="val">${fmt(val)} / ${fmt(target)} ${unit}</span></div>`;
}
const macroLine = (n) => `${fmt(n.kcal)} kcal · ${r0(n.p)} g protein`;

function weekNav(ws, act, extra = '') {
  const end = addDays(ws, 6);
  const label = `${fmtDate(ws).replace(/^\w+, /, '')} – ${fmtDate(end).replace(/^\w+, /, '')}`;
  const tag = ws === weekStart() ? 'This week' : ws === addDays(weekStart(), 7) ? 'Next week' : ws === addDays(weekStart(), -7) ? 'Last week' : '';
  return `<div class="row between week-nav">
    <button class="icon-btn" data-act="${act}" data-d="-7" aria-label="Previous week">‹</button>
    <div class="grow" style="text-align:center"><b>${label}</b><div class="muted">${tag}</div></div>
    <button class="icon-btn" data-act="${act}" data-d="7" aria-label="Next week">›</button>${extra}</div>`;
}

function shareButtons(kind, arg = '') {
  return `<div class="row wrap" style="margin-top:12px"><button class="btn-wa" data-act="share" data-kind="${kind}" data-arg="${esc(arg)}">WhatsApp</button>
    <button data-act="share-more" data-kind="${kind}" data-arg="${esc(arg)}">Share / copy…</button></div>`;
}

function shareTextFor(kind, arg) {
  switch (kind) {
    case 'recipe': { const r = getRecipe(arg); const pp = recipePortions(r); return recipeText(r, Object.values(pp).reduce((a, b) => a + b, 0), pp); }
    case 'cook': return dayCookText(arg);
    case 'grocery': return groceryText(weekDates(arg), state.checks['grocery:' + arg] || {}, state.extras[arg] || []);
    case 'prep': return prepText(weekDates(arg), state.checks['prep:' + arg] || {});
    case 'week': return weekPlanText(weekDates(arg));
  }
  return '';
}

// ════════════════════════ TODAY ════════════════════════
const MEAL_END = { b: 10.5, l: 14.5, s: 17.5, d: 22.5 }; // hour a meal is usually over

function nextUp(d) {
  const now = new Date(), h = now.getHours() + now.getMinutes() / 60;
  const day = state.plan[d] || {};
  for (const { k } of MEALS) {
    const sl = day[k];
    if (!sl?.dishes?.length || state.profiles.every((p) => sl.eaten?.[p.id])) continue;
    if (h < MEAL_END[k]) return { date: d, k, sl };
  }
  const t = addDays(d, 1), td = state.plan[t] || {};
  for (const { k } of MEALS) if (td[k]?.dishes?.length) return { date: t, k, sl: td[k], tomorrow: true };
  return null;
}

function nextUpCard(d) {
  const n = nextUp(d);
  if (!n) return '';
  const rs = slotRecipes(n.sl);
  const meal = MEALS.find((m) => m.k === n.k);
  const { insts, pre } = dayCooking(n.date);
  const mine = insts.filter((i) => i.meal === n.k);
  const mins = mine.reduce((s, i) => s + active(i.recipe), 0);
  const myPre = pre.filter((p) => p.meal === n.k);
  const extra = mine.some((i) => i.leftovers.length);
  let line;
  if (n.sl.from) line = 'Leftovers – just pack it';
  else line = [`~${mins} min hands-on`, myPre.length ? `first: ${esc(myPre[0].t.toLowerCase())} (${myPre[0].m} min before)` : '', extra ? 'cook extra for tomorrow’s lunchbox' : ''].filter(Boolean).join(' · ');
  return `<div class="card next-up"><div class="eyebrow">${n.tomorrow ? 'Tomorrow' : 'Next up'} · ${meal.icon} ${meal.label}</div>
    <div class="nu-dishes">${rs.map((r) => `<a href="#/recipe/${r.id}">${esc(r.name)}</a>`).join(' + ')}</div>
    <div class="muted">${line}</div>
    <div class="row between" style="margin-top:10px">${n.sl.from ? '<span></span>' : `<a class="btn btn-primary btn-sm" href="#/cook/${n.date}">Cook ›</a>`}
      ${n.tomorrow ? '' : `<span class="who-group">${whoToggles(n.date, n.k, n.sl)}</span>`}</div></div>`;
}

function whoToggles(date, k, sl) {
  return state.profiles.map((p) => {
    const on = !!sl.eaten?.[p.id];
    return `<button class="who ${on ? 'on' : ''}" style="--c:${pColor(p)}" data-act="eat" data-date="${date}" data-meal="${k}" data-pid="${p.id}" aria-pressed="${on}" aria-label="${esc(p.name)} ate ${MEAL_LABEL[k].toLowerCase()}">${on ? '✓' : esc(initials(p))}</button>`;
  }).join('');
}

function ring(val, target, label) {
  const r = 17, c = 2 * Math.PI * r, pct = target ? Math.min(1, val / target) : 0, over = target && val > target * 1.05;
  return `<svg class="ring ${over ? 'over' : ''}" viewBox="0 0 44 44" width="44" height="44" role="img" aria-label="${label}: ${fmt(val)} of ${fmt(target)}">
    <circle cx="22" cy="22" r="${r}" class="ring-bg"/><circle cx="22" cy="22" r="${r}" class="ring-fg" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 22 22)"/>
    <text x="22" y="25" text-anchor="middle">${label}</text></svg>`;
}

function personRow(p, d) {
  const t = targets(p), e = dayIntake(d, p.id, { eatenOnly: true }), open = !!ui.todayOpen[p.id];
  const left = t.kcal - e.kcal, pLeft = t.p - e.p;
  let h = `<div class="person"><button class="person-row" data-act="person-toggle" data-pid="${p.id}" aria-expanded="${open}">
    ${ring(e.kcal, t.kcal, 'kcal')}${ring(e.p, t.p, 'prot')}
    <span class="grow"><span class="row" style="gap:6px">${pDot(p)}<b>${esc(p.name)}</b></span><span class="muted block">${left >= 0 ? `${fmt(left)} kcal left` : `${fmt(-left)} kcal over`} · ${pLeft > 0 ? `${r0(pLeft)} g protein to go` : 'protein ✓'}</span></span>
    <span class="chev">${open ? '▴' : '▾'}</span></button>`;
  if (open) {
    const planned = dayIntake(d, p.id, { plannedOnly: true });
    h += `<div class="person-more">${meter('Calories', e.kcal, t.kcal, '')}${meter('Protein', e.p, t.p, 'g')}${meter('Fibre', e.fib, t.fib, 'g')}
      <div class="row between" style="margin-top:6px"><span class="muted">Planned today: ${macroLine(planned)}</span><button class="btn-ghost btn-sm" data-act="eat-all" data-pid="${p.id}">Mark all eaten</button></div></div>`;
  }
  return h + '</div>';
}

function viewToday() {
  const d = today();
  const day = state.plan[d] || {};
  const hasPlan = MEALS.some(({ k }) => day[k]?.dishes?.length);
  const wd = new Date().getDay();
  let html = `<div class="row between page-head"><div><h1>Today</h1><div class="sub">${fmtDate(d, true)}</div></div>${hasPlan ? `<a class="btn btn-sm" href="#/cook/${d}">👩‍🍳 Cook</a>` : ''}</div>`;
  html += nextUpCard(d);
  html += `<div class="card tight people">${state.profiles.map((p) => personRow(p, d)).join('')}</div>`;

  if (wd === 6 || wd === 0) {
    const ws = addDays(weekStart(), 7);
    const pp = prepPlan(weekDates(ws));
    html += `<a class="card accent row between" href="#/prep" data-act="prep-week" data-ws="${ws}" style="text-decoration:none;color:inherit;margin-top:10px">
      <div><b>🧺 Sunday prep for next week</b><div class="small sub">${pp.weekend.length ? `${plural(pp.weekend.length, 'task')} · about ${pp.minutes} min` : 'Plan next week first to get your prep list'}</div></div><span class="chev">›</span></a>`;
  }

  html += `<h2>Meals</h2>`;
  if (!hasPlan) {
    html += `<div class="card empty"><div class="big">🍽️</div><p>Nothing planned for today.</p>${state.settings.setupDone ? '<a class="btn btn-primary" href="#/plan">Plan your week</a>' : '<a class="btn btn-primary" href="#/setup">Set up your week</a>'}</div>`;
  } else {
    html += `<div class="card tight">${MEALS.filter(({ k }) => day[k]?.dishes?.length).map(({ k, label, icon }) => {
      const sl = day[k];
      return `<div class="meal-line"><button class="ml-main" data-act="slot" data-date="${d}" data-meal="${k}"><span class="mr-ico">${icon}</span>
        <span class="mr-body"><b>${label}</b>${sl.from ? ' <span class="tag green">pack leftovers</span>' : ''}<span class="mr-dishes">${slotRecipes(sl).map((r) => esc(r.name)).join(' + ')}</span></span></button>
        <span class="who-group">${whoToggles(d, k, sl)}</span></div>`;
    }).join('')}</div><p class="muted legend">Tap a name initial when that person has eaten. Tap a meal for portions.</p>`;
  }

  const extras = state.profiles.flatMap((p) => (state.log[d]?.[p.id] || []).map((e, i) => ({ p, e, i })));
  html += `<div class="row between"><h2>Extra food</h2><button class="btn-sm" data-act="log-open">+ Log</button></div>`;
  html += extras.length
    ? `<div class="card tight"><ul class="list">${extras.map(({ p, e, i }) => `<li class="row">${pDot(p)}<div class="grow"><div>${esc(e.name)}</div><div class="muted">${fmt(e.kcal)} kcal · ${r0(e.p)} g P</div></div><button class="icon-btn btn-ghost btn-danger" data-act="log-del" data-pid="${p.id}" data-i="${i}" aria-label="Remove ${esc(e.name)}">✕</button></li>`).join('')}</ul></div>`
    : `<p class="muted">Tea, snacks, eating out – log anything that wasn’t planned.</p>`;

  const tomorrowNb = nightBefore(addDays(d, 1));
  const ntChecks = state.checks['nt:' + d] || {};
  if (tomorrowNb.length) {
    html += `<h2>Tonight, for tomorrow</h2><div class="card tight"><ul class="list">${tomorrowNb.map((t, i) => {
      const key = i + ':' + t.t;
      return `<li><label class="check-item ${ntChecks[key] ? 'done' : ''}" style="margin:0;color:inherit;font-size:15px"><input type="checkbox" data-change="nt-check" data-date="${d}" data-key="${esc(key)}" ${ntChecks[key] ? 'checked' : ''}><span class="ci-text">${esc(t.t)}<span class="muted block">${esc(t.dish)} · ${MEAL_LABEL[t.meal]}</span></span></label></li>`;
    }).join('')}</ul></div>`;
  }
  return html;
}

// ════════════════════════ PLAN ════════════════════════
function modeToggle(mode) {
  return `<div class="seg mode-toggle" role="tablist"><button role="tab" class="${mode === 'plan' ? 'on' : ''}" data-act="mode" data-v="plan" aria-selected="${mode === 'plan'}">🗓️ Plan</button><button role="tab" class="${mode === 'cook' ? 'on' : ''}" data-act="mode" data-v="cook" aria-selected="${mode === 'cook'}">👩‍🍳 Cook</button></div>`;
}

const STATUS = { ok: ['✓', 'on target'], over: ['▲', 'over target'], under: ['▼', 'under target'] };
function dayStatus(date, p) {
  const t = targets(p), n = dayIntake(date, p.id, { plannedOnly: true });
  if (!n.kcal) return null;
  const r = n.kcal / t.kcal;
  return r > 1.1 ? 'over' : r < 0.9 ? 'under' : 'ok';
}
function dayStatusAll(date) {
  const s = state.profiles.map((p) => dayStatus(date, p)).filter(Boolean);
  if (!s.length) return null;
  return s.includes('over') ? 'over' : s.includes('under') ? 'under' : 'ok';
}

function planDayOf(ws) {
  const wk = weekDates(ws);
  if (ui.planDay && wk.includes(ui.planDay)) return ui.planDay;
  return wk.includes(today()) ? today() : wk[0];
}

function viewPlan() {
  const ws = ui.planWeek, dates = weekDates(ws);
  const sel = (ui.planDay = planDayOf(ws));
  const week = ui.planView === 'week';
  const empty = dates.some((d) => MEALS.some(({ k }) => mealSetting(d, k) !== 'off' && !slot(d, k)?.dishes?.length));
  let html = `${modeToggle('plan')}<div class="sticky-head">
    ${weekNav(ws, 'plan-week', `<button class="icon-btn" data-act="plan-menu" aria-label="More options">⋯</button>`)}
    <div class="daystrip" role="tablist">${dates.map((d) => {
      const st = dayStatusAll(d);
      return `<button role="tab" class="daychip ${d === sel && !week ? 'on' : ''} ${d === today() ? 'is-today' : ''}" data-act="plan-day" data-d="${d}" aria-selected="${d === sel && !week}">
        <span>${DAY[dow(d)]}</span><b>${+d.slice(8)}</b><i class="st ${st || ''}" aria-label="${st ? STATUS[st][1] : 'not planned'}">${st ? STATUS[st][0] : '·'}</i></button>`;
    }).join('')}<button class="daychip wk ${week ? 'on' : ''}" data-act="plan-view" data-v="${week ? 'day' : 'week'}" aria-pressed="${week}"><span>All</span><b>7</b><i>days</i></button></div></div>`;
  if (empty) html += `<button class="btn-primary btn-block" data-act="autofill" style="margin:4px 0 10px">✨ Auto-fill empty meals</button>`;
  html += week ? dates.map((d) => dayCard(d, true)).join('') : dayCard(sel, false);
  html += `<p class="muted legend">✓ on target · ▲ over · ▼ under (planned calories vs each person’s target)</p>`;
  return html;
}

function dayCard(d, compact) {
  const work = isWorkday(d);
  let h = `<div class="card tight day"><div class="day-head"><div><b class="${d === today() ? 'today' : ''}">${fmtDate(d, true)}</b> <span class="muted">${work ? '· 🍱 workday' : '· weekend'}</span></div>${compact ? `<button class="btn-ghost btn-sm" data-act="plan-day" data-d="${d}">Open</button>` : `<a class="btn-ghost btn-sm" href="#/cook/${d}">Cook ›</a>`}</div>`;
  const skipped = [];
  for (const { k, label, icon } of MEALS) {
    const sl = slot(d, k), rs = slotRecipes(sl), set = mealSetting(d, k);
    if (set === 'off' && !rs.length) { skipped.push({ k, label }); continue; }
    const mismatch = set === 'veg' && rs.some((r) => dietOf(r) !== 'veg');
    const edited = rs.length && sl.portions && Object.keys(sl.portions).length;
    h += `<button class="meal-row" data-act="slot" data-date="${d}" data-meal="${k}"><span class="mr-ico">${icon}</span>
      <span class="mr-body"><span class="mr-top"><b>${label}</b>${set !== 'off' ? `<span class="diet" title="${set === 'veg' ? 'veg meal' : 'non-veg meal'}">${DIET_ICON[set]}</span>` : ''}${sl?.from ? '<span class="tag green">leftovers</span>' : ''}${mismatch ? '<span class="tag warn">non-veg on veg day</span>' : ''}</span>
      <span class="mr-dishes">${rs.length ? rs.map((r) => esc(r.name)).join(' + ') : '<span class="muted">Tap to add a dish</span>'}</span>
      ${!compact && rs.length ? `<span class="mr-sub">${state.profiles.map((p) => `${esc(initials(p))} ${mult(portionOf(sl, k, p.id, d))}`).join(' · ')}${edited ? ' · adjusted' : ''}</span>` : ''}</span><span class="chev">›</span></button>`;
  }
  if (skipped.length) h += `<div class="skipped-line"><span class="muted">Skipped:</span> ${skipped.map((s) => `<button class="btn-ghost btn-sm" data-act="add-dish" data-date="${d}" data-meal="${s.k}">${s.label} +</button>`).join('')}</div>`;
  if (!compact) {
    const rows = state.profiles.map((p) => ({ p, s: dayStatus(d, p), t: targets(p), n: dayIntake(d, p.id, { plannedOnly: true }) })).filter((x) => x.s);
    if (rows.length) h += `<details class="day-status"><summary>${rows.map(({ p, s }) => `<span class="st-item">${pDot(p)} ${esc(p.name)} <i class="st ${s}">${STATUS[s][0]}</i></span>`).join('')}</summary>
      ${rows.map(({ p, t, n }) => `<div class="row between small">${esc(p.name)}<span class="num sub">${fmt(n.kcal)} / ${fmt(t.kcal)} kcal · ${r0(n.p)} / ${t.p} g protein</span></div>`).join('')}</details>`;
  }
  return h + '</div>';
}

function portionAmount(rs, m) {
  return rs.map((r) => (r.unit ? `${niceNum(r.unit[0] * m)} ${r.unit[1]}` : `${mult(m)} ${r.name.toLowerCase()}`)).join(' + ');
}

function sheetSlot(s) {
  const { date, meal } = s;
  const sl = slot(date, meal), rs = slotRecipes(sl), set = mealSetting(date, meal);
  let h = `<h3>${MEAL_LABEL[meal]} · ${fmtDate(date)} ${set !== 'off' ? `<span class="tag">${DIET_ICON[set]} ${set === 'veg' ? 'veg' : 'non-veg'}</span>` : ''}</h3>`;
  if (sl?.from) h += `<p class="small sub">Leftovers from ${DAY[dow(sl.from)]}’s dinner – it’s cooked in one bigger batch that evening.</p>`;
  h += `<ul class="list">${rs.map((r, i) => `<li class="row"><a class="grow" href="#/recipe/${r.id}">${DIET_ICON[dietOf(r)]} ${esc(r.name)}</a><span class="muted small nowrap">${fmt(perServing(r).kcal)} kcal</span><button class="icon-btn btn-ghost btn-danger" data-act="rm-dish" data-date="${date}" data-meal="${meal}" data-i="${i}" aria-label="Remove ${esc(r.name)}">✕</button></li>`).join('') || '<li class="muted">Nothing planned yet.</li>'}</ul>`;
  const prev = slot(addDays(date, -1), 'd');
  h += `<div class="row wrap" style="margin-top:8px"><button class="btn-primary" data-act="add-dish" data-date="${date}" data-meal="${meal}">+ Add dish</button>${meal === 'l' && !rs.length && prev?.dishes?.length && !prev.from ? `<button data-act="leftover" data-date="${date}">↺ Last night’s leftovers</button>` : ''}</div>`;
  if (rs.length) {
    h += `<h3 style="margin-top:18px">Portions</h3>`;
    for (const p of state.profiles) {
      const m = portionOf(sl, meal, p.id, date), n = slotNutrition(sl, meal, p.id, date), mt = mealTarget(p, meal, enabledMeals(date));
      const isAuto = sl.portions?.[p.id] == null;
      h += `<div class="card tight"><div class="row between"><div class="grow"><div class="row" style="gap:6px">${pDot(p)}<b>${esc(p.name)}</b>${isAuto ? '<span class="tag">auto</span>' : ''}</div><div class="small">${esc(portionAmount(rs, m))}</div></div>
        <div class="stepper"><button data-act="portion-step" data-date="${date}" data-meal="${meal}" data-pid="${p.id}" data-d="-0.25" aria-label="Less for ${esc(p.name)}">−</button><span class="v">${mult(m)}</span><button data-act="portion-step" data-date="${date}" data-meal="${meal}" data-pid="${p.id}" data-d="0.25" aria-label="More for ${esc(p.name)}">+</button></div></div>
        <div class="muted" style="margin-top:4px">${macroLine(n)} · target ≈ ${fmt(mt.kcal)} kcal · ${r0(mt.p)} g P</div></div>`;
    }
    h += `<div class="row" style="margin-top:10px"><button class="grow" data-act="portion-auto" data-date="${date}" data-meal="${meal}">Reset to auto</button><a class="btn grow" href="#/cook/${date}">Cook ›</a></div>`;
  }
  return h;
}

function sheetPlanMenu() {
  return `<h3>Week of ${fmtDate(ui.planWeek)}</h3>
    <div class="menu">
      <button data-act="share" data-kind="week" data-arg="${ui.planWeek}">Send week plan on WhatsApp</button>
      <button data-act="share-more" data-kind="week" data-arg="${ui.planWeek}">Share / copy week plan…</button>
      <a class="btn" href="#/settings">Meals per day & veg days…</a>
      <button class="btn-danger" data-act="clear-week">Clear this week</button>
    </div>`;
}

const CYCLE = { off: 'nonveg', nonveg: 'veg', veg: 'off' };
const CELL = { off: '—', nonveg: '🍗', veg: '🥦' };
function mealGridSummary() {
  const dm = state.settings.dayMeals || defaultDayMeals();
  const days = [1, 2, 3, 4, 5, 6, 0];
  const count = (i) => ['b', 'l', 'd'].filter((k) => dm[i]?.[k] !== 'off').length;
  return [...new Set(days.map((i) => `${count(i)} meals${dm[i]?.s !== 'off' ? ' + snack' : ''}`))].join(' / ');
}
function mealGrid() {
  const dm = state.settings.dayMeals || defaultDayMeals();
  const days = [1, 2, 3, 4, 5, 6, 0];
  return `<p class="muted" style="margin:0 0 8px">Tap a cell: 🍗 non-veg → 🥦 veg → — skip. Veg means no meat, fish or egg. Auto-fill and portions follow this.</p>
    <table class="tbl meal-grid"><tr><th></th>${['Bkfst', 'Lunch', 'Snack', 'Dinner'].map((l) => `<th>${l}</th>`).join('')}</tr>
    ${days.map((i) => `<tr><td>${DAY[i]}</td>${MEALS.map(({ k }) => { const v = dm[i]?.[k] || 'off'; return `<td><button class="cell ${v}" data-act="grid" data-day="${i}" data-meal="${k}" aria-label="${DAY[i]} ${MEAL_LABEL[k]}: ${v === 'off' ? 'skip' : v === 'veg' ? 'veg' : 'non-veg'}">${CELL[v]}</button></td>`; }).join('')}</tr>`).join('')}</table>
    <div class="row wrap" style="margin-top:8px"><button class="btn-sm" data-act="grid-preset" data-v="2s">2 meals + snack</button><button class="btn-sm" data-act="grid-preset" data-v="3s">3 meals + snack</button><button class="btn-sm" data-act="grid-preset" data-v="allnv">All non-veg</button></div>`;
}

function sheetAddDish(date, meal) {
  const s = ui.sheet;
  const work = isWorkday(date) && meal === 'l';
  const q = (s.q || '').toLowerCase();
  let list = allRecipes().filter((r) => (s.all ? true : r.meals?.includes(meal)));
  if (q) list = list.filter((r) => (r.name + ' ' + r.cuisine + ' ' + r.cat).toLowerCase().includes(q));
  if (work && s.lunchbox !== false) list = list.filter((r) => r.lunchbox);
  const set = mealSetting(date, meal);
  s.diet ??= set === 'veg' ? 'veg' : 'any';
  if (s.diet === 'veg') list = list.filter((r) => dietOf(r) === 'veg');
  if (s.diet === 'nonveg') list = list.filter((r) => dietOf(r) !== 'veg');
  const nvFirst = (r) => (set === 'nonveg' && dietOf(r) !== 'veg' ? 1 : 0);
  list.sort((a, b) => (state.favorites.includes(b.id) - state.favorites.includes(a.id)) || (nvFirst(b) - nvFirst(a)) || (perServing(b).p / perServing(b).kcal) - (perServing(a).p / perServing(a).kcal));
  const cur = slot(date, meal)?.dishes || [];
  return `<div class="row between"><h3 style="margin:0">Add to ${MEAL_LABEL[meal]} · ${fmtDate(date)}</h3><button class="btn-ghost" data-act="sheet-back" data-date="${date}" data-meal="${meal}">Done</button></div>
    <input type="search" placeholder="Search recipes…" value="${esc(s.q || '')}" data-input="sheet-q" autocomplete="off" style="margin-top:8px">
    <div class="chips" style="margin-top:8px">
      <button class="chip ${!s.all ? 'on' : ''}" data-act="sheet-set" data-k="all" data-v="">${MEAL_LABEL[meal]}</button><button class="chip ${s.all ? 'on' : ''}" data-act="sheet-set" data-k="all" data-v="1">Any meal</button>
      ${work ? `<button class="chip ${s.lunchbox !== false ? 'on' : ''}" data-act="sheet-set" data-k="lunchbox" data-v="${s.lunchbox === false ? '1' : ''}">🍱 Lunchbox</button>` : ''}
      ${[['any', 'Veg + non-veg'], ['nonveg', '🍗'], ['veg', '🥦']].map(([k, l]) => `<button class="chip ${s.diet === k ? 'on' : ''}" data-act="sheet-set" data-k="diet" data-v="${k}" aria-label="${k === 'any' ? 'veg and non-veg' : k === 'veg' ? 'veg only' : 'non-veg only'}">${l}</button>`).join('')}</div>
    <ul class="list" id="sheet-list">${list.map((r) => {
      const n = perServing(r), added = cur.includes(r.id);
      return `<li class="row"><div class="grow"><div>${DIET_ICON[dietOf(r)]} ${esc(r.name)}</div><div class="macros">${macroLine(n)} · ${active(r)} min${r.method ? ' · ' + METHOD[r.method] : ''}${r.lunchbox ? ' · 🍱' : ''}</div></div>
        <button class="btn-sm ${added ? '' : 'btn-primary'}" data-act="pick-dish" data-date="${date}" data-meal="${meal}" data-id="${r.id}">${added ? 'Added ✓' : 'Add'}</button></li>`;
    }).join('') || '<li class="muted">No matches.</li>'}</ul>`;
}

// ════════════════════════ PREP ════════════════════════
function viewPrep() {
  const ws = ui.prepWeek;
  const dates = weekDates(ws);
  if (ui.prepTab !== 'prep') ui.prepTab = 'grocery';
  let html = `<h1>Prep & shop</h1>${weekNav(ws, 'prep-week-nav')}
    <div class="seg"><button class="${ui.prepTab === 'grocery' ? 'on' : ''}" data-act="prep-tab" data-v="grocery">Grocery</button><button class="${ui.prepTab === 'prep' ? 'on' : ''}" data-act="prep-tab" data-v="prep">Sunday prep</button></div>`;
  const anyPlan = dates.some((d) => MEALS.some(({ k }) => state.plan[d]?.[k]?.dishes?.length));
  if (!anyPlan) return html + `<div class="card empty" style="margin-top:12px"><div class="big">🗓️</div><p>No meals planned for this week yet.</p><button class="btn-primary" data-act="nav" data-h="#/plan" data-plan-ws="${ws}">Plan this week</button></div>`;

  if (ui.prepTab === 'grocery') {
    const checks = state.checks['grocery:' + ws] || {};
    const { groups, pantry } = groceryList(dates);
    const extras = state.extras[ws] || [];
    const all = [...groups.flatMap((g) => g.items), ...extras.map((e) => ({ key: 'x:' + e }))];
    const done = all.filter((i) => checks[i.key]);
    html += `<div class="row between" style="margin-top:12px"><span class="sub">${done.length}/${all.length} in the basket</span><span class="muted">🧺 = goes into Sunday prep</span></div>`;
    const item = (i) => checkRow('grocery', ws, i.key, `<details class="gi"><summary><b>${esc(i.food.name)}</b> <span class="sub">${esc(i.qty)}</span>${i.prep.size ? ' <span aria-label="used in Sunday prep">🧺</span>' : ''}</summary><div class="muted small">For: ${esc([...i.dishes].join(', '))}${i.prep.size ? ` · prep: ${esc([...i.prep].join(', '))}` : ''}</div></details>`);
    for (const g of groups) {
      const open = g.items.filter((i) => !checks[i.key]);
      if (open.length) html += `<h2>${g.label}</h2><div class="card tight"><ul class="list">${open.map(item).join('')}</ul></div>`;
    }
    const exOpen = extras.map((e, idx) => ({ e, idx })).filter(({ e }) => !checks['x:' + e]);
    html += `<h2>Also buy</h2><div class="card tight"><ul class="list">${exOpen.map(({ e, idx }) => checkRow('grocery', ws, 'x:' + e, esc(e), '', `<button class="icon-btn btn-ghost btn-danger" data-act="extra-del" data-ws="${ws}" data-i="${idx}" aria-label="Remove ${esc(e)}">✕</button>`)).join('')}
      <li><form class="row" data-submit="extra-add" data-ws="${ws}"><input name="item" placeholder="e.g. tea, dish soap" autocomplete="off"><button class="btn-sm">Add</button></form></li></ul></div>`;
    if (pantry.length) html += `<details class="card tight" style="margin-top:10px"><summary>Pantry check · ${pantry.length} staples</summary><ul class="list">${pantry.map((i) => checkRow('grocery', ws, i.key, esc(i.food.name), esc(i.qty) + ' this week')).join('')}</ul></details>`;
    if (done.length) {
      const doneItems = groups.flatMap((g) => g.items).filter((i) => checks[i.key]);
      const doneEx = extras.filter((e) => checks['x:' + e]);
      html += `<details class="card tight basket" style="margin-top:10px"><summary>✓ In the basket · ${done.length}</summary><ul class="list">${doneItems.map((i) => checkRow('grocery', ws, i.key, `${esc(i.food.name)} <span class="muted">${esc(i.qty)}</span>`)).join('')}${doneEx.map((e) => checkRow('grocery', ws, 'x:' + e, esc(e))).join('')}</ul></details>`;
    }
    html += shareButtons('grocery', ws);
  } else {
    const { weekend, midweek, minutes, sunday } = prepPlan(dates);
    const row = (t) => checkRow('prep', ws, t.gk, `<b>${esc(t.title)}</b> <span class="tag">${t.m} min</span>${t.freezeText ? ' <span aria-label="freeze some">❄️</span>' : ''}
      ${t.startText ? `<div class="warn-text small">⏰ ${esc(t.startText.replace(/:.*/, ''))}</div>` : ''}${t.amountText ? `<div class="muted small">${esc(t.amountText)}</div>` : ''}
      <details class="more"><summary>How · for which dishes</summary><div class="small">${esc(t.startText ? t.startText.replace(/^[^:]*: /, '') + ' ' : '')}${esc(t.t)}</div>${t.dishText ? `<div class="muted small">For: ${esc(t.dishText)}</div>` : ''}${t.freezeText ? `<div class="muted small">❄️ ${esc(t.freezeText)}</div>` : ''}</details>`);
    html += `<div class="card accent" style="margin-top:12px"><b>${fmtDate(sunday)} · about ${minutes} min</b><div class="small">Then weekday cooking fits in 15–20 min. Each task covers every dish that needs it.</div></div>`;
    html += weekend.length ? `<div class="card tight" style="margin-top:10px"><ul class="list">${weekend.map(row).join('')}</ul></div>` : '<p class="muted">Nothing to prep ahead this week.</p>';
    if (midweek.length) html += `<h2>Mid-week</h2><p class="small sub" style="margin-top:-4px">These don’t keep or freeze well, so they’re done closer to the day.</p>`;
    for (const day of midweek) html += `<h3 style="margin-top:14px">${fmtDate(day.date)}</h3><div class="card tight"><ul class="list">${day.tasks.map(row).join('')}</ul></div>`;
    html += shareButtons('prep', ws);
  }
  return html;
}

function checkRow(kind, ws, key, main, sub = '', extra = '') {
  const on = !!(state.checks[kind + ':' + ws] || {})[key];
  return `<li><div class="check-item ${on ? 'done' : ''}"><input type="checkbox" aria-label="Done" data-change="check" data-kind="${kind}" data-ws="${ws}" data-key="${esc(key)}" ${on ? 'checked' : ''}><div class="ci-text">${main}${sub ? `<div class="muted">${sub}</div>` : ''}</div>${extra}</div></li>`;
}

// ════════════════════════ COOK ════════════════════════
function cookHead(date) {
  const wk = weekDates(weekStart(date));
  return `${modeToggle('cook')}<div class="daystrip">${wk.map((d) => `<a class="daychip ${d === date ? 'on' : ''} ${d === today() ? 'is-today' : ''}" href="#/cook/${d}"><span>${DAY[dow(d)]}</span><b>${+d.slice(8)}</b><i>${MEALS.some(({ k }) => state.plan[d]?.[k]?.dishes?.length) ? '•' : ''}</i></a>`).join('')}</div>`;
}

function viewCook(date) {
  const { insts, pre } = dayCooking(date);
  const checks = state.checks['cook:' + date] || {};
  const nb = nightBefore(addDays(date, 1));
  ui.cookDate = date;
  let html = cookHead(date) + `<div class="row between" style="margin:6px 0"><b>${fmtDate(date, true)}</b>${insts.length ? `<a class="btn btn-primary btn-sm" href="#/cook/${date}/steps">▶ Step-by-step</a>` : ''}</div>`;
  const left = MEALS.filter(({ k }) => slot(date, k)?.from && slot(date, k).dishes.length);
  if (left.length) html += `<div class="card accent tight">${left.map(({ k }) => `<b>${MEAL_LABEL[k]}:</b> pack leftovers – ${slotRecipes(slot(date, k)).map((r) => esc(r.name)).join(' + ')}`).join('<br>')}</div>`;
  if (!insts.length) return html + `<div class="card empty" style="margin-top:12px"><div class="big">🧑‍🍳</div><p>Nothing to cook on this day.</p><button class="btn" data-act="mode" data-v="plan">Open plan</button></div>`;

  if (pre.length) {
    html += `<h2>Before you start</h2><div class="card tight"><ul class="list">${pre.map((p, i) => {
      const key = 'pre:' + i;
      return `<li><div class="check-item ${checks[key] ? 'done' : ''}"><input type="checkbox" data-change="cook-check" data-date="${date}" data-key="${key}" ${checks[key] ? 'checked' : ''}><div class="ci-text"><b>${p.m} min before:</b> ${esc(p.t)}<div class="muted">${esc(p.dish)} · ${MEAL_LABEL[p.meal]}</div></div>
        <button class="btn-sm" data-act="timer" data-min="${p.m}" data-label="${esc(p.t)}" aria-label="Start ${p.m} minute timer">⏱ ${p.m}</button></div></li>`;
    }).join('')}</ul></div>`;
  }
  html += `<p class="muted legend">🧺 prepped ahead – tap for when · 🛒 fresh from the grocery list</p>`;
  for (const { k, label, icon } of MEALS) {
    const list = insts.filter((i) => i.meal === k);
    if (!list.length) continue;
    const sl = slot(date, k);
    html += `<h2>${icon} ${label}</h2>`;
    if (sl) html += `<p class="small sub" style="margin-top:-4px">Serve: ${state.profiles.map((p) => `${esc(p.name)} ${esc(portionAmount(slotRecipes(sl), portionOf(sl, k, p.id, date)))}`).join(' · ')}</p>`;
    for (const it of list) {
      const r = it.recipe;
      html += `<div class="card"><div class="row between"><h3 style="margin:0"><a href="#/recipe/${r.id}" style="color:inherit">${esc(r.name)}</a></h3><span class="tag">${active(r)} min</span></div>
        <p class="small sub">Cook <b>${+it.servings.toFixed(2)} servings</b>${it.leftovers.length ? ` <span class="tag green">incl. ${it.leftovers.map((l) => `${DAY[dow(l.date)]} ${MEAL_LABEL[l.meal].toLowerCase()}`).join(', ')}</span>` : ''}</p>
        <details open><summary>Ingredients</summary>${ingList(r, it.servings, date, true)}</details>
        <div style="margin-top:6px">${(r.steps || []).map((s, n) => {
          const [t, m] = Array.isArray(s) ? s : [s, 0];
          const key = `${k}|${r.id}|${n}`;
          return `<div class="step ${checks[key] ? 'done' : ''}"><button class="n" data-act="step-done" data-date="${date}" data-key="${esc(key)}" aria-label="Mark step ${n + 1} done">${checks[key] ? '✓' : n + 1}</button><div>${esc(t)}${m ? ` <button class="btn-sm" data-act="timer" data-min="${m}" data-label="${esc(r.name)}: ${esc(t.slice(0, 40))}">⏱ ${m} min</button>` : ''}</div></div>`;
        }).join('')}</div></div>`;
    }
  }
  if (nb.length) html += `<h2>Tonight, for tomorrow</h2><div class="card tight"><ul class="list">${nb.map((t) => `<li>☐ ${esc(t.t)} <span class="muted">· ${esc(t.dish)}</span></li>`).join('')}</ul></div>`;
  html += shareButtons('cook', date);
  return html;
}

/** One flat sequence for step-by-step mode: pre-steps, then every dish's steps in meal order. */
function cookSequence(date) {
  const { insts, pre } = dayCooking(date);
  const seq = pre.map((p, i) => ({ kind: 'pre', key: 'pre:' + i, t: `${p.t} (${p.m} min before)`, m: p.m, ctx: `Before you start · ${p.dish}` }));
  for (const { k } of MEALS) {
    for (const it of insts.filter((i) => i.meal === k)) {
      const steps = it.recipe.steps || [];
      steps.forEach((s, n) => {
        const [t, m] = Array.isArray(s) ? s : [s, 0];
        seq.push({ kind: 'step', key: `${k}|${it.recipe.id}|${n}`, t, m, it, n, total: steps.length, ctx: `${MEAL_LABEL[k]} · ${it.recipe.name} · step ${n + 1} of ${steps.length}` });
      });
    }
  }
  return seq;
}

function viewSteps(date) {
  const seq = cookSequence(date);
  if (!seq.length) return `<p>Nothing to cook.</p><a class="btn" href="#/cook/${date}">Back</a>`;
  const idx = Math.min(seq.length - 1, Math.max(0, ui.step[date] ?? 0));
  ui.step[date] = idx;
  const s = seq[idx];
  const done = (state.checks['cook:' + date] || {})[s.key];
  let html = `<div class="row between steps-top"><a class="btn-ghost" href="#/cook/${date}">✕ Exit</a><span class="muted">${idx + 1} / ${seq.length}</span></div>
    <div class="progress" role="progressbar" aria-valuenow="${idx + 1}" aria-valuemax="${seq.length}"><i style="width:${((idx + 1) / seq.length) * 100}%"></i></div>
    <p class="eyebrow" style="margin-top:14px">${esc(s.ctx)}${done ? ' · ✓ done' : ''}</p>
    <p class="step-big">${esc(s.t)}</p>`;
  if (s.m) html += `<button class="btn-block timer-big" data-act="timer" data-min="${s.m}" data-label="${esc(s.t.slice(0, 40))}">⏱ Start ${s.m}-min timer</button>`;
  if (s.kind === 'step') html += `<details class="card tight" ${s.n === 0 ? 'open' : ''} style="margin-top:14px"><summary>Ingredients · ${esc(s.it.recipe.name)}</summary>${ingList(s.it.recipe, s.it.servings, date, true)}</details>`;
  html += `<div class="step-nav"><button data-act="step-go" data-date="${date}" data-d="-1" ${idx === 0 ? 'disabled' : ''}>‹ Back</button><button class="btn-primary" data-act="step-go" data-date="${date}" data-d="1">${idx === seq.length - 1 ? 'Finish ✓' : 'Done · next ›'}</button></div>`;
  return html;
}

// ════════════════════════ INGREDIENT LISTS ════════════════════════
/** Ingredient rows marked 🧺 prepped (tap the pill for timing) or 🛒 fresh from the grocery list. */
function ingList(r, servings, date, small = false) {
  const prep = ingredientPrep(r, date);
  return `<ul class="list ing-list ${small ? 'small' : ''}">${scaledIngredients(r, servings).map((i) => {
    const v = i.f && prep.get(i.f);
    const pill = v ? ` <button class="ptag prepped" data-act="prep-info" data-rid="${r.id}" data-f="${i.f}" data-date="${date}">${esc(prepName(v, i.f))} ›</button>` : '';
    return `<li class="ing"><span class="ing-ico" role="img" aria-label="${v ? 'prepped ahead' : 'fresh'}">${v ? '🧺' : '🛒'}</span><span class="grow">${esc(i.food.name)}${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ''}${pill}</span><b class="nowrap">${esc(i.qty)}</b></li>`;
  }).join('')}</ul>`;
}

function sheetPrepInfo(s) {
  const r = getRecipe(s.rid);
  const v = ingredientPrep(r, s.date).get(s.f);
  if (!v) return '<p>No prep needed.</p>';
  const sc = v.sched;
  const modeText = {
    weekend: `Made in Sunday’s prep and kept in the fridge (keeps ${v.keeps} day${v.keeps > 1 ? 's' : ''}).`,
    freeze: `Cooking day is more than ${v.keeps} day${v.keeps > 1 ? 's' : ''} after Sunday, so make it on Sunday and freeze it.`,
    midweek: `Keeps only ${v.keeps} day${v.keeps > 1 ? 's' : ''} and doesn’t freeze well, so make it closer to the day.`,
  }[sc.mode];
  const t = TASKS[v.key];
  return `<h3>🧺 ${esc(prepName(v, s.f))}</h3>
    <p class="small sub">For <b>${esc(r.name)}</b> · cooking on <b>${fmtDate(s.date, true)}</b></p>
    <div class="card accent tight small">${modeText}</div>
    <ol class="timeline">${sc.steps.map((st) => `<li><div class="when">${fmtDate(st.date)}${st.time ? ` · ${esc(st.time)}` : ''}</div><div>${esc(st.t)}</div></li>`).join('')}
      <li><div class="when">${fmtDate(s.date)}</div><div>Use it in ${esc(r.name)} 🍳</div></li></ol>
    ${sc.until ? `<p class="muted">Use by ${fmtDate(sc.until)}.</p>` : ''}
    ${t ? `<p class="muted">Hands-on ~${t.m} min. Done once for every dish that needs it this week (Prep → Sunday prep).</p>` : ''}`;
}

// ════════════════════════ RECIPES ════════════════════════
const TAG_LABEL = { lunchbox: '🍱 Lunchbox', protein: '💪 30 g+ protein', airfryer: 'Air fryer', microwave: 'Microwave', noprep: '⚡ No prep', soup: '🥣 Soups', salad: '🥗 Salads', fav: '⭐ Favourites', mine: 'My recipes' };
const DIET_LABEL = { nonveg: '🍗 Non-veg', veg: '🥦 Veg' };
function activeFilters() {
  const f = ui.rf, a = [];
  if (f.cuisine !== 'all') a.push(['cuisine', f.cuisine]);
  if (f.tag !== 'all') a.push(['tag', TAG_LABEL[f.tag]]);
  if (f.diet !== 'all') a.push(['diet', DIET_LABEL[f.diet]]);
  return a;
}

function viewRecipes() {
  const f = ui.rf;
  const chip = (k, v, l) => `<button class="chip ${f[k] === v ? 'on' : ''}" data-act="rf" data-k="${k}" data-v="${v}">${l}</button>`;
  const act = activeFilters();
  return `<div class="row between page-head"><h1>Recipes</h1><div class="row"><a class="btn btn-sm" href="#/ai">✨ Ask Claude</a><a class="btn btn-sm btn-primary" href="#/edit/new" aria-label="New recipe">+ New</a></div></div>
    <input type="search" placeholder="Search ${allRecipes().length} recipes or ingredients…" value="${esc(f.q)}" data-input="rq" autocomplete="off" style="margin:4px 0 8px">
    <div class="chips">${chip('meal', 'all', 'All')}${chip('meal', 'b', 'Breakfast')}${chip('meal', 'l', 'Lunch')}${chip('meal', 'd', 'Dinner')}${chip('meal', 's', 'Snack')}</div>
    <div class="chips"><button class="chip filter-btn ${act.length ? 'on' : ''}" data-act="filters">⚙︎ Filters${act.length ? ` (${act.length})` : ''}</button>${act.map(([k, l]) => `<button class="chip active-filter" data-act="rf" data-k="${k}" data-v="all" aria-label="Remove filter ${esc(l)}">${esc(l)} ✕</button>`).join('')}</div>
    <div id="rlist"></div>`;
}

function filteredRecipes() {
  const f = ui.rf, q = f.q.toLowerCase();
  return allRecipes().filter((r) => {
    if (f.meal !== 'all' && !r.meals?.includes(f.meal)) return false;
    if (f.cuisine !== 'all' && r.cuisine !== f.cuisine) return false;
    if (f.tag === 'lunchbox' && !r.lunchbox) return false;
    if (f.tag === 'protein' && perServing(r).p < 30) return false;
    if (f.tag === 'soup' && r.cat !== 'soup') return false;
    if ((f.tag === 'airfryer' || f.tag === 'microwave') && r.method !== f.tag) return false;
    if (f.tag === 'noprep' && !isNoPrep(r)) return false;
    if (f.tag === 'salad' && r.cat !== 'salad') return false;
    if (f.tag === 'fav' && !state.favorites.includes(r.id)) return false;
    if (f.tag === 'mine' && !r.custom) return false;
    if (f.diet === 'veg' && dietOf(r) !== 'veg') return false;
    if (f.diet === 'nonveg' && dietOf(r) === 'veg') return false;
    if (q && !(r.name + ' ' + r.cuisine + ' ' + (r.ing || []).map((i) => ingFood(normIng(i)).name).join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderRecipeList() {
  const el = document.getElementById('rlist');
  if (!el) return;
  const list = filteredRecipes();
  el.innerHTML = list.length
    ? list.map((r) => {
      const n = perServing(r);
      const meta = [DIET_ICON[dietOf(r)], r.method ? METHOD[r.method] : '', isNoPrep(r) ? '⚡ no prep' : '', r.lunchbox ? '🍱' : ''].filter(Boolean).join(' · ');
      return `<a class="card rcard" href="#/recipe/${r.id}"><div class="emoji" aria-hidden="true">${emoji(r)}</div><div class="grow"><h3>${esc(r.name)}${state.favorites.includes(r.id) ? ' ⭐' : ''}</h3>
        <div class="macros">${fmt(n.kcal)} kcal · ${r0(n.p)} g protein · ${active(r)} min</div><div class="muted">${meta}</div></div><span class="chev">›</span></a>`;
    }).join('')
    : `<div class="empty"><p>No recipes match.</p><button class="btn" data-act="rf-reset">Clear filters</button></div>`;
}

function sheetFilters() {
  const f = ui.rf;
  const chip = (k, v, l) => `<button class="chip ${f[k] === v ? 'on' : ''}" data-act="rf" data-k="${k}" data-v="${f[k] === v && v !== 'all' ? 'all' : v}">${l}</button>`;
  return `<h3>Filters</h3>
    <label>Cuisine</label><div class="chips wrap">${chip('cuisine', 'all', 'Any')}${['North Indian', 'South Indian', 'Indian', 'Asian', 'Continental'].map((c) => chip('cuisine', c, c)).join('')}</div>
    <label>Type</label><div class="chips wrap">${chip('tag', 'all', 'Any')}${Object.entries(TAG_LABEL).map(([k, l]) => chip('tag', k, l)).join('')}</div>
    <label>Veg / non-veg</label><div class="chips wrap">${chip('diet', 'all', 'Both')}${chip('diet', 'nonveg', '🍗 Non-veg')}${chip('diet', 'veg', '🥦 Veg')}</div>
    <div class="row" style="margin-top:14px"><button class="grow" data-act="rf-reset">Reset</button><button class="grow btn-primary" data-act="sheet-close">Show ${filteredRecipes().length} recipes</button></div>`;
}

const withPair = (r) => { const side = r.cat === 'main' && r.pair?.length ? getRecipe(r.pair[0]) : null; return [r, side && (side.cat === 'side' || perServing(r).kcal < 380) ? side : null].filter(Boolean); };

function recipePortions(r) {
  if (ui.recipePortions[r.id]) return ui.recipePortions[r.id];
  const meal = r.meals?.includes('l') ? 'l' : r.meals?.[0] || 'l';
  const pp = {};
  const combo = withPair(r);
  for (const p of state.profiles) pp[p.id] = ['side', 'snack'].includes(r.cat) ? 1 : autoPortion(p, meal, combo, enabledMeals(today()));
  return (ui.recipePortions[r.id] = pp);
}

function viewRecipe(id) {
  const r = getRecipe(id);
  if (!r) return `<p>Recipe not found.</p><a href="#/recipes">Back</a>`;
  const n = perServing(r);
  const pp = recipePortions(r);
  const total = Object.values(pp).reduce((a, b) => a + b, 0);
  const fav = state.favorites.includes(r.id);
  const diet = dietOf(r);
  let html = `<div class="row between"><a class="btn-ghost" href="#/recipes">‹ Recipes</a><div class="row" style="gap:2px">
      <button class="icon-btn btn-ghost" data-act="share-more" data-kind="recipe" data-arg="${r.id}" aria-label="Share recipe">${SHARE_ICON}</button>
      <button class="icon-btn btn-ghost" data-act="fav" data-id="${r.id}" aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}" aria-pressed="${fav}">${fav ? '⭐' : '☆'}</button>
      <button class="icon-btn btn-ghost" data-act="recipe-menu" data-id="${r.id}" aria-label="More options">⋯</button></div></div>
    <h1>${esc(r.name)}</h1>
    <div class="row wrap tags"><span class="tag">${DIET_ICON[diet]} ${{ veg: 'veg', egg: 'egg', nonveg: 'non-veg' }[diet]}</span><span class="tag">⏱ ${r.prep} + ${r.cook} min</span>${r.method ? `<span class="tag">${METHOD[r.method]} only</span>` : ''}${isNoPrep(r) ? '<span class="tag green">⚡ no prep</span>' : ''}${r.lunchbox ? '<span class="tag green">🍱 lunchbox</span>' : ''}<span class="tag">${esc(r.cuisine)}</span></div>
    ${r.why ? `<p class="small sub">${esc(r.why)}</p>` : ''}
    <div class="card tight" style="margin-top:12px"><div class="muted">Per serving${r.unit ? ` (${r.unit[0]} ${esc(r.unit[1])})` : ''}</div>
      <div class="stats" style="margin-top:4px"><div class="stat"><b>${fmt(n.kcal)}</b><span>kcal</span></div><div class="stat"><b>${r0(n.p)} g</b><span>protein</span></div><div class="stat"><b>${r0(n.c)} g</b><span>carbs</span></div><div class="stat"><b>${r0(n.f)} g</b><span>fat</span></div></div></div>
    <h2>Portions</h2><div class="card tight">`;
  for (const p of state.profiles) {
    html += `<div class="row between" style="padding:4px 0"><div class="grow"><div class="row" style="gap:6px">${pDot(p)}${esc(p.name)}</div><div class="muted">${esc(portionAmount([r], pp[p.id]))} · ${fmt(n.kcal * pp[p.id])} kcal</div></div>
      <div class="stepper"><button data-act="rp-step" data-id="${r.id}" data-pid="${p.id}" data-d="-0.25" aria-label="Less for ${esc(p.name)}">−</button><span class="v">${mult(pp[p.id])}</span><button data-act="rp-step" data-id="${r.id}" data-pid="${p.id}" data-d="0.25" aria-label="More for ${esc(p.name)}">+</button></div></div>`;
  }
  const side = withPair(r)[1];
  html += `<div class="muted" style="margin-top:4px">${side ? `Assumes it’s served with ${esc(side.name.toLowerCase())}. ` : ''}Cooking ${+total.toFixed(2)} servings.</div></div>`;

  const planned = nextPlannedDate(r.id);
  const cookDate = planned || addDays(today(), 1);
  html += `<h2>Ingredients</h2><p class="muted legend" style="margin-top:-4px">🧺 prepped ahead – tap for when (${planned ? 'next planned' : 'if cooked'} ${fmtDate(cookDate)}) · 🛒 fresh</p><div class="card tight">${ingList(r, total, cookDate)}</div>`;

  const wk = [...(r.wk || []).map((k) => TASKS[k] && `${esc(TASKS[k].title || TASKS[k].t)} <span class="tag">${TASKS[k].m} min</span>`).filter(Boolean), ...(r.wkCustom || []).map((c) => `${esc(c.t)} <span class="tag">${c.m} min</span>`)];
  const aheadCount = wk.length + (r.nt?.length || 0) + (r.pre?.length || 0);
  if (aheadCount) {
    html += `<details class="card tight" style="margin-top:14px"><summary><b>Time plan</b> · ${plural(aheadCount, 'thing')} to do ahead</summary>`;
    if (wk.length) html += `<b class="small">🧺 Sunday prep</b><ul class="small">${wk.map((t) => `<li>${t}</li>`).join('')}</ul>`;
    if (r.nt?.length) html += `<b class="small">🌙 Night before</b><ul class="small">${r.nt.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    if (r.pre?.length) html += `<b class="small">⏰ Before cooking</b><ul class="small">${r.pre.map(([t, m]) => `<li><b>${m} min before:</b> ${esc(t)}</li>`).join('')}</ul>`;
    html += `</details>`;
  }
  html += `<h2>Steps</h2><div class="card tight">${(r.steps || []).map((s, i) => {
    const [t, m] = Array.isArray(s) ? s : [s, 0];
    return `<div class="step"><span class="n">${i + 1}</span><div>${esc(t)}${m ? ` <button class="btn-sm" data-act="timer" data-min="${m}" data-label="${esc(r.name)}">⏱ ${m} min</button>` : ''}</div></div>`;
  }).join('')}</div>`;
  if (r.pair?.length) html += `<p class="small sub" style="margin-top:10px">Goes well with: ${r.pair.map((pid) => getRecipe(pid)).filter(Boolean).map((x) => `<a href="#/recipe/${x.id}">${esc(x.name)}</a>`).join(', ')}</p>`;
  html += `<div class="action-bar"><button class="btn-primary btn-block" data-act="plan-recipe" data-id="${r.id}">+ Add to plan</button></div>`;
  return html;
}

function sheetRecipeMenu(s) {
  const r = getRecipe(s.id);
  return `<h3>${esc(r.name)}</h3><div class="menu">
    <button data-act="share" data-kind="recipe" data-arg="${r.id}">Send on WhatsApp</button>
    ${r.custom ? `<a class="btn" href="#/edit/${r.id}">Edit recipe</a><button class="btn-danger" data-act="del-recipe" data-id="${r.id}">Delete recipe</button>` : `<a class="btn" href="#/edit/new?from=${r.id}">Copy & edit as my recipe</a>`}
  </div>`;
}

function sheetPlanRecipe(id) {
  const r = getRecipe(id);
  const s = ui.sheet;
  const start = today();
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  s.date ||= start;
  s.meal ||= r.meals?.find((m) => m !== 's') || r.meals?.[0] || 'd';
  return `<h3>Add “${esc(r.name)}” to…</h3>
    <label>Day</label><div class="chips">${days.map((d) => `<button class="chip ${s.date === d ? 'on' : ''}" data-act="sheet-set" data-k="date" data-v="${d}">${fmtDate(d).replace(/ \w+$/, '')}</button>`).join('')}</div>
    <label>Meal</label><div class="chips">${MEALS.map(({ k, label }) => `<button class="chip ${s.meal === k ? 'on' : ''}" data-act="sheet-set" data-k="meal" data-v="${k}">${label}</button>`).join('')}</div>
    <p class="muted">${slotRecipes(slot(s.date, s.meal)).length ? 'Already in this meal: ' + slotRecipes(slot(s.date, s.meal)).map((x) => esc(x.name)).join(', ') : 'This meal is empty.'}</p>
    <button class="btn-primary btn-block" data-act="plan-recipe-go" data-id="${id}">Add</button>`;
}

// ════════════════════════ EDITOR ════════════════════════
function newDraft(base) {
  const r = base ? JSON.parse(JSON.stringify(base)) : { name: '', cuisine: 'Indian', cat: 'main', meals: ['l', 'd'], lunchbox: true, serves: 2, prep: 5, cook: 15, ing: [], steps: [] };
  return {
    id: base?.custom ? base.id : null,
    name: base && !base.custom ? r.name + ' (my version)' : r.name,
    cuisine: r.cuisine, cat: r.cat, meals: r.meals || [], lunchbox: !!r.lunchbox, serves: r.serves, prep: r.prep, cook: r.cook,
    unitN: r.unit?.[0] || '', unitL: r.unit?.[1] || '',
    ing: (r.ing || []).map(normIng).map((i) => ({ name: i.f ? FOODS[i.f]?.name : i.name, f: i.f, g: i.g, note: i.note, n: i.n || { kcal: '', p: '', c: '', f: '' } })),
    steps: (r.steps || []).map((s) => (Array.isArray(s) ? `${s[0]} [${s[1]}]` : s)).join('\n'),
    wk: [...(r.wk || [])],
    wkCustom: (r.wkCustom || []).map((c) => `${c.t} | ${c.m}`).join('\n'),
    wkMeta: r.wkCustom || [],
    nt: (r.nt || []).join('\n'),
    pre: (r.pre || []).map(([t, m]) => `${m} | ${t}`).join('\n'),
    why: r.why || '', source: r.source, method: r.method, noPrep: r.noPrep,
  };
}

const FOOD_BY_NAME = new Map(FOOD_LIST.map((f) => [f.name.toLowerCase(), f.id]));

function viewEditor(id, q) {
  if (!ui.draft || ui.draft._for !== (id + (q.get('from') || ''))) {
    const base = id === 'new' ? (q.get('from') ? getRecipe(q.get('from')) : null) : getRecipe(id);
    ui.draft = newDraft(base);
    ui.draft._for = id + (q.get('from') || '');
    if (!ui.draft.ing.length) ui.draft.ing.push({ name: '', f: null, g: '', note: '', n: {} });
  }
  const d = ui.draft;
  const sel = (field, opts, v) => `<select data-field="${field}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const cuisines = ['North Indian', 'South Indian', 'Indian', 'Asian', 'Continental'].map((c) => [c, c]);
  const cats = [['breakfast', 'Breakfast'], ['main', 'Main'], ['side', 'Side'], ['soup', 'Soup'], ['salad', 'Salad'], ['snack', 'Snack']];
  return `<div class="row between"><a class="btn-ghost" href="${d.id ? '#/recipe/' + d.id : '#/recipes'}">‹ Cancel</a><button class="btn-primary btn-sm" data-act="save-recipe">Save</button></div>
    <h1>${d.id ? 'Edit recipe' : 'New recipe'}</h1>
    <label>Name</label><input data-field="name" value="${esc(d.name)}" placeholder="e.g. Amma's chicken fry">
    <div class="grid2"><div><label>Cuisine</label>${sel('cuisine', cuisines, d.cuisine)}</div><div><label>Type</label>${sel('cat', cats, d.cat)}</div></div>
    <label>Good for</label><div class="row wrap">${MEALS.map(({ k, label }) => `<label class="row" style="margin:0;color:var(--text);font-size:15px"><input type="checkbox" data-field="meal:${k}" ${d.meals.includes(k) ? 'checked' : ''}> ${label}</label>`).join('')}
      <label class="row" style="margin:0;color:var(--text);font-size:15px"><input type="checkbox" data-field="lunchbox" ${d.lunchbox ? 'checked' : ''}> 🍱 Lunchbox</label></div>
    <div class="grid3"><div><label>Serves</label><input type="number" inputmode="decimal" data-field="serves" value="${esc(d.serves)}"></div><div><label>Prep min</label><input type="number" inputmode="numeric" data-field="prep" value="${esc(d.prep)}"></div><div><label>Cook min</label><input type="number" inputmode="numeric" data-field="cook" value="${esc(d.cook)}"></div></div>
    <div class="grid2"><div><label>1 serving = (count)</label><input type="number" inputmode="decimal" data-field="unitN" value="${esc(d.unitN)}" placeholder="2"></div><div><label>unit</label><input data-field="unitL" value="${esc(d.unitL)}" placeholder="phulkas / bowl"></div></div>

    <h2>Ingredients <span class="muted">(whole recipe, raw weight in grams)</span></h2>
    <datalist id="foodlist">${FOOD_LIST.map((f) => `<option value="${esc(f.name)}">`).join('')}</datalist>
    <div id="ing-rows">${d.ing.map((i, idx) => ingRow(i, idx)).join('')}</div>
    <button class="btn-sm" data-act="ing-add">+ Ingredient</button>
    <p class="muted">Pick from the list to get nutrition automatically. For anything not listed, type a name and fill in its nutrition per 100 g (from the pack label).</p>
    <div class="card accent" id="draft-nutr">${draftNutrition()}</div>

    <h2>Steps</h2><textarea data-field="steps" placeholder="One step per line. Add [10] at the end of a line for a 10-minute timer.">${esc(d.steps)}</textarea>
    <h2>Time plan</h2>
    <label>Weekend prep (pick any)</label><div>${Object.entries(TASKS).map(([k, t]) => `<label class="row" style="color:var(--text);font-size:14px;margin:4px 0"><input type="checkbox" data-field="wk:${k}" ${d.wk.includes(k) ? 'checked' : ''}> ${esc(t.t.split(/[:(.–]/)[0])}</label>`).join('')}</div>
    <label>Other weekend prep (one per line, “task | minutes”)</label><textarea data-field="wkCustom" placeholder="Make green chutney | 10">${esc(d.wkCustom)}</textarea>
    <label>Night before (one per line)</label><textarea data-field="nt" placeholder="Soak rajma">${esc(d.nt)}</textarea>
    <label>Before cooking (one per line, “minutes | task”)</label><textarea data-field="pre" placeholder="15 | Take chicken out of fridge">${esc(d.pre)}</textarea>
    <button class="btn-primary btn-block" data-act="save-recipe" style="margin-top:16px">Save recipe</button>`;
}

function ingRow(i, idx) {
  return `<div class="card tight" style="margin-bottom:6px"><div class="ing-row"><input list="foodlist" data-ing="${idx}" data-k="name" value="${esc(i.name || '')}" placeholder="Ingredient" autocomplete="off">
    <input type="number" inputmode="decimal" data-ing="${idx}" data-k="g" value="${esc(i.g)}" placeholder="grams"><button class="icon-btn btn-ghost btn-danger" data-act="ing-del" data-i="${idx}" aria-label="Remove">✕</button></div>
    <div class="ing-extra" data-for="${idx}">${ingExtra(i, idx)}</div></div>`;
}

function ingExtra(i, idx) {
  if (i.f && FOODS[i.f]) return `<div class="muted">✓ ${esc(FOODS[i.f].name)}${+i.g ? ' · ' + esc(fmtQty(i.f, +i.g)) : ''}</div>`;
  if (!i.name) return '';
  return `<div class="muted" style="margin-top:4px">Not in the food list – enter nutrition per 100 g:</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:4px">${['kcal', 'p', 'c', 'f'].map((k) => `<input type="number" inputmode="decimal" data-ing="${idx}" data-k="n.${k}" value="${esc(i.n?.[k] ?? '')}" placeholder="${{ kcal: 'kcal', p: 'protein', c: 'carbs', f: 'fat' }[k]}">`).join('')}</div>`;
}

function draftToRecipe(d) {
  const parseLines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  return {
    id: d.id || uid('my'),
    name: d.name.trim(),
    cuisine: d.cuisine, cat: d.cat, meals: d.meals.length ? d.meals : ['l', 'd'], lunchbox: d.lunchbox,
    serves: Math.max(1, +d.serves || 2), prep: +d.prep || 0, cook: +d.cook || 0,
    unit: d.unitN && d.unitL ? [+d.unitN, d.unitL] : undefined,
    ing: d.ing.filter((i) => i.name && +i.g > 0).map((i) => (i.f ? { f: i.f, g: +i.g, note: i.note || '' } : { name: i.name, g: +i.g, note: i.note || '', n: { kcal: +i.n?.kcal || 0, p: +i.n?.p || 0, c: +i.n?.c || 0, f: +i.n?.f || 0, fib: 0 } })),
    steps: parseLines(d.steps).map((l) => { const m = l.match(/\[(\d+)\s*(?:min)?\]\s*$/i); return m ? [l.replace(m[0], '').trim(), +m[1]] : l; }),
    wk: d.wk,
    wkCustom: parseLines(d.wkCustom).map((l) => { const [t, m] = l.split('|').map((x) => x.trim()); const meta = (d.wkMeta || []).find((c) => c.t === t) || {}; return { ...meta, t, m: +m || 10 }; }),
    nt: parseLines(d.nt),
    pre: parseLines(d.pre).map((l) => { const [m, ...t] = l.split('|'); return isNaN(+m) ? [l, 10] : [t.join('|').trim(), +m]; }),
    why: d.why, source: d.source, method: d.method, noPrep: d.noPrep, custom: true,
  };
}

function draftNutrition() {
  const r = draftToRecipe(ui.draft);
  const n = perServing(r);
  return `<b>Per serving:</b> ${fmt(n.kcal)} kcal · ${r0(n.p)} g protein · ${r0(n.c)} g carbs · ${r0(n.f)} g fat`;
}

// ════════════════════════ AI ════════════════════════
function viewAI() {
  const a = ui.ai;
  const hasKey = !!state.settings.apiKey;
  let html = `<a class="btn-ghost" href="#/recipes">‹ Recipes</a><h1>✨ Ask Claude</h1>
    <p class="sub">Get new recipe ideas that fit your targets, or paste any recipe to save it with nutrition worked out.</p>`;
  if (!hasKey) html += `<div class="card warn"><b>Add an API key first.</b><p class="small">Claude runs with your own Anthropic API key (pay-as-you-go, a few rupees per request). Add it under <a href="#/me">Me → Settings</a>.</p></div>`;
  html += `<h2>Suggest recipes</h2><div class="card">
    <label>Meal</label><div class="seg">${MEALS.map(({ k, label }) => `<button class="${a.meal === k ? 'on' : ''}" data-act="ai-set" data-k="meal" data-v="${k}">${label}</button>`).join('')}</div>
    <label>Type</label><div class="seg">${[['nonveg', '🍗 Non-veg'], ['veg', '🥦 Veg']].map(([k, l]) => `<button class="${a.diet === k ? 'on' : ''}" data-act="ai-set" data-k="diet" data-v="${k}">${l}</button>`).join('')}</div>
    <label>Style</label><div class="chips">${['Any', 'North Indian', 'South Indian', 'Asian', 'Continental'].map((c) => `<button class="chip ${a.cuisine === c ? 'on' : ''}" data-act="ai-set" data-k="cuisine" data-v="${c}">${c}</button>`).join('')}</div>
    <label>Ingredients I have (optional)</label><input data-aifield="have" value="${esc(a.have)}" placeholder="e.g. chicken thighs, spinach, curd">
    <label>Anything else? (optional)</label><input data-aifield="notes" value="${esc(a.notes)}" placeholder="e.g. no coconut, kid-friendly, air fryer">
    <button class="btn-primary btn-block" style="margin-top:12px" data-act="ai-suggest" ${a.loading || !hasKey ? 'disabled' : ''}>${a.loading === 'suggest' ? '<span class="spinner"></span> Thinking…' : 'Suggest 3 recipes'}</button></div>`;
  html += `<h2>Import a recipe</h2><div class="card"><textarea data-aifield="importText" placeholder="Paste a recipe from a website, WhatsApp, or your notes…">${esc(a.importText)}</textarea>
    <button class="btn-block" style="margin-top:8px" data-act="ai-import" ${a.loading || !hasKey ? 'disabled' : ''}>${a.loading === 'import' ? '<span class="spinner"></span> Converting…' : 'Convert & preview'}</button></div>`;
  if (a.error) html += `<div class="card warn" style="margin-top:10px">${esc(a.error)}</div>`;
  if (a.results.length) {
    html += `<h2>Results</h2>`;
    for (const r of a.results) {
      const n = perServing(r);
      const saved = state.customRecipes.some((x) => x.id === r.id);
      html += `<div class="card"><div class="row between"><h3 style="margin:0">${emoji(r)} ${esc(r.name)}</h3><span class="tag">${active(r)} min</span></div>
        <p class="macros">${macroLine(n)} per serving · ${esc(r.cuisine)}${r.lunchbox ? ' · 🍱' : ''}</p><p class="small sub">${esc(r.why || '')}</p>
        <details><summary>Ingredients & steps</summary><ul class="small">${scaledIngredients(r, r.serves).map((i) => `<li>${esc(i.food.name)} – ${esc(i.qty)}</li>`).join('')}</ul>
        <ol class="small">${r.steps.map((s) => `<li>${esc(Array.isArray(s) ? `${s[0]} (${s[1]} min)` : s)}</li>`).join('')}</ol></details>
        <div class="row" style="margin-top:8px">${saved ? `<a class="btn btn-sm" href="#/recipe/${r.id}">Saved ✓ – open</a>` : `<button class="btn-sm btn-primary" data-act="ai-save" data-id="${r.id}">Save to my recipes</button>`}</div></div>`;
    }
  }
  return html;
}

// ════════════════════════ ME / PROFILES / SETTINGS ════════════════════════
function viewMe() {
  if (!ui.meProfile || !profileById(ui.meProfile)) ui.meProfile = state.profiles[0]?.id;
  const p = profileById(ui.meProfile);
  const t = targets(p);
  const d = today();
  let html = `<div class="row between page-head"><h1>Me</h1><a class="btn btn-sm" href="#/settings" aria-label="Settings">⚙︎ Settings</a></div>
    <div class="chips">${state.profiles.map((x) => `<button class="chip ${x.id === p.id ? 'on' : ''}" data-act="me-p" data-id="${x.id}">${esc(x.name)}</button>`).join('')}<a class="chip" href="#/profile/new">+ Person</a></div>`;
  html += `<div class="card tight"><div class="row between"><b>${pDot(p)} Daily targets</b><a class="btn-ghost btn-sm" href="#/profile/${p.id}">Edit</a></div>
    <div class="stats" style="margin-top:6px"><div class="stat"><b>${fmt(t.kcal)}</b><span>kcal</span></div><div class="stat"><b>${t.p} g</b><span>protein</span></div><div class="stat"><b>${t.c} g</b><span>carbs</span></div><div class="stat"><b>${t.f} g</b><span>fat</span></div></div>
    <details><summary>How this is worked out</summary><p class="muted">Fibre ${t.fib} g · BMR ${fmt(t.bmr)} · maintenance ≈ ${fmt(t.tdee)} kcal · ${esc(GOALS[p.goal]?.label || '')} · BMI ${bmi(p).toFixed(1)}</p></details></div>`;

  const days = Array.from({ length: 7 }, (_, i) => addDays(d, i - 6));
  const rows = days.map((x) => ({ x, n: dayIntake(x, p.id, { eatenOnly: true }) }));
  const logged = rows.filter((r) => r.n.kcal > 0);
  const avgK = logged.length ? logged.reduce((s, r) => s + r.n.kcal, 0) / logged.length : 0;
  const avgP = logged.length ? logged.reduce((s, r) => s + r.n.p, 0) / logged.length : 0;
  html += `<h2>Last 7 days</h2><div class="card tight">`;
  if (logged.length) {
    html += `<div class="row between small"><span>Calories eaten</span><span class="muted">dashed = target</span></div>
      ${barChart(rows.map((r) => ({ x: r.x, y: r.n.kcal, target: t.kcal })), { label: 'Calories per day' })}
      <p class="small">Average: <b>${fmt(avgK)} kcal</b> (target ${fmt(t.kcal)}) · <b>${r0(avgP)} g protein</b> (target ${t.p} g)</p>
      <details><summary>Table</summary><table class="tbl"><tr><th>Day</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr>${rows.map((r) => `<tr><td>${fmtDate(r.x)}</td><td>${fmt(r.n.kcal)}</td><td>${r0(r.n.p)} g</td><td>${r0(r.n.c)} g</td><td>${r0(r.n.f)} g</td></tr>`).join('')}</table></details>`;
  } else html += `<p class="muted">Tick meals as eaten on Today to see your trend here.</p>`;
  html += `</div>`;

  const ws = [...(state.weights[p.id] || [])].sort((a, b) => a.d.localeCompare(b.d));
  const first = ws[0], last = ws[ws.length - 1];
  html += `<h2>Weight</h2><div class="card tight"><form class="row" data-submit="weight" data-pid="${p.id}"><input name="kg" type="number" step="0.1" inputmode="decimal" placeholder="Today’s weight (kg)" required aria-label="Today's weight in kg"><button class="btn-primary">Log</button></form>`;
  if (ws.length >= 2) html += `<p class="small" style="margin-top:10px">${last.kg} kg now · <b>${(last.kg - first.kg > 0 ? '+' : '') + (last.kg - first.kg).toFixed(1)} kg</b> since ${fmtDate(first.d)}</p>${lineChart(ws.map((w) => ({ x: w.d, y: w.kg })), { label: 'Weight' })}`;
  else if (ws.length) html += `<p class="muted" style="margin-top:8px">${last.kg} kg on ${fmtDate(last.d)}. Log weekly (same time, morning) to see a trend.</p>`;
  if (ws.length) html += `<details><summary>History</summary><ul class="list small">${ws.slice().reverse().map((w) => `<li class="row between"><span>${fmtDate(w.d)}</span><span class="row">${w.kg} kg <button class="icon-btn btn-ghost btn-danger" data-act="weight-del" data-pid="${p.id}" data-d="${w.d}" aria-label="Delete ${w.kg} kg on ${fmtDate(w.d)}">✕</button></span></li>`).join('')}</ul></details>`;
  html += `</div><p class="muted" style="margin:16px 0">Nutrition values are estimates from IFCT/USDA data, so they can be off by about 10–15%. Ask a doctor or dietitian about medical conditions.</p>`;
  return html;
}

function viewSettings() {
  const st = state.settings;
  return `<a class="btn-ghost" href="#/me">‹ Me</a><h1>Settings</h1>
    <h2>Meals per day</h2><div class="card tight">${mealGrid()}</div>
    <h2>Workdays</h2><div class="card tight"><p class="muted" style="margin:0 0 6px">Lunch on these days is lunchbox-friendly.</p><div class="chips wrap">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<button class="chip ${st.workdays.includes(i) ? 'on' : ''}" data-act="workday" data-v="${i}" aria-pressed="${st.workdays.includes(i)}">${DAY[i]}</button>`).join('')}</div>
      <label class="row" style="color:var(--text);font-size:15px"><input type="checkbox" data-change="leftover-setting" ${st.leftoverLunch ? 'checked' : ''}> Cook extra dinner for the next day’s lunchbox</label></div>
    <h2>Ask Claude</h2><div class="card tight"><form class="row" data-submit="apikey"><input name="key" type="password" autocomplete="off" placeholder="${st.apiKey ? '•••• saved – paste to replace' : 'Anthropic API key (sk-ant-…)'}" aria-label="Anthropic API key"><button>Save</button></form>
      <p class="muted">Stored only on this phone, never in backups. Create one at console.anthropic.com → API keys and set a monthly spend limit. ${st.apiKey ? '<button class="btn-ghost btn-sm btn-danger" data-act="apikey-clear">Remove key</button>' : ''}</p></div>
    <h2>Backup & partner’s phone</h2><div class="card tight"><p class="small sub" style="margin-top:0">Data lives on this phone. Export a backup now and then. To set up another phone, send the backup on WhatsApp or AirDrop and choose <i>Import → Merge</i> there.</p>
      <div class="row wrap"><button data-act="export">Export / send backup</button><label class="btn" style="margin:0;color:var(--text);font-size:15px">Import backup<input type="file" accept="application/json,.json" data-change="import" hidden></label></div></div>
    <details class="card tight" style="margin-top:14px"><summary>Install on iPhone</summary><ol class="small"><li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share → Add to Home Screen</b>.</li><li>Open it from the icon. It works offline; your data stays on the phone.</li></ol></details>
    <details class="card tight" style="margin-top:10px"><summary>Danger zone</summary><button class="btn-danger" data-act="reset-all">Erase all data on this phone</button></details>`;
}

function viewSetup() {
  const step = ui.setupStep || 1;
  const dots = [1, 2, 3].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('');
  let body = '';
  if (step === 1) {
    body = `<h1>Which meals do you eat?</h1><p class="sub">Pick meals for each day and mark veg days. You can change this any time in Settings.</p>
      <div class="card tight">${mealGrid()}</div>
      <h2>Workdays (lunchbox days)</h2><div class="chips wrap">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<button class="chip ${state.settings.workdays.includes(i) ? 'on' : ''}" data-act="workday" data-v="${i}" aria-pressed="${state.settings.workdays.includes(i)}">${DAY[i]}</button>`).join('')}</div>
      <button class="btn-primary btn-block" style="margin-top:18px" data-act="setup-next">Next</button>`;
  } else if (step === 2) {
    const ws = weekStart(), filled = weekDates(ws).reduce((n, d) => n + MEALS.filter(({ k }) => state.plan[d]?.[k]?.dishes?.length).length, 0);
    body = `<h1>Fill this week</h1><p class="sub">Auto-fill picks quick, high-protein dishes for each meal, with lunchbox-friendly lunches on workdays and portions set for each person.</p>
      ${filled ? `<div class="card accent">✓ ${plural(filled, 'meal')} planned this week. Swap anything later in Plan.</div>` : ''}
      <button class="${filled ? '' : 'btn-primary'} btn-block" style="margin-top:12px" data-act="setup-fill">✨ ${filled ? 'Fill any empty meals' : 'Auto-fill this week'}</button>
      <button class="${filled ? 'btn-primary' : 'btn-ghost'} btn-block" style="margin-top:8px" data-act="setup-next">${filled ? 'Next' : 'Skip – I’ll plan myself'}</button>`;
  } else {
    body = `<h1>You’re set 🎉</h1><p class="sub">Your grocery list and Sunday prep list are built from the plan.</p>
      <div class="menu"><button class="btn-primary" data-act="setup-done" data-h="#/prep">Open grocery list</button><button data-act="setup-done" data-h="#/plan">Review the plan</button><button class="btn-ghost" data-act="setup-done" data-h="#/">Go to Today</button></div>`;
  }
  return `<div class="setup-dots" aria-label="Step ${step} of 3">${dots}</div>${body}`;
}

function viewProfile(id) {
  const isNew = !id || id === 'new';
  const p = isNew ? (ui.newProfile ||= { id: uid('p'), name: '', sex: state.profiles.length ? 'f' : 'm', age: state.profiles.length ? 28 : 30, heightCm: '', weightKg: '', activity: 'light', goal: 'moderate', proteinPerKg: 1.4, split: { ...DEFAULT_SPLIT } }) : profileById(id);
  if (!p) return '<p>Not found.</p>';
  const first = !state.profiles.length;
  const t = p.heightCm && p.weightKg ? targets(p) : null;
  const opts = (o, v) => Object.entries(o).map(([k, x]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  return `${first ? `<h1>Welcome 👋</h1><p class="sub">Let’s set up a profile for each person you cook for. Your daily calorie and protein targets are worked out from these details.</p>` : `<a class="btn-ghost" href="#/me">‹ Me</a><h1>${isNew ? 'Add person' : 'Edit ' + esc(p.name)}</h1>`}
    <form data-submit="profile" data-id="${p.id}" data-new="${isNew ? 1 : ''}" class="card">
    <label style="margin-top:0">Name</label><input name="name" value="${esc(p.name)}" required placeholder="Name">
    <div class="grid2"><div><label>Sex</label><select name="sex" data-pfield><option value="m" ${p.sex === 'm' ? 'selected' : ''}>Male</option><option value="f" ${p.sex === 'f' ? 'selected' : ''}>Female</option></select></div>
    <div><label>Age</label><input name="age" type="number" inputmode="numeric" value="${esc(p.age)}" required data-pfield></div></div>
    <div class="grid2"><div><label>Height (cm)</label><input name="heightCm" type="number" inputmode="decimal" value="${esc(p.heightCm)}" required placeholder="e.g. 172" data-pfield></div>
    <div><label>Weight (kg)</label><input name="weightKg" type="number" step="0.1" inputmode="decimal" value="${esc(p.weightKg)}" required placeholder="e.g. 78" data-pfield></div></div>
    <label>Activity</label><select name="activity" data-pfield>${opts(ACTIVITY, p.activity)}</select>
    <label>Goal</label><select name="goal" data-pfield>${opts(GOALS, p.goal)}</select>
    <label>Protein (g per kg body weight)</label><select name="proteinPerKg" data-pfield>${[1.0, 1.2, 1.4, 1.6, 1.8, 2.0].map((v) => `<option value="${v}" ${+p.proteinPerKg === v ? 'selected' : ''}>${v.toFixed(1)}${v === 1.4 ? ' – recommended while losing fat' : v === 1.6 ? ' – if strength training' : v === 1.0 ? ' – ICMR baseline' : ''}</option>`).join('')}</select>
    <details style="margin-top:10px"><summary>Advanced: meal split & manual targets</summary>
      <div class="grid2">${MEALS.map(({ k, label }) => `<div><label>${label} %</label><input name="split_${k}" type="number" inputmode="numeric" value="${Math.round((p.split?.[k] ?? DEFAULT_SPLIT[k]) * 100)}" data-pfield></div>`).join('')}</div>
      <div class="grid2"><div><label>Calories override</label><input name="kcalOverride" type="number" inputmode="numeric" value="${esc(p.kcalOverride || '')}" placeholder="auto" data-pfield></div><div><label>Protein override (g)</label><input name="proteinOverride" type="number" inputmode="numeric" value="${esc(p.proteinOverride || '')}" placeholder="auto" data-pfield></div></div>
    </details>
    <div class="card accent" id="ptargets" style="margin-top:12px">${t ? targetsPreview(t) : 'Enter height and weight to see targets.'}</div>
    <button class="btn-primary btn-block" style="margin-top:12px">${first ? 'Save & continue' : 'Save'}</button>
    ${!isNew && state.profiles.length > 1 ? `<button type="button" class="btn-block btn-danger" style="margin-top:8px" data-act="del-profile" data-id="${p.id}">Remove ${esc(p.name)}</button>` : ''}
    </form>`;
}

const targetsPreview = (t) => `<b>${fmt(t.kcal)} kcal · ${t.p} g protein</b> per day<div class="small">Carbs ${t.c} g · fat ${t.f} g · fibre ${t.fib} g · maintenance ≈ ${fmt(t.tdee)} kcal</div>`;

function profileFromForm(form, base) {
  const fd = new FormData(form);
  const p = { ...base };
  for (const k of ['name', 'sex', 'activity', 'goal']) p[k] = (fd.get(k) || '').toString().trim() || p[k];
  for (const k of ['age', 'heightCm', 'weightKg', 'proteinPerKg']) p[k] = +fd.get(k) || p[k];
  for (const k of ['kcalOverride', 'proteinOverride']) p[k] = +fd.get(k) || undefined;
  const split = {};
  for (const { k } of MEALS) split[k] = (+fd.get('split_' + k) || 0) / 100;
  const sum = Object.values(split).reduce((a, b) => a + b, 0);
  p.split = sum > 0.5 ? Object.fromEntries(Object.entries(split).map(([k, v]) => [k, v / sum])) : { ...DEFAULT_SPLIT };
  return p;
}

// ════════════════════════ sheets ════════════════════════
// While a sheet is open the page behind is pinned in place (position: fixed is the only
// reliable way on iOS Safari), so swipes on the sheet or the dimmed backdrop can't scroll it.
let lockedY = null;
function lockScroll() {
  if (lockedY !== null) return;
  lockedY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${lockedY}px`, left: '0', right: '0', width: '100%' });
}
function unlockScroll() {
  if (lockedY === null) return;
  const y = lockedY;
  lockedY = null;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
  window.scrollTo(0, y);
}
function openSheet(kind, args = {}) { ui.sheet = { kind, ...args }; lockScroll(); renderSheet(); }
function closeSheet(rerender = true) {
  ui.sheet = null; $sheet.innerHTML = ''; unlockScroll();
  if (rerender) render();
}

/** Drag the handle (or the sheet's header area) down to dismiss, like an iOS sheet. */
function bindSheetDrag() {
  const sheet = $sheet.querySelector('.sheet');
  const handle = $sheet.querySelector('.sheet-top');
  if (!sheet || !handle) return;
  let startY = 0, dy = 0, t0 = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true; startY = e.clientY; dy = 0; t0 = performance.now();
    handle.setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    $sheet.querySelector('.sheet-bg').style.opacity = String(Math.max(0.2, 1 - dy / 400));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
    sheet.style.transition = 'transform .2s ease-out';
    if (dy > 90 || (fast && dy > 30)) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(() => closeSheet(), 180);
    } else {
      sheet.style.transform = '';
      $sheet.querySelector('.sheet-bg').style.opacity = '';
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });
function renderSheet() {
  const s = ui.sheet;
  if (!s) { $sheet.innerHTML = ''; return; }
  let body = '';
  if (s.kind === 'add-dish') body = sheetAddDish(s.date, s.meal);
  if (s.kind === 'slot') body = sheetSlot(s);
  if (s.kind === 'plan-menu') body = sheetPlanMenu();
  if (s.kind === 'filters') body = sheetFilters();
  if (s.kind === 'recipe-menu') body = sheetRecipeMenu(s);
  if (s.kind === 'plan-recipe') body = sheetPlanRecipe(s.id);
  if (s.kind === 'share') body = sheetShare(s);
  if (s.kind === 'log') body = sheetLog(s);
  if (s.kind === 'prep-info') body = sheetPrepInfo(s);
  const scroller = $sheet.querySelector('.sheet');
  const y = scroller?.scrollTop || 0;
  $sheet.innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-top"><div class="grab"></div><button class="sheet-x" data-act="sheet-close" aria-label="Close">✕</button></div>${body}</div>`;
  const ns = $sheet.querySelector('.sheet');
  if (ns && s.keepScroll) ns.scrollTop = y;
  bindSheetDrag();
}

function sheetShare(s) {
  const text = shareTextFor(s.k, s.arg);
  return `<h3>Share</h3><pre style="white-space:pre-wrap;font-size:12px;max-height:40vh;overflow:auto;background:var(--surface);padding:10px;border-radius:10px;border:1px solid var(--line)">${esc(text)}</pre>
    <div class="row wrap"><a class="btn btn-wa" href="${esc(waLink(text))}" target="_blank" rel="noopener">WhatsApp</a>${navigator.share ? '<button data-act="native-share">Share…</button>' : ''}<button data-act="copy-share">Copy text</button></div>`;
}

function sheetLog(s) {
  s.pid ||= state.profiles[0].id;
  s.mode ||= 'food';
  let body = '';
  if (s.mode === 'food') {
    body = `<label>Food</label><input list="foodlist2" data-sfield="food" value="${esc(s.food || '')}" placeholder="Search e.g. banana, peanuts" autocomplete="off">
      <datalist id="foodlist2">${FOOD_LIST.filter((f) => f.kcal > 0).map((f) => `<option value="${esc(f.name)}">`).join('')}</datalist>
      <label>Amount (grams)</label><input type="number" inputmode="decimal" data-sfield="grams" value="${esc(s.grams || '')}" placeholder="e.g. 100">`;
  } else if (s.mode === 'recipe') {
    body = `<label>Recipe</label><select data-sfield="rid"><option value="">Choose…</option>${allRecipes().map((r) => `<option value="${r.id}" ${s.rid === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <label>Servings</label><input type="number" step="0.25" inputmode="decimal" data-sfield="sv" value="${esc(s.sv || 1)}">`;
  } else {
    body = `<label>What</label><input data-sfield="qname" value="${esc(s.qname || '')}" placeholder="e.g. Masala chai, office samosa">
      <div class="grid2"><div><label>kcal</label><input type="number" inputmode="numeric" data-sfield="qk" value="${esc(s.qk || '')}"></div><div><label>Protein g</label><input type="number" inputmode="decimal" data-sfield="qp" value="${esc(s.qp || '')}"></div></div>
      <div class="chips" style="margin-top:8px">${[['Masala chai (with sugar)', 90, 3], ['Filter coffee', 80, 3], ['Samosa', 260, 4], ['Biscuits ×2', 90, 1], ['Restaurant meal', 900, 30]].map(([n, k, p]) => `<button class="chip" data-act="log-preset" data-n="${esc(n)}" data-k="${k}" data-p="${p}">${esc(n)}</button>`).join('')}</div>`;
  }
  return `<h3>Log food · today</h3><div class="chips">${state.profiles.map((p) => `<button class="chip ${s.pid === p.id ? 'on' : ''}" data-act="sheet-set" data-k="pid" data-v="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="seg" style="margin-top:6px">${[['food', 'Food item'], ['recipe', 'Recipe'], ['quick', 'Quick add']].map(([k, l]) => `<button class="${s.mode === k ? 'on' : ''}" data-act="sheet-set" data-k="mode" data-v="${k}">${l}</button>`).join('')}</div>
    ${body}<button class="btn-primary btn-block" style="margin-top:14px" data-act="log-add">Add</button>`;
}

// ════════════════════════ timers & wake lock ════════════════════════
const timers = [];
let tick = null, audio = null;
function startTimer(min, label) {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
  timers.push({ id: uid('t'), label, end: Date.now() + min * 60000, done: false });
  if (!tick) tick = setInterval(renderTimers, 1000);
  renderTimers();
  toast(`Timer set: ${min} min`);
}
function beep() {
  if (!audio) return;
  try {
    for (let i = 0; i < 3; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      const t0 = audio.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.start(t0); o.stop(t0 + 0.3);
    }
  } catch {}
  navigator.vibrate?.([300, 100, 300]);
}
function renderTimers() {
  const el = document.getElementById('timers');
  const now = Date.now();
  for (const t of timers) if (!t.done && t.end <= now) { t.done = true; beep(); t.lastBeep = now; }
  for (const t of timers) if (t.done && now - (t.lastBeep || 0) > 10000) { beep(); t.lastBeep = now; }
  el.innerHTML = timers.map((t) => {
    const left = Math.max(0, Math.round((t.end - now) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
    return `<div class="timer ${t.done ? 'done' : ''}"><span class="t">${t.done ? 'Done!' : mm + ':' + ss}</span><span class="grow small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.label)}</span>
      ${t.done ? '' : `<button data-act="timer-add" data-id="${t.id}">+1</button>`}<button data-act="timer-stop" data-id="${t.id}">${t.done ? 'OK' : '✕'}</button></div>`;
  }).join('');
  if (!timers.length && tick) { clearInterval(tick); tick = null; }
}
let wakeLock = null;
async function requestWakeLock() { try { if (!wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); } } catch {} }
function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && parseHash().parts[0] === 'cook') requestWakeLock(); });

// ════════════════════════ actions ════════════════════════
const A = {
  nav: (d) => { if (d.planWs) ui.planWeek = d.planWs; go(d.h); },
  'plan-week': (d) => { ui.planWeek = addDays(ui.planWeek, +d.d); render(); },
  'prep-week-nav': (d) => { ui.prepWeek = addDays(ui.prepWeek, +d.d); render(); },
  'prep-week': (d) => { ui.prepWeek = d.ws; ui.prepTab = 'prep'; go('#/prep'); },
  'prep-tab': (d) => { ui.prepTab = d.v; render(); },
  autofill: () => {
    autoFill(weekDates(ui.planWeek), { leftoverLunch: state.settings.leftoverLunch });
    save(); render(); toast('Week filled – tap any dish to swap it');
  },
  'clear-week': () => { if (ui.sheet) closeSheet(false); withUndo('Week cleared', () => { for (const d of weekDates(ui.planWeek)) delete state.plan[d]; }); },
  'add-dish': (d) => openSheet('add-dish', { date: d.date, meal: d.meal }),
  slot: (d) => openSheet('slot', { date: d.date, meal: d.meal }),
  'sheet-back': (d) => { ui.sheet = { kind: 'slot', date: d.date, meal: d.meal }; render(); renderSheet(); },
  'plan-day': (d) => { ui.planDay = d.d; ui.planView = 'day'; render(); },
  'plan-view': (d) => { ui.planView = d.v; render(); },
  'plan-menu': () => openSheet('plan-menu'),
  filters: () => openSheet('filters'),
  'rf-reset': () => { Object.assign(ui.rf, { cuisine: 'all', tag: 'all', diet: 'all' }); render(); if (ui.sheet) renderSheet(); },
  'recipe-menu': (d) => openSheet('recipe-menu', { id: d.id }),
  'person-toggle': (d) => { ui.todayOpen[d.pid] = !ui.todayOpen[d.pid]; render(); },
  'step-go': (d) => {
    const seq = cookSequence(d.date), i = ui.step[d.date] ?? 0, cur = seq[i];
    if (+d.d > 0 && cur) { (state.checks['cook:' + d.date] ||= {})[cur.key] = true; save(); }
    if (+d.d > 0 && i >= seq.length - 1) { toast('All done – enjoy your meal!'); go('#/cook/' + d.date); return; }
    ui.step[d.date] = Math.max(0, i + +d.d); render(); window.scrollTo(0, 0);
  },
  'setup-next': () => { ui.setupStep = (ui.setupStep || 1) + 1; render(); },
  'setup-fill': () => { autoFill(weekDates(weekStart()), { leftoverLunch: state.settings.leftoverLunch }); ui.planWeek = weekStart(); save(); render(); },
  'setup-done': (d) => { state.settings.setupDone = true; ui.prepWeek = weekStart(); ui.prepTab = 'grocery'; save(); ui.setupStep = 1; go(d.h); },
  'pick-dish': (d) => {
    const sl = slot(d.date, d.meal, true);
    if (sl.dishes.includes(d.id)) sl.dishes = sl.dishes.filter((x) => x !== d.id);
    else { sl.dishes.push(d.id); delete sl.from; }
    sl.portions = {}; // re-balance portions for the new combination
    save(); ui.sheet.keepScroll = true; renderSheet(); render();
  },
  'rm-dish': (d) => {
    const sl = slot(d.date, d.meal), name = getRecipe(sl.dishes[+d.i])?.name || 'Dish';
    withUndo(`Removed ${name}`, () => {
      sl.dishes.splice(+d.i, 1); sl.portions = {};
      if (!sl.dishes.length) delete state.plan[d.date][d.meal];
    });
  },
  leftover: (d) => {
    const prev = addDays(d.date, -1), src = slot(prev, 'd');
    const sl = slot(d.date, 'l', true);
    sl.dishes = [...src.dishes]; sl.from = prev; sl.portions = {};
    save(); render(); if (ui.sheet) renderSheet(); toast('Last night’s dinner will be cooked in a bigger batch');
  },
  portions: (d) => openSheet('slot', { date: d.date, meal: d.meal }),
  'portion-step': (d) => {
    const sl = slot(d.date, d.meal);
    const cur = portionOf(sl, d.meal, d.pid, d.date);
    sl.portions = { ...(sl.portions || {}), [d.pid]: Math.max(0, Math.min(4, cur + +d.d)) };
    save(); ui.sheet.keepScroll = true; renderSheet(); render();
  },
  'portion-auto': (d) => { slot(d.date, d.meal).portions = {}; save(); ui.sheet.keepScroll = true; renderSheet(); render(); },
  'sheet-close': () => closeSheet(),
  'sheet-set': (d) => { ui.sheet[d.k] = d.k === 'all' || d.k === 'lunchbox' ? (d.v ? true : false) : d.v; ui.sheet.keepScroll = false; renderSheet(); },
  eat: (d) => {
    const sl = slot(d.date, d.meal);
    sl.eaten = { ...(sl.eaten || {}), [d.pid]: !sl.eaten?.[d.pid] };
    save(); render(); if (ui.sheet) renderSheet();
  },
  'eat-all': (d) => {
    for (const { k } of MEALS) { const sl = slot(today(), k); if (sl?.dishes?.length) sl.eaten = { ...(sl.eaten || {}), [d.pid]: true }; }
    save(); render();
  },
  'log-open': () => openSheet('log'),
  'log-preset': (d) => { Object.assign(ui.sheet, { qname: d.n, qk: d.k, qp: d.p }); renderSheet(); },
  'log-add': () => {
    const s = ui.sheet;
    let e = null;
    if (s.mode === 'food') {
      const id = FOOD_BY_NAME.get((s.food || '').toLowerCase());
      const g = +s.grams;
      if (!id || !g) return toast('Pick a food from the list and enter grams');
      const f = FOODS[id];
      e = { id: uid('e'), name: `${f.name} ${g} g`, kcal: f.kcal * g / 100, p: f.p * g / 100, c: f.c * g / 100, f: f.f * g / 100, fib: f.fib * g / 100 };
    } else if (s.mode === 'recipe') {
      const r = getRecipe(s.rid);
      if (!r) return toast('Choose a recipe');
      const n = perServing(r), sv = +s.sv || 1;
      e = { id: uid('e'), name: `${r.name} ×${sv}`, kcal: n.kcal * sv, p: n.p * sv, c: n.c * sv, f: n.f * sv, fib: n.fib * sv };
    } else {
      if (!s.qname || !+s.qk) return toast('Enter a name and calories');
      e = { id: uid('e'), name: s.qname, kcal: +s.qk, p: +s.qp || 0, c: 0, f: 0, fib: 0 };
    }
    const d = today();
    state.log[d] ||= {}; (state.log[d][s.pid] ||= []).push(e);
    save(); closeSheet(); toast('Logged');
  },
  mode: (d) => {
    if (d.v === 'plan') { ui.planWeek = weekStart(ui.cookDate || today()); go('#/plan'); return; }
    const wk = weekDates(ui.planWeek);
    go('#/cook/' + (wk.includes(today()) ? today() : ui.cookDate && wk.includes(ui.cookDate) ? ui.cookDate : wk[0]));
  },
  'prep-info': (d) => openSheet('prep-info', { rid: d.rid, f: d.f, date: d.date }),
  grid: (d) => {
    const dm = (state.settings.dayMeals ||= defaultDayMeals());
    dm[d.day][d.meal] = CYCLE[dm[d.day][d.meal] || 'off'];
    save(); render();
  },
  'grid-preset': (d) => {
    const dm = (state.settings.dayMeals ||= defaultDayMeals());
    for (const i of Object.keys(dm)) {
      if (d.v === '2s') dm[i] = { b: 'off', l: 'nonveg', s: 'nonveg', d: 'nonveg' };
      if (d.v === '3s') dm[i] = { b: 'nonveg', l: 'nonveg', s: 'nonveg', d: 'nonveg' };
      if (d.v === 'allnv') for (const k of ['b', 'l', 's', 'd']) if (dm[i][k] === 'veg') dm[i][k] = 'nonveg';
    }
    save(); render();
  },
  'extra-del': (d) => withUndo('Item removed', () => state.extras[d.ws].splice(+d.i, 1)),
  'log-del': (d) => withUndo('Entry removed', () => state.log[today()][d.pid].splice(+d.i, 1)),
  share: (d) => { const text = shareTextFor(d.kind, d.arg); if (!text) return; window.open(waLink(text), '_blank'); },
  'share-more': (d) => openSheet('share', { k: d.kind, arg: d.arg }),
  'native-share': async () => { try { await navigator.share({ text: shareTextFor(ui.sheet.k, ui.sheet.arg) }); } catch {} },
  'copy-share': async () => { try { await navigator.clipboard.writeText(shareTextFor(ui.sheet.k, ui.sheet.arg)); toast('Copied'); } catch { toast('Copy failed – long-press the text instead'); } },
  timer: (d) => startTimer(+d.min, d.label),
  'timer-add': (d) => { const t = timers.find((x) => x.id === d.id); if (t) t.end += 60000; renderTimers(); },
  'timer-stop': (d) => { const i = timers.findIndex((x) => x.id === d.id); if (i >= 0) timers.splice(i, 1); renderTimers(); },
  'step-done': (d) => { const c = (state.checks['cook:' + d.date] ||= {}); c[d.key] = !c[d.key]; save(); render(); },
  rf: (d) => { ui.rf[d.k] = d.v; render(); if (ui.sheet?.kind === 'filters') renderSheet(); },
  fav: (d) => { const i = state.favorites.indexOf(d.id); if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(d.id); save(); render(); },
  'rp-step': (d) => { const r = getRecipe(d.id); const pp = recipePortions(r); pp[d.pid] = Math.max(0, Math.min(5, pp[d.pid] + +d.d)); render(); },
  'plan-recipe': (d) => openSheet('plan-recipe', { id: d.id }),
  'plan-recipe-go': (d) => {
    const s = ui.sheet, sl = slot(s.date, s.meal, true);
    if (!sl.dishes.includes(d.id)) { sl.dishes.push(d.id); sl.portions = {}; delete sl.from; }
    save(); closeSheet(); toast(`Added to ${MEAL_LABEL[s.meal]}, ${fmtDate(s.date)}`);
  },
  'del-recipe': (d) => {
    const name = getRecipe(d.id)?.name;
    closeSheet(false); location.hash = '#/recipes';
    withUndo(`Deleted ${name}`, () => {
      deleteRecipe(d.id);
      for (const day of Object.values(state.plan)) for (const sl of Object.values(day)) if (sl?.dishes) sl.dishes = sl.dishes.filter((x) => x !== d.id);
    });
  },
  'ing-add': () => { ui.draft.ing.push({ name: '', f: null, g: '', note: '', n: {} }); render(); setTimeout(() => document.querySelector(`[data-ing="${ui.draft.ing.length - 1}"]`)?.focus(), 0); },
  'ing-del': (d) => { ui.draft.ing.splice(+d.i, 1); render(); },
  'save-recipe': () => {
    const r = draftToRecipe(ui.draft);
    if (!r.name) return toast('Give the recipe a name');
    if (!r.ing.length) return toast('Add at least one ingredient with grams');
    upsertRecipe(r); invalidateNutrition(r);
    ui.draft = null; delete ui.recipePortions[r.id];
    go('#/recipe/' + r.id); toast('Saved');
  },
  'ai-set': (d) => { ui.ai[d.k] = d.v; render(); },
  'ai-suggest': async () => {
    const a = ui.ai; a.loading = 'suggest'; a.error = ''; render();
    try { const { suggestRecipes } = await import('./ai.js'); a.results = await suggestRecipes(a); }
    catch (e) { a.error = e.message; }
    a.loading = false; render();
  },
  'ai-import': async () => {
    const a = ui.ai;
    if (!a.importText.trim()) return toast('Paste a recipe first');
    a.loading = 'import'; a.error = ''; render();
    try { const { importRecipe } = await import('./ai.js'); a.results = await importRecipe(a.importText); }
    catch (e) { a.error = e.message; }
    a.loading = false; render();
  },
  'ai-save': (d) => { const r = ui.ai.results.find((x) => x.id === d.id); if (r) { upsertRecipe(r); render(); toast('Saved to your recipes'); } },
  'me-p': (d) => { ui.meProfile = d.id; render(); },
  workday: (d) => {
    const v = +d.v, w = state.settings.workdays;
    state.settings.workdays = w.includes(v) ? w.filter((x) => x !== v) : [...w, v];
    save(); render();
  },
  'apikey-clear': () => { state.settings.apiKey = ''; save(); render(); toast('Key removed'); },
  'weight-del': (d) => withUndo('Weight entry removed', () => { state.weights[d.pid] = (state.weights[d.pid] || []).filter((w) => w.d !== d.d); }),
  'del-profile': (d) => {
    if (!confirm('Remove this person and their logs?')) return;
    state.profiles = state.profiles.filter((p) => p.id !== d.id);
    delete state.weights[d.id];
    save(); go('#/me');
  },
  export: async () => {
    const json = exportData();
    const name = `meal-prep-backup-${today()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Meal prep backup' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  'reset-all': () => {
    if (!confirm('Erase ALL profiles, recipes, plans and logs on this phone? Export a backup first if unsure.')) return;
    localStorage.clear(); location.hash = '#/'; location.reload();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = A[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' && el.dataset.act !== 'prep-week') return; // let links navigate
  e.preventDefault();
  fn(el.dataset, el, e);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.input === 'rq') { ui.rf.q = el.value; renderRecipeList(); return; }
  if (el.dataset.input === 'sheet-q') {
    ui.sheet.q = el.value;
    const tmp = document.createElement('div'); tmp.innerHTML = sheetAddDish(ui.sheet.date, ui.sheet.meal);
    document.getElementById('sheet-list').replaceWith(tmp.querySelector('#sheet-list'));
    return;
  }
  if (el.dataset.aifield) { ui.ai[el.dataset.aifield] = el.value; return; }
  if (el.dataset.sfield && ui.sheet) { ui.sheet[el.dataset.sfield] = el.value; return; }
  if (el.dataset.field && ui.draft) {
    const f = el.dataset.field, d = ui.draft;
    if (el.type === 'checkbox') {
      if (f.startsWith('meal:')) { const k = f.slice(5); d.meals = el.checked ? [...new Set([...d.meals, k])] : d.meals.filter((x) => x !== k); }
      else if (f.startsWith('wk:')) { const k = f.slice(3); d.wk = el.checked ? [...new Set([...d.wk, k])] : d.wk.filter((x) => x !== k); }
      else d[f] = el.checked;
    } else d[f] = el.value;
    return;
  }
  if (el.dataset.ing != null && ui.draft) {
    const i = ui.draft.ing[+el.dataset.ing], k = el.dataset.k;
    if (k.startsWith('n.')) { i.n = { ...(i.n || {}), [k.slice(2)]: el.value }; }
    else if (k === 'name') {
      const wasKnown = !!i.f, hadName = !!i.name;
      i.name = el.value; i.f = FOOD_BY_NAME.get(el.value.toLowerCase()) || null;
      if (wasKnown !== !!i.f || hadName !== !!i.name || i.f) { const x = document.querySelector(`.ing-extra[data-for="${el.dataset.ing}"]`); if (x) x.innerHTML = ingExtra(i, +el.dataset.ing); }
    } else {
      i[k] = el.value;
      if (k === 'g' && i.f) { const x = document.querySelector(`.ing-extra[data-for="${el.dataset.ing}"]`); if (x) x.innerHTML = ingExtra(i, +el.dataset.ing); }
    }
    const box = document.getElementById('draft-nutr'); if (box) box.innerHTML = draftNutrition();
    return;
  }
  if (el.hasAttribute('data-pfield')) {
    const form = el.closest('form'), base = profileById(form.dataset.id) || ui.newProfile;
    const p = profileFromForm(form, base);
    const box = document.getElementById('ptargets');
    if (box && p.heightCm && p.weightKg) box.innerHTML = targetsPreview(targets(p));
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const c = el.dataset.change;
  if (el.dataset.field && el.tagName === 'SELECT' && ui.draft) { ui.draft[el.dataset.field] = el.value; return; }
  if (el.dataset.sfield && ui.sheet && el.tagName === 'SELECT') { ui.sheet[el.dataset.sfield] = el.value; return; }
  if (el.hasAttribute('data-pfield') && el.tagName === 'SELECT') { el.dispatchEvent(new Event('input', { bubbles: true })); return; }
  if (c === 'check') {
    const k = el.dataset.kind + ':' + el.dataset.ws;
    const m = (state.checks[k] ||= {});
    m[el.dataset.key] = el.checked;
    el.closest('.check-item')?.classList.toggle('done', el.checked);
    save();
    if (el.dataset.kind === 'grocery') setTimeout(render, 180); // let the tick show, then move it into "In the basket"
  }
  if (c === 'nt-check' || c === 'cook-check') {
    const k = (c === 'nt-check' ? 'nt:' : 'cook:') + el.dataset.date;
    (state.checks[k] ||= {})[el.dataset.key] = el.checked;
    el.closest('.check-item')?.classList.toggle('done', el.checked);
    save();
  }
  if (c === 'leftover-setting') { state.settings.leftoverLunch = el.checked; save(); }
  if (c === 'import') {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.profiles || !data.plan) throw new Error('Not a backup file');
      const merge = confirm('Merge this backup with the data on this phone?\n\nOK = merge (recommended)\nCancel = replace everything');
      if (merge) mergeData(data); else { if (!confirm('Replace ALL data on this phone with the backup?')) return; replaceState(data); }
      resetRecipeIndex(); toast('Imported'); render();
    } catch (err) { alert('Import failed: ' + err.message); }
    el.value = '';
  }
});

function mergeData(data) {
  for (const p of data.profiles || []) if (!profileById(p.id)) state.profiles.push(p);
  for (const r of data.customRecipes || []) { const i = state.customRecipes.findIndex((x) => x.id === r.id); if (i >= 0) state.customRecipes[i] = r; else state.customRecipes.push(r); }
  Object.assign(state.plan, data.plan || {});
  for (const [d, byP] of Object.entries(data.log || {})) { state.log[d] ||= {}; for (const [pid, arr] of Object.entries(byP)) { const have = new Set((state.log[d][pid] || []).map((e) => e.id)); state.log[d][pid] = [...(state.log[d][pid] || []), ...arr.filter((e) => !have.has(e.id))]; } }
  for (const [pid, arr] of Object.entries(data.weights || {})) { const m = new Map((state.weights[pid] || []).map((w) => [w.d, w])); for (const w of arr) m.set(w.d, w); state.weights[pid] = [...m.values()]; }
  state.favorites = [...new Set([...state.favorites, ...(data.favorites || [])])];
  Object.assign(state.extras, data.extras || {});
  save();
}

document.addEventListener('submit', (e) => {
  const f = e.target;
  const kind = f.dataset.submit;
  if (!kind) return;
  e.preventDefault();
  const fd = new FormData(f);
  if (kind === 'extra-add') {
    const v = (fd.get('item') || '').toString().trim();
    if (v) { (state.extras[f.dataset.ws] ||= []).push(v); save(); render(); }
  }
  if (kind === 'weight') {
    const kg = +fd.get('kg');
    if (!kg || kg < 25 || kg > 250) return toast('Enter weight in kg');
    const pid = f.dataset.pid, d = today();
    const arr = (state.weights[pid] ||= []).filter((w) => w.d !== d);
    arr.push({ d, kg }); state.weights[pid] = arr;
    const p = profileById(pid); p.weightKg = kg; // keep targets current
    save(); render(); toast('Weight logged – targets updated');
  }
  if (kind === 'apikey') {
    const v = (fd.get('key') || '').toString().trim();
    if (!v.startsWith('sk-')) return toast('That doesn’t look like an Anthropic key');
    state.settings.apiKey = v; save(); render(); toast('Key saved on this phone');
  }
  if (kind === 'profile') {
    const isNew = !!f.dataset.new;
    const base = isNew ? ui.newProfile : profileById(f.dataset.id);
    const p = profileFromForm(f, base);
    if (!p.name || !p.heightCm || !p.weightKg || !p.age) return toast('Fill in name, age, height and weight');
    if (isNew) {
      state.profiles.push(p);
      state.weights[p.id] = [{ d: today(), kg: p.weightKg }];
      ui.newProfile = null;
    } else Object.assign(base, p);
    save();
    if (isNew && state.profiles.length === 1) {
      if (confirm(`Saved ${p.name}. Add another person now (e.g. your wife)?`)) { render(); return; }
    }
    go(isNew && !state.settings.setupDone ? '#/setup' : state.profiles.length === 1 || isNew ? '#/' : '#/me');
  }
});

render();
