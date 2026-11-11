import { state, save, getRecipe, allRecipes, upsertRecipe, deleteRecipe, profileById, uid, slot, exportData, replaceState, resetRecipeIndex, defaultDayMeals } from './store.js';
import { FOODS, FOOD_LIST } from './foods.js';
import { TASKS } from './recipes.js';
import { MEALS, MEAL_LABEL, ACTIVITY, GOALS, DEFAULT_SPLIT, targets, perServing, autoPortion, mealTarget, normIng, ingFood, fmtQty, r0, invalidateNutrition, bmi, dietOf, DIET_ICON } from './nutrition.js';
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
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const mult = (m) => `×${+(+m).toFixed(2)}`;

function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
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
      case 'cook': html = viewCook(p1 || today()); tab = 'plan'; break;
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
  document.getElementById('tabs').classList.toggle('hidden', !state.profiles.length);
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

function weekNav(ws, act) {
  const end = addDays(ws, 6);
  const label = `${fmtDate(ws).replace(/^\w+, /, '')} – ${fmtDate(end).replace(/^\w+, /, '')}`;
  const tag = ws === weekStart() ? 'This week' : ws === addDays(weekStart(), 7) ? 'Next week' : ws === addDays(weekStart(), -7) ? 'Last week' : '';
  return `<div class="row between card tight" style="margin:8px 0 12px">
    <button class="icon-btn" data-act="${act}" data-d="-7" aria-label="Previous week">‹</button>
    <div style="text-align:center"><b>${label}</b><div class="muted">${tag}</div></div>
    <button class="icon-btn" data-act="${act}" data-d="7" aria-label="Next week">›</button></div>`;
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
function viewToday() {
  const d = today();
  const day = state.plan[d] || {};
  const hasPlan = MEALS.some(({ k }) => day[k]?.dishes?.length);
  const tomorrowNb = nightBefore(addDays(d, 1));
  const ntChecks = state.checks['nt:' + d] || {};
  const wd = new Date().getDay();
  let html = `<h1>Today</h1><p class="sub">${fmtDate(d, true)}</p>`;

  // Per-person progress
  for (const p of state.profiles) {
    const t = targets(p);
    const eaten = dayIntake(d, p.id, { eatenOnly: true });
    const planned = dayIntake(d, p.id, { plannedOnly: true });
    const left = t.kcal - eaten.kcal;
    html += `<div class="card"><div class="row between"><div class="row">${pDot(p)}<b>${esc(p.name)}</b></div>
      <span class="small ${left < 0 ? '' : 'sub'}">${left >= 0 ? `${fmt(left)} kcal left` : `${fmt(-left)} kcal over`}</span></div>
      ${meter('Calories', eaten.kcal, t.kcal, '')}${meter('Protein', eaten.p, t.p, 'g')}${meter('Fibre', eaten.fib, t.fib, 'g')}
      <div class="row between" style="margin-top:8px"><span class="muted">Planned today: ${macroLine(planned)}</span>
      ${hasPlan ? `<button class="btn-ghost btn-sm" data-act="eat-all" data-pid="${p.id}">Mark all eaten</button>` : ''}</div></div>`;
  }

  if (wd === 6 || wd === 0) {
    const ws = addDays(weekStart(), 7);
    const pp = prepPlan(weekDates(ws));
    html += `<a class="card accent row between" href="#/prep" data-act="prep-week" data-ws="${ws}" style="text-decoration:none;color:inherit;margin-top:10px">
      <div><b>🧺 Weekend prep for next week</b><div class="small sub">${pp.weekend.length ? `${plural(pp.weekend.length, 'task')} · about ${pp.minutes} min` : 'Plan next week first to get your prep list'}</div></div><span>›</span></a>`;
  }

  html += `<div class="row between"><h2>Meals</h2>${hasPlan ? `<a class="btn btn-sm btn-primary" href="#/cook/${d}">👩‍🍳 Cook mode</a>` : ''}</div>`;
  if (!hasPlan) {
    html += `<div class="card empty"><div class="big">🍽️</div><p>Nothing planned for today.</p><a class="btn btn-primary" href="#/plan">Plan your week</a></div>`;
  } else {
    for (const { k, label, icon } of MEALS) {
      const sl = day[k];
      if (!sl?.dishes?.length) continue;
      const names = slotRecipes(sl).map((r) => `<a href="#/recipe/${r.id}">${esc(r.name)}</a>`).join(' + ');
      html += `<div class="card"><div class="row between"><b>${icon} ${label}</b>${sl.from ? '<span class="tag green">leftovers – just pack</span>' : ''}</div>
        <p class="small">${names}</p><div class="row wrap">`;
      for (const p of state.profiles) {
        const n = slotNutrition(sl, k, p.id, d);
        const on = !!sl.eaten?.[p.id];
        html += `<button class="chip ${on ? 'on' : ''}" data-act="eat" data-date="${d}" data-meal="${k}" data-pid="${p.id}">${on ? '✓' : '○'} ${esc(p.name)} ${mult(portionOf(sl, k, p.id, d))} · ${fmt(n.kcal)} kcal · ${r0(n.p)} g P</button>`;
      }
      html += '</div></div>';
    }
  }

  // Extra food log
  html += `<div class="row between"><h2>Extra food</h2><button class="btn-sm" data-act="log-open">+ Log food</button></div>`;
  const extras = state.profiles.flatMap((p) => (state.log[d]?.[p.id] || []).map((e, i) => ({ p, e, i })));
  html += extras.length
    ? `<div class="card"><ul class="list">${extras.map(({ p, e, i }) => `<li class="row">${pDot(p)}<div class="grow"><div>${esc(e.name)}</div><div class="muted">${fmt(e.kcal)} kcal · ${r0(e.p)} g P</div></div><button class="btn-ghost btn-sm btn-danger" data-act="log-del" data-pid="${p.id}" data-i="${i}" aria-label="Remove">✕</button></li>`).join('')}</ul></div>`
    : `<p class="muted">Snacks, tea, eating out – log anything that wasn’t in the plan.</p>`;

  if (tomorrowNb.length) {
    html += `<h2>Tonight, for tomorrow</h2><div class="card"><ul class="list">${tomorrowNb.map((t, i) => {
      const key = i + ':' + t.t;
      return `<li><label class="check-item ${ntChecks[key] ? 'done' : ''}" style="margin:0;color:inherit;font-size:15px"><input type="checkbox" data-change="nt-check" data-date="${d}" data-key="${esc(key)}" ${ntChecks[key] ? 'checked' : ''}><span class="ci-text">${esc(t.t)}<br><span class="muted">${esc(t.dish)} · ${MEAL_LABEL[t.meal]}</span></span></label></li>`;
    }).join('')}</ul></div>`;
  }
  return html;
}

// ════════════════════════ PLAN ════════════════════════
function modeToggle(mode) {
  return `<div class="seg mode-toggle" role="tablist"><button role="tab" class="${mode === 'plan' ? 'on' : ''}" data-act="mode" data-v="plan" aria-selected="${mode === 'plan'}">🗓️ Plan</button><button role="tab" class="${mode === 'cook' ? 'on' : ''}" data-act="mode" data-v="cook" aria-selected="${mode === 'cook'}">👩‍🍳 Cook</button></div>`;
}

function viewPlan() {
  const ws = ui.planWeek;
  const dates = weekDates(ws);
  let html = `${modeToggle('plan')}<h1>Meal plan</h1>${weekNav(ws, 'plan-week')}
    ${mealGrid()}
    <div class="row wrap" style="margin-top:10px"><button class="btn-primary" data-act="autofill">✨ Auto-fill empty meals</button><button data-act="share" data-kind="week" data-arg="${ws}">Share week</button><button class="btn-ghost btn-danger" data-act="clear-week">Clear</button></div>`;
  for (const d of dates) {
    const work = isWorkday(d);
    html += `<div class="card day" style="margin-top:12px"><div class="day-head"><b class="${d === today() ? 'today' : ''}">${fmtDate(d)}${d === today() ? ' · today' : ''}</b>
      <span class="row">${work ? '<span class="tag">🍱 workday</span>' : '<span class="tag green">weekend</span>'}<a class="btn-ghost btn-sm" href="#/cook/${d}">Cook ›</a></span></div>`;
    for (const { k, label } of MEALS) {
      const sl = slot(d, k);
      const rs = slotRecipes(sl);
      const set = mealSetting(d, k);
      if (set === 'off' && !rs.length) {
        html += `<div class="slot skipped"><div class="slot-label">${label}</div><div class="row between"><span class="muted">skipped</span><button class="btn-ghost btn-sm" data-act="add-dish" data-date="${d}" data-meal="${k}">+ add anyway</button></div></div>`;
        continue;
      }
      const mismatch = set === 'veg' && rs.some((r) => dietOf(r) !== 'veg');
      html += `<div class="slot"><div class="slot-label">${label}<br><span title="${set === 'veg' ? 'Veg' : set === 'nonveg' ? 'Non-veg' : 'Extra'}">${set === 'off' ? '➕' : DIET_ICON[set]}</span></div><div>`;
      html += rs.map((r, i) => `<span class="dish"><span data-act="nav" data-h="#/recipe/${r.id}">${DIET_ICON[dietOf(r)]} ${esc(r.name)}</span><button data-act="rm-dish" data-date="${d}" data-meal="${k}" data-i="${i}" aria-label="Remove ${esc(r.name)}">×</button></span>`).join('');
      html += `<button class="btn-sm" data-act="add-dish" data-date="${d}" data-meal="${k}">+ Add</button>`;
      const prev = slot(addDays(d, -1), 'd');
      if (k === 'l' && !rs.length && prev?.dishes?.length && !prev.from) html += ` <button class="btn-sm btn-ghost" data-act="leftover" data-date="${d}">↺ Last night’s leftovers</button>`;
      if (sl?.from) html += ` <span class="tag green">leftovers from ${DAY[dow(sl.from)]} dinner</span>`;
      if (mismatch) html += ` <span class="tag warn">non-veg dish on a veg meal</span>`;
      if (rs.length) {
        html += `<div class="portions">${state.profiles.map((p) => `<button data-act="portions" data-date="${d}" data-meal="${k}">${pDot(p)} ${esc(p.name)} ${mult(portionOf(sl, k, p.id, d))}</button>`).join('')}</div>`;
      }
      html += `</div></div>`;
    }
    const sums = state.profiles.map((p) => {
      const t = targets(p), n = dayIntake(d, p.id, { plannedOnly: true });
      if (!n.kcal) return '';
      const off = n.kcal - t.kcal;
      return `<div class="row small">${pDot(p)}<span class="grow">${esc(p.name)}</span><span class="num ${Math.abs(off) > t.kcal * 0.1 ? '' : 'sub'}">${fmt(n.kcal)}/${fmt(t.kcal)} kcal · ${r0(n.p)}/${t.p} g P</span></div>`;
    }).join('');
    if (sums.trim()) html += `<div style="border-top:1px solid var(--line);padding-top:8px;margin-top:4px">${sums}</div>`;
    html += `</div>`;
  }
  return html;
}

const CYCLE = { off: 'nonveg', nonveg: 'veg', veg: 'off' };
const CELL = { off: '—', nonveg: '🍗', veg: '🥦' };
function mealGrid() {
  const dm = state.settings.dayMeals || defaultDayMeals();
  const days = [1, 2, 3, 4, 5, 6, 0];
  const count = (i) => ['b', 'l', 'd'].filter((k) => dm[i]?.[k] !== 'off').length;
  const summary = [...new Set(days.map((i) => `${count(i)} meals${dm[i]?.s !== 'off' ? ' + snack' : ''}`))].join(' / ');
  return `<details class="card tight" ${ui.gridOpen ? 'open' : ''} data-toggle="grid"><summary><b>Meals per day</b> · ${esc(summary)}</summary>
    <p class="muted" style="margin:4px 0 8px">Tap a cell to cycle: 🍗 non-veg → 🥦 veg → — skip. Auto-fill and portions follow this. Veg means no meat, fish or egg.</p>
    <table class="tbl meal-grid"><tr><th></th>${['Bkfst', 'Lunch', 'Snack', 'Dinner'].map((l) => `<th>${l}</th>`).join('')}</tr>
    ${days.map((i) => `<tr><td>${DAY[i]}</td>${MEALS.map(({ k }) => { const v = dm[i]?.[k] || 'off'; return `<td><button class="cell ${v}" data-act="grid" data-day="${i}" data-meal="${k}" aria-label="${DAY[i]} ${MEAL_LABEL[k]}: ${v}">${CELL[v]}</button></td>`; }).join('')}</tr>`).join('')}</table>
    <div class="row wrap" style="margin-top:8px"><button class="btn-sm" data-act="grid-preset" data-v="2s">2 meals + snack</button><button class="btn-sm" data-act="grid-preset" data-v="3s">3 meals + snack</button><button class="btn-sm" data-act="grid-preset" data-v="allnv">All non-veg</button></div></details>`;
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
  return `<h3>Add to ${MEAL_LABEL[meal]} · ${fmtDate(date)}</h3>
    <input type="search" placeholder="Search recipes…" value="${esc(s.q || '')}" data-input="sheet-q" autocomplete="off">
    <div class="chips" style="margin-top:8px">
      <button class="chip ${!s.all ? 'on' : ''}" data-act="sheet-set" data-k="all" data-v="">${MEAL_LABEL[meal]} dishes</button>
      <button class="chip ${s.all ? 'on' : ''}" data-act="sheet-set" data-k="all" data-v="1">All dishes</button>
      ${work ? `<button class="chip ${s.lunchbox !== false ? 'on' : ''}" data-act="sheet-set" data-k="lunchbox" data-v="${s.lunchbox === false ? '1' : ''}">🍱 Lunchbox only</button>` : ''}
    </div>
    <div class="chips">${[['any', 'Veg + non-veg'], ['nonveg', '🍗 Non-veg'], ['veg', '🥦 Veg only']].map(([k, l]) => `<button class="chip ${s.diet === k ? 'on' : ''}" data-act="sheet-set" data-k="diet" data-v="${k}">${l}</button>`).join('')}</div>
    <ul class="list" id="sheet-list">${list.map((r) => {
      const n = perServing(r), added = cur.includes(r.id);
      return `<li class="row"><span style="font-size:22px">${emoji(r)}</span><div class="grow"><div>${DIET_ICON[dietOf(r)]} ${esc(r.name)}</div><div class="macros">${macroLine(n)} /serving · ${active(r)} min${r.lunchbox ? ' · 🍱' : ''}</div></div>
        <button class="btn-sm ${added ? '' : 'btn-primary'}" data-act="pick-dish" data-date="${date}" data-meal="${meal}" data-id="${r.id}">${added ? 'Added ✓' : 'Add'}</button></li>`;
    }).join('') || '<li class="muted">No matches.</li>'}</ul>
    <button class="btn-block" data-act="sheet-close" style="margin-top:10px">Done</button>`;
}

function sheetPortions(date, meal) {
  const sl = slot(date, meal);
  if (!sl) return '';
  const rs = slotRecipes(sl);
  let html = `<h3>Portions · ${MEAL_LABEL[meal]} · ${fmtDate(date)}</h3><p class="small sub">${rs.map((r) => esc(r.name)).join(' + ')}</p>
    <p class="muted">×1 = ${rs.map((r) => `${r.unit ? `${r.unit[0]} ${esc(r.unit[1])}` : '1 serving'} ${esc(r.name.toLowerCase())}`).join(' + ')}</p>`;
  for (const p of state.profiles) {
    const m = portionOf(sl, meal, p.id, date);
    const n = slotNutrition(sl, meal, p.id, date);
    const mt = mealTarget(p, meal, enabledMeals(date));
    const isAuto = sl.portions?.[p.id] == null;
    html += `<div class="card"><div class="row between"><div class="row">${pDot(p)}<b>${esc(p.name)}</b>${isAuto ? '<span class="tag">auto</span>' : ''}</div>
      <div class="stepper"><button data-act="portion-step" data-date="${date}" data-meal="${meal}" data-pid="${p.id}" data-d="-0.25" aria-label="Less">−</button><span class="v">${mult(m)}</span><button data-act="portion-step" data-date="${date}" data-meal="${meal}" data-pid="${p.id}" data-d="0.25" aria-label="More">+</button></div></div>
      <div class="muted" style="margin-top:6px">${macroLine(n)} · meal target ≈ ${fmt(mt.kcal)} kcal · ${r0(mt.p)} g P</div></div>`;
  }
  html += `<div class="row" style="margin-top:12px"><button class="grow" data-act="portion-auto" data-date="${date}" data-meal="${meal}">Reset to auto</button><button class="grow btn-primary" data-act="sheet-close">Done</button></div>`;
  return html;
}

// ════════════════════════ PREP ════════════════════════
function viewPrep() {
  const ws = ui.prepWeek;
  const dates = weekDates(ws);
  let html = `<h1>Prep & shop</h1>${weekNav(ws, 'prep-week-nav')}
    <div class="seg"><button class="${ui.prepTab === 'grocery' ? 'on' : ''}" data-act="prep-tab" data-v="grocery">🛒 Grocery</button><button class="${ui.prepTab === 'prep' ? 'on' : ''}" data-act="prep-tab" data-v="prep">🔪 Weekend prep</button><button class="${ui.prepTab === 'cook' ? 'on' : ''}" data-act="prep-tab" data-v="cook">👩‍🍳 Cook</button></div>`;
  const anyPlan = dates.some((d) => MEALS.some(({ k }) => state.plan[d]?.[k]?.dishes?.length));
  if (!anyPlan) return html + `<div class="card empty" style="margin-top:12px"><div class="big">🗓️</div><p>No meals planned for this week yet.</p><button class="btn-primary" data-act="nav" data-h="#/plan" data-plan-ws="${ws}">Plan this week</button></div>`;

  if (ui.prepTab === 'grocery') {
    const checks = state.checks['grocery:' + ws] || {};
    const { groups, pantry } = groceryList(dates);
    const extras = state.extras[ws] || [];
    const total = groups.reduce((s, g) => s + g.items.length, 0) + extras.length;
    const done = groups.reduce((s, g) => s + g.items.filter((i) => checks[i.key]).length, 0) + extras.filter((e) => checks['x:' + e]).length;
    html += `<p class="sub" style="margin-top:12px">${done}/${total} items in the basket. Quantities include every portion in the plan.</p>`;
    for (const g of groups) {
      html += `<h2>${g.label}</h2><div class="card tight"><ul class="list">${g.items.map((i) => checkRow('grocery', ws, i.key, `<b>${esc(i.food.name)}</b> <span class="sub">– ${esc(i.qty)}</span>${i.prep.size ? ` <span class="ptag prepped" style="cursor:default">🧺 ${esc([...i.prep].join(', '))}</span>` : ''}`, esc([...i.dishes].join(', ')))).join('')}</ul></div>`;
    }
    html += `<h2>Also buy</h2><div class="card tight"><ul class="list">${extras.map((e, idx) => checkRow('grocery', ws, 'x:' + e, esc(e), '', `<button class="btn-ghost btn-sm btn-danger" data-act="extra-del" data-ws="${ws}" data-i="${idx}" aria-label="Remove">✕</button>`)).join('')}
      <li><form class="row" data-submit="extra-add" data-ws="${ws}"><input name="item" placeholder="e.g. tea, dish soap" autocomplete="off"><button class="btn-sm">Add</button></form></li></ul></div>`;
    if (pantry.length) html += `<details class="card tight" style="margin-top:10px"><summary>Pantry check (${pantry.length} staples)</summary><ul class="list">${pantry.map((i) => checkRow('grocery', ws, i.key, esc(i.food.name), esc(i.qty) + ' this week')).join('')}</ul></details>`;
    html += shareButtons('grocery', ws);
  } else if (ui.prepTab === 'prep') {
    const { weekend, midweek, minutes, sunday } = prepPlan(dates);
    const row = (t) => checkRow('prep', ws, t.gk, `<b>${esc(t.t)}</b> <span class="tag">${t.m} min</span>`,
      [t.startText && '⏰ ' + t.startText, t.amountText && '📦 ' + t.amountText, t.dishText && 'For: ' + t.dishText, t.freezeText && '❄️ ' + t.freezeText].filter(Boolean).map(esc).join('<br>'));
    html += `<div class="card accent" style="margin-top:12px"><b>Sunday prep (${fmtDate(sunday)}) · about ${minutes} min</b><p class="small">Weekday cooking then fits in 15–20 min a meal. Each task is done once for all the dishes that need it. ⏰ marks tasks that need starting earlier (soaking, sprouting).</p></div>`;
    html += weekend.length ? `<div class="card tight" style="margin-top:10px"><ul class="list">${weekend.map(row).join('')}</ul></div>` : '<p class="muted">Nothing to prep ahead.</p>';
    if (midweek.length) html += `<h2>Mid-week prep</h2><p class="small sub" style="margin-top:-4px">These don’t keep or freeze well, so they’re done closer to the day.</p>`;
    for (const day of midweek) html += `<h3 style="margin-top:14px">${fmtDate(day.date)}</h3><div class="card tight"><ul class="list">${day.tasks.map(row).join('')}</ul></div>`;
    html += shareButtons('prep', ws);
  } else {
    html += `<div class="card tight" style="margin-top:12px"><ul class="list">${dates.map((d) => {
      const has = MEALS.some(({ k }) => state.plan[d]?.[k]?.dishes?.length);
      const { insts, pre } = dayCooking(d);
      const mins = insts.reduce((s, i) => s + active(i.recipe), 0);
      return `<li class="row"><div class="grow"><b>${fmtDate(d)}</b><div class="muted">${has ? `${plural(insts.length, 'dish')} to cook · ~${mins} min hands-on${pre.length ? ` · ${plural(pre.length, 'pre-step')}` : ''}` : 'Nothing planned'}</div></div>${has ? `<a class="btn btn-sm" href="#/cook/${d}">Open ›</a>` : ''}</li>`;
    }).join('')}</ul></div>`;
  }
  return html;
}

function checkRow(kind, ws, key, main, sub = '', extra = '') {
  const on = !!(state.checks[kind + ':' + ws] || {})[key];
  return `<li><div class="check-item ${on ? 'done' : ''}"><input type="checkbox" aria-label="Done" data-change="check" data-kind="${kind}" data-ws="${ws}" data-key="${esc(key)}" ${on ? 'checked' : ''}><div class="ci-text">${main}${sub ? `<div class="muted">${sub}</div>` : ''}</div>${extra}</div></li>`;
}

// ════════════════════════ COOK ════════════════════════
function viewCook(date) {
  const { insts, pre } = dayCooking(date);
  const checks = state.checks['cook:' + date] || {};
  const nb = nightBefore(addDays(date, 1));
  ui.cookDate = date;
  const wk = weekDates(weekStart(date));
  let html = `${modeToggle('cook')}<div class="chips" style="margin:8px 0 4px">${wk.map((d) => `<a class="chip ${d === date ? 'on' : ''}" href="#/cook/${d}" style="text-decoration:none">${DAY[dow(d)]} ${d.slice(8).replace(/^0/, '')}${d === today() ? ' •' : ''}</a>`).join('')}</div>
    <div class="row between"><button class="icon-btn" data-act="nav" data-h="#/cook/${addDays(date, -1)}" aria-label="Previous day">‹</button>
    <div style="text-align:center"><h1 style="margin:0">Cook</h1><div class="sub">${fmtDate(date, true)}</div></div>
    <button class="icon-btn" data-act="nav" data-h="#/cook/${addDays(date, 1)}" aria-label="Next day">›</button></div>`;
  const left = MEALS.filter(({ k }) => slot(date, k)?.from && slot(date, k).dishes.length);
  if (left.length) html += `<div class="card accent" style="margin-top:12px">${left.map(({ k }) => `<b>${MEAL_LABEL[k]}:</b> pack leftovers – ${slotRecipes(slot(date, k)).map((r) => esc(r.name)).join(' + ')}`).join('<br>')}</div>`;
  if (!insts.length) return html + `<div class="card empty" style="margin-top:12px"><div class="big">🧑‍🍳</div><p>Nothing to cook on this day.</p><a class="btn" href="#/plan">Open plan</a></div>`;

  if (pre.length) {
    html += `<h2>Before you start</h2><div class="card tight"><ul class="list">${pre.map((p, i) => {
      const key = 'pre:' + i;
      return `<li><div class="check-item ${checks[key] ? 'done' : ''}"><input type="checkbox" data-change="cook-check" data-date="${date}" data-key="${key}" ${checks[key] ? 'checked' : ''}><div class="ci-text"><b>${p.m} min before:</b> ${esc(p.t)}<div class="muted">${esc(p.dish)} · ${MEAL_LABEL[p.meal]}</div></div>
        <button class="btn-sm" data-act="timer" data-min="${p.m}" data-label="${esc(p.t)}">⏱ ${p.m}</button></div></li>`;
    }).join('')}</ul></div>`;
  }

  for (const { k, label, icon } of MEALS) {
    const list = insts.filter((i) => i.meal === k);
    if (!list.length) continue;
    const sl = slot(date, k);
    html += `<h2>${icon} ${label}</h2>`;
    if (sl) html += `<p class="small sub">Serve: ${state.profiles.map((p) => `${esc(p.name)} ${mult(portionOf(sl, k, p.id, date))}`).join(' · ')}</p>`;
    for (const it of list) {
      const r = it.recipe;
      html += `<div class="card"><div class="row between"><h3 style="margin:0"><a href="#/recipe/${r.id}" style="color:inherit">${esc(r.name)}</a></h3><span class="tag">${active(r)} min</span></div>
        <p class="small sub">Cook <b>${+it.servings.toFixed(2)} servings</b>${it.leftovers.length ? ` <span class="tag green">incl. ${it.leftovers.map((l) => `${DAY[dow(l.date)]} ${MEAL_LABEL[l.meal].toLowerCase()}`).join(', ')}</span>` : ''}</p>
        <details open><summary>Ingredients</summary>${ingList(r, it.servings, date, true)}</details>
        <div style="margin-top:6px">${(r.steps || []).map((s, n) => {
          const [t, m] = Array.isArray(s) ? s : [s, 0];
          const key = `${k}|${r.id}|${n}`;
          return `<div class="step ${checks[key] ? 'done' : ''}"><span class="n" data-act="step-done" data-date="${date}" data-key="${esc(key)}" role="button" aria-label="Mark step done">${checks[key] ? '✓' : n + 1}</span><div>${esc(t)}${m ? ` <button class="btn-sm" data-act="timer" data-min="${m}" data-label="${esc(r.name)}: ${esc(t.slice(0, 40))}">⏱ ${m} min</button>` : ''}</div></div>`;
        }).join('')}</div></div>`;
    }
  }
  if (nb.length) html += `<h2>Tonight, for tomorrow</h2><div class="card"><ul class="list">${nb.map((t) => `<li>☐ ${esc(t.t)} <span class="muted">· ${esc(t.dish)}</span></li>`).join('')}</ul></div>`;
  html += shareButtons('cook', date);
  return html;
}

// ════════════════════════ INGREDIENT LISTS ════════════════════════
/** Ingredient rows labelled 🧺 prepped (tap for timing) or 🛒 fresh from the grocery list / pantry. */
function ingList(r, servings, date, small = false) {
  const prep = ingredientPrep(r, date);
  return `<ul class="list ${small ? 'small' : ''}">${scaledIngredients(r, servings).map((i) => {
    const v = i.f && prep.get(i.f);
    const tag = v
      ? `<button class="ptag prepped" data-act="prep-info" data-rid="${r.id}" data-f="${i.f}" data-date="${date}">🧺 ${esc(prepName(v, i.f))} ›</button>`
      : `<span class="ptag fresh">🛒 ${i.food.pantry ? 'pantry' : 'fresh'}</span>`;
    return `<li class="row between" style="align-items:flex-start"><div class="grow"><div>${esc(i.food.name)}${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ''}</div>${tag}</div><b class="nowrap">${esc(i.qty)}</b></li>`;
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
    ${t ? `<p class="muted">Hands-on time ~${t.m} min. It also covers other dishes that use it this week (see Prep → Weekend prep).</p>` : ''}
    <button class="btn-block" data-act="sheet-close" style="margin-top:8px">Close</button>`;
}

// ════════════════════════ RECIPES ════════════════════════
function viewRecipes() {
  const f = ui.rf;
  const chip = (k, v, l) => `<button class="chip ${f[k] === v ? 'on' : ''}" data-act="rf" data-k="${k}" data-v="${v}">${l}</button>`;
  return `<div class="row between"><h1>Recipes</h1><div class="row"><a class="btn btn-sm" href="#/ai">✨ Ask Claude</a><a class="btn btn-sm btn-primary" href="#/edit/new">+ New</a></div></div>
    <input type="search" placeholder="Search ${allRecipes().length} recipes…" value="${esc(f.q)}" data-input="rq" autocomplete="off" style="margin:8px 0">
    <div class="chips">${chip('meal', 'all', 'All meals')}${chip('meal', 'b', 'Breakfast')}${chip('meal', 'l', 'Lunch')}${chip('meal', 'd', 'Dinner')}${chip('meal', 's', 'Snack')}</div>
    <div class="chips">${chip('cuisine', 'all', 'Any cuisine')}${chip('cuisine', 'North Indian', 'North Indian')}${chip('cuisine', 'South Indian', 'South Indian')}${chip('cuisine', 'Indian', 'Indian')}${chip('cuisine', 'Asian', 'Asian')}${chip('cuisine', 'Continental', 'Continental')}</div>
    <div class="chips">${chip('tag', 'all', 'Everything')}${chip('tag', 'lunchbox', '🍱 Lunchbox')}${chip('tag', 'protein', '💪 30 g+ protein')}${chip('tag', 'soup', '🥣 Soups')}${chip('tag', 'salad', '🥗 Salads')}${chip('tag', 'fav', '⭐ Favourites')}${chip('tag', 'mine', '✍️ Mine')}</div>
    <div class="chips">${chip('diet', 'all', 'Veg + non-veg')}${chip('diet', 'nonveg', '🍗 Non-veg')}${chip('diet', 'veg', '🥦 Veg')}</div>
    <div id="rlist"></div>`;
}

function renderRecipeList() {
  const el = document.getElementById('rlist');
  if (!el) return;
  const f = ui.rf, q = f.q.toLowerCase();
  const list = allRecipes().filter((r) => {
    if (f.meal !== 'all' && !r.meals?.includes(f.meal)) return false;
    if (f.cuisine !== 'all' && r.cuisine !== f.cuisine) return false;
    if (f.tag === 'lunchbox' && !r.lunchbox) return false;
    if (f.tag === 'protein' && perServing(r).p < 30) return false;
    if (f.tag === 'soup' && r.cat !== 'soup') return false;
    if (f.tag === 'salad' && r.cat !== 'salad') return false;
    if (f.tag === 'fav' && !state.favorites.includes(r.id)) return false;
    if (f.tag === 'mine' && !r.custom) return false;
    if (f.diet === 'veg' && dietOf(r) !== 'veg') return false;
    if (f.diet === 'nonveg' && dietOf(r) === 'veg') return false;
    if (q && !(r.name + ' ' + r.cuisine + ' ' + (r.ing || []).map((i) => ingFood(normIng(i)).name).join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
  el.innerHTML = list.length
    ? list.map((r) => {
      const n = perServing(r);
      return `<a class="card rcard" href="#/recipe/${r.id}" style="text-decoration:none;color:inherit"><div class="emoji">${emoji(r)}</div><div class="grow"><h3>${esc(r.name)}${state.favorites.includes(r.id) ? ' ⭐' : ''}</h3>
        <div class="macros">${macroLine(n)} · ${active(r)} min</div><div class="muted">${DIET_ICON[dietOf(r)]} ${esc(r.cuisine)}${r.lunchbox ? ' · 🍱 lunchbox' : ''}${r.custom ? ' · mine' : ''}</div></div><span class="muted">›</span></a>`;
    }).join('')
    : `<div class="empty"><p>No recipes match.</p></div>`;
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
  let html = `<div class="row between"><a class="btn-ghost" href="#/recipes">‹ Recipes</a><button class="btn-ghost" data-act="fav" data-id="${r.id}" aria-label="Favourite">${fav ? '⭐' : '☆'}</button></div>
    <h1>${esc(r.name)}</h1><div class="row wrap"><span class="tag">${DIET_ICON[dietOf(r)]} ${{ veg: 'veg', egg: 'egg', nonveg: 'non-veg' }[dietOf(r)]}</span><span class="tag">${esc(r.cuisine)}</span><span class="tag">${esc(r.cat)}</span><span class="tag">⏱ ${r.prep} + ${r.cook} min</span>${r.lunchbox ? '<span class="tag green">🍱 lunchbox</span>' : ''}${r.custom ? '<span class="tag">mine</span>' : ''}</div>
    ${r.why ? `<p class="small sub">${esc(r.why)}</p>` : ''}
    <div class="card" style="margin-top:12px"><div class="muted">Per serving${r.unit ? ` (${r.unit[0]} ${esc(r.unit[1])})` : ''}</div>
      <div class="stats" style="margin-top:6px"><div class="stat"><b>${fmt(n.kcal)}</b><span>kcal</span></div><div class="stat"><b>${r0(n.p)} g</b><span>protein</span></div><div class="stat"><b>${r0(n.c)} g</b><span>carbs</span></div><div class="stat"><b>${r0(n.f)} g</b><span>fat</span></div></div>
      <div class="muted" style="margin-top:6px">Fibre ${r0(n.fib)} g · ${r0((n.p * 4 / Math.max(1, n.kcal)) * 100)}% of calories from protein</div></div>
    <h2>Portions</h2><div class="card">`;
  for (const p of state.profiles) {
    html += `<div class="row between" style="padding:4px 0"><div class="row">${pDot(p)}${esc(p.name)}</div><div class="row"><span class="muted">${fmt(n.kcal * pp[p.id])} kcal · ${r0(n.p * pp[p.id])} g P</span>
      <div class="stepper"><button data-act="rp-step" data-id="${r.id}" data-pid="${p.id}" data-d="-0.25" aria-label="Less">−</button><span class="v">${mult(pp[p.id])}</span><button data-act="rp-step" data-id="${r.id}" data-pid="${p.id}" data-d="0.25" aria-label="More">+</button></div></div></div>`;
  }
  const side = withPair(r)[1];
  html += `<div class="muted" style="margin-top:6px">${side ? `Portions assume it’s served with ${esc(side.name.toLowerCase())}. ` : ''}Cooking ${+total.toFixed(2)} servings in total${r.unit ? ` ≈ ${+(total * r.unit[0]).toFixed(1)} ${esc(r.unit[1])}` : ''}.</div></div>`;

  const planned = nextPlannedDate(r.id);
  const cookDate = planned || addDays(today(), 1);
  html += `<h2>Ingredients</h2><p class="muted" style="margin-top:-4px">🧺 = prepped ahead (tap for when) · 🛒 = fresh from the grocery list. Timing shown for ${planned ? 'its next planned day' : 'cooking tomorrow'}, ${fmtDate(cookDate)}.</p><div class="card tight">${ingList(r, total, cookDate)}</div>`;

  const wk = [...(r.wk || []).map((k) => TASKS[k] && `${TASKS[k].t} <span class="tag">${TASKS[k].m} min</span>`).filter(Boolean), ...(r.wkCustom || []).map((c) => `${esc(c.t)} <span class="tag">${c.m} min</span>`)];
  if (wk.length || r.nt?.length || r.pre?.length) {
    html += `<h2>Time plan</h2><div class="card">`;
    if (wk.length) html += `<b class="small">🧺 Weekend prep</b><ul class="small">${wk.map((t) => `<li>${t}</li>`).join('')}</ul>`;
    if (r.nt?.length) html += `<b class="small">🌙 Night before</b><ul class="small">${r.nt.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    if (r.pre?.length) html += `<b class="small">⏰ Before you start cooking</b><ul class="small">${r.pre.map(([t, m]) => `<li><b>${m} min before:</b> ${esc(t)}</li>`).join('')}</ul>`;
    html += `</div>`;
  }
  html += `<h2>Steps</h2><div class="card">${(r.steps || []).map((s, i) => {
    const [t, m] = Array.isArray(s) ? s : [s, 0];
    return `<div class="step"><span class="n">${i + 1}</span><div>${esc(t)}${m ? ` <button class="btn-sm" data-act="timer" data-min="${m}" data-label="${esc(r.name)}">⏱ ${m} min</button>` : ''}</div></div>`;
  }).join('')}</div>`;
  if (r.pair?.length) html += `<p class="small sub" style="margin-top:10px">Goes well with: ${r.pair.map((id) => getRecipe(id)).filter(Boolean).map((x) => `<a href="#/recipe/${x.id}">${esc(x.name)}</a>`).join(', ')}</p>`;

  html += `<div class="row wrap" style="margin-top:14px"><button class="btn-primary" data-act="plan-recipe" data-id="${r.id}">+ Add to plan</button>
    <button class="btn-wa" data-act="share" data-kind="recipe" data-arg="${r.id}">WhatsApp</button><button data-act="share-more" data-kind="recipe" data-arg="${r.id}">Share…</button></div>
    <div class="row wrap" style="margin-top:8px">${r.custom ? `<a class="btn btn-sm" href="#/edit/${r.id}">Edit</a><button class="btn-sm btn-danger" data-act="del-recipe" data-id="${r.id}">Delete</button>` : `<a class="btn btn-sm" href="#/edit/new?from=${r.id}">Copy & edit</a>`}</div>`;
  return html;
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
    <p class="muted">${slotRecipes(slot(s.date, s.meal)).length ? 'Already in this slot: ' + slotRecipes(slot(s.date, s.meal)).map((x) => esc(x.name)).join(', ') : 'Slot is empty.'}</p>
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
    why: r.why || '', source: r.source,
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
    why: d.why, source: d.source, custom: true,
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
  let html = `<h1>Me</h1><div class="chips">${state.profiles.map((x) => `<button class="chip ${x.id === p.id ? 'on' : ''}" data-act="me-p" data-id="${x.id}">${esc(x.name)}</button>`).join('')}<a class="chip" href="#/profile/new">+ Person</a></div>`;
  html += `<div class="card"><div class="row between"><b>${pDot(p)} ${esc(p.name)}’s daily targets</b><a class="btn-ghost btn-sm" href="#/profile/${p.id}">Edit</a></div>
    <div class="stats" style="margin-top:8px"><div class="stat"><b>${fmt(t.kcal)}</b><span>kcal</span></div><div class="stat"><b>${t.p} g</b><span>protein</span></div><div class="stat"><b>${t.c} g</b><span>carbs</span></div><div class="stat"><b>${t.f} g</b><span>fat</span></div></div>
    <p class="muted" style="margin-top:8px">Fibre ${t.fib} g · BMR ${fmt(t.bmr)} · maintenance ≈ ${fmt(t.tdee)} kcal · ${esc(GOALS[p.goal]?.label || '')} · BMI ${bmi(p).toFixed(1)}</p></div>`;

  // last 7 days
  const days = Array.from({ length: 7 }, (_, i) => addDays(d, i - 6));
  const rows = days.map((x) => ({ x, n: dayIntake(x, p.id, { eatenOnly: true }) }));
  const logged = rows.filter((r) => r.n.kcal > 0);
  const avgK = logged.length ? logged.reduce((s, r) => s + r.n.kcal, 0) / logged.length : 0;
  const avgP = logged.length ? logged.reduce((s, r) => s + r.n.p, 0) / logged.length : 0;
  html += `<h2>Last 7 days</h2><div class="card">`;
  if (logged.length) {
    html += `<div class="row between small"><span>Calories eaten per day</span><span class="muted">dashed line = target</span></div>
      ${barChart(rows.map((r) => ({ x: r.x, y: r.n.kcal, target: t.kcal })), { label: 'Calories per day' })}
      <p class="small">Average on logged days: <b>${fmt(avgK)} kcal</b> (target ${fmt(t.kcal)}) · <b>${r0(avgP)} g protein</b> (target ${t.p} g)</p>
      <details><summary>Table</summary><table class="tbl"><tr><th>Day</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr>${rows.map((r) => `<tr><td>${fmtDate(r.x)}</td><td>${fmt(r.n.kcal)}</td><td>${r0(r.n.p)} g</td><td>${r0(r.n.c)} g</td><td>${r0(r.n.f)} g</td></tr>`).join('')}</table></details>`;
  } else html += `<p class="muted">Tick meals as eaten on the Today screen to see your trend here.</p>`;
  html += `</div>`;

  // weight
  const ws = [...(state.weights[p.id] || [])].sort((a, b) => a.d.localeCompare(b.d));
  const first = ws[0], last = ws[ws.length - 1];
  html += `<h2>Weight</h2><div class="card"><form class="row" data-submit="weight" data-pid="${p.id}"><input name="kg" type="number" step="0.1" inputmode="decimal" placeholder="Today’s weight (kg)" required><button class="btn-primary">Log</button></form>`;
  if (ws.length >= 2) html += `<p class="small" style="margin-top:10px">${last.kg} kg now · <b>${(last.kg - first.kg > 0 ? '+' : '') + (last.kg - first.kg).toFixed(1)} kg</b> since ${fmtDate(first.d)}</p>${lineChart(ws.map((w) => ({ x: w.d, y: w.kg })), { label: 'Weight' })}`;
  else if (ws.length) html += `<p class="muted" style="margin-top:8px">${last.kg} kg on ${fmtDate(last.d)}. Log weekly (same time, morning) to see a trend.</p>`;
  if (ws.length) html += `<details><summary>History</summary><ul class="list small">${ws.slice().reverse().map((w) => `<li class="row between"><span>${fmtDate(w.d)}</span><span>${w.kg} kg <button class="btn-ghost btn-sm btn-danger" data-act="weight-del" data-pid="${p.id}" data-d="${w.d}" aria-label="Delete">✕</button></span></li>`).join('')}</ul></details>`;
  html += `</div>`;

  // settings
  const st = state.settings;
  html += `<h2>Settings</h2><div class="card"><label style="margin-top:0">Workdays (lunchbox days)</label><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<button class="chip ${st.workdays.includes(i) ? 'on' : ''}" data-act="workday" data-v="${i}">${DAY[i]}</button>`).join('')}</div>
    <label class="row" style="color:var(--text);font-size:15px"><input type="checkbox" data-change="leftover-setting" ${st.leftoverLunch ? 'checked' : ''}> Auto-fill: cook extra dinner for next day’s lunchbox</label>
    <hr><label style="margin-top:0">Anthropic API key (for ✨ Ask Claude)</label>
    <form class="row" data-submit="apikey"><input name="key" type="password" autocomplete="off" placeholder="${st.apiKey ? '•••• saved – paste to replace' : 'sk-ant-…'}"><button>Save</button></form>
    <p class="muted">Stored only on this phone, never in backups. Get one at console.anthropic.com → API keys, and set a monthly spend limit there. ${st.apiKey ? '<button class="btn-ghost btn-sm btn-danger" data-act="apikey-clear">Remove key</button>' : ''}</p>
    <hr><b>Backup & share with your partner</b>
    <p class="small sub">Data lives on this phone. Export a backup now and then. To set up another phone, send the backup on WhatsApp or AirDrop and choose <i>Import → Merge</i> there.</p>
    <div class="row wrap"><button data-act="export">⬆️ Export / send backup</button><label class="btn" style="margin:0;color:var(--text);font-size:15px">⬇️ Import<input type="file" accept="application/json,.json" data-change="import" hidden></label></div>
    <hr><details><summary>Install on iPhone</summary><ol class="small"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button → <b>Add to Home Screen</b>.</li><li>Open it from the home screen icon. It works offline, and your data stays on the phone.</li></ol></details>
    <details><summary>Danger zone</summary><button class="btn-danger" data-act="reset-all">Erase all data on this phone</button></details></div>
    <p class="muted" style="margin:16px 0">Nutrition values are estimates from IFCT/USDA data, so they can be off by about 10–15%. Ask a doctor or dietitian about medical conditions.</p>`;
  return html;
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
  if (s.kind === 'portions') body = sheetPortions(s.date, s.meal);
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
  'clear-week': () => {
    if (!confirm('Remove all meals from this week?')) return;
    for (const d of weekDates(ui.planWeek)) delete state.plan[d];
    save(); render();
  },
  'add-dish': (d) => openSheet('add-dish', { date: d.date, meal: d.meal }),
  'pick-dish': (d) => {
    const sl = slot(d.date, d.meal, true);
    if (sl.dishes.includes(d.id)) sl.dishes = sl.dishes.filter((x) => x !== d.id);
    else { sl.dishes.push(d.id); delete sl.from; }
    sl.portions = {}; // re-balance portions for the new combination
    save(); ui.sheet.keepScroll = true; renderSheet();
  },
  'rm-dish': (d) => {
    const sl = slot(d.date, d.meal);
    sl.dishes.splice(+d.i, 1); sl.portions = {};
    if (!sl.dishes.length) { delete state.plan[d.date][d.meal]; }
    save(); render();
  },
  leftover: (d) => {
    const prev = addDays(d.date, -1), src = slot(prev, 'd');
    const sl = slot(d.date, 'l', true);
    sl.dishes = [...src.dishes]; sl.from = prev; sl.portions = {};
    save(); render(); toast('Dinner will be cooked in a bigger batch for this lunch');
  },
  portions: (d) => openSheet('portions', { date: d.date, meal: d.meal }),
  'portion-step': (d) => {
    const sl = slot(d.date, d.meal);
    const cur = portionOf(sl, d.meal, d.pid, d.date);
    sl.portions = { ...(sl.portions || {}), [d.pid]: Math.max(0, Math.min(4, cur + +d.d)) };
    save(); renderSheet();
  },
  'portion-auto': (d) => { slot(d.date, d.meal).portions = {}; save(); renderSheet(); },
  'sheet-close': () => closeSheet(),
  'sheet-set': (d) => { ui.sheet[d.k] = d.k === 'all' || d.k === 'lunchbox' ? (d.v ? true : false) : d.v; ui.sheet.keepScroll = false; renderSheet(); },
  eat: (d) => {
    const sl = slot(d.date, d.meal);
    sl.eaten = { ...(sl.eaten || {}), [d.pid]: !sl.eaten?.[d.pid] };
    save(); render();
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
    ui.gridOpen = true; save(); render();
  },
  'grid-preset': (d) => {
    const dm = (state.settings.dayMeals ||= defaultDayMeals());
    for (const i of Object.keys(dm)) {
      if (d.v === '2s') dm[i] = { b: 'off', l: 'nonveg', s: 'nonveg', d: 'nonveg' };
      if (d.v === '3s') dm[i] = { b: 'nonveg', l: 'nonveg', s: 'nonveg', d: 'nonveg' };
      if (d.v === 'allnv') for (const k of ['b', 'l', 's', 'd']) if (dm[i][k] === 'veg') dm[i][k] = 'nonveg';
    }
    ui.gridOpen = true; save(); render();
  },
  'extra-del': (d) => { state.extras[d.ws].splice(+d.i, 1); save(); render(); },
  'log-del': (d) => { state.log[today()][d.pid].splice(+d.i, 1); save(); render(); },
  share: (d) => { const text = shareTextFor(d.kind, d.arg); if (!text) return; window.open(waLink(text), '_blank'); },
  'share-more': (d) => openSheet('share', { k: d.kind, arg: d.arg }),
  'native-share': async () => { try { await navigator.share({ text: shareTextFor(ui.sheet.k, ui.sheet.arg) }); } catch {} },
  'copy-share': async () => { try { await navigator.clipboard.writeText(shareTextFor(ui.sheet.k, ui.sheet.arg)); toast('Copied'); } catch { toast('Copy failed – long-press the text instead'); } },
  timer: (d) => startTimer(+d.min, d.label),
  'timer-add': (d) => { const t = timers.find((x) => x.id === d.id); if (t) t.end += 60000; renderTimers(); },
  'timer-stop': (d) => { const i = timers.findIndex((x) => x.id === d.id); if (i >= 0) timers.splice(i, 1); renderTimers(); },
  'step-done': (d) => { const c = (state.checks['cook:' + d.date] ||= {}); c[d.key] = !c[d.key]; save(); render(); },
  rf: (d) => { ui.rf[d.k] = d.v; render(); },
  fav: (d) => { const i = state.favorites.indexOf(d.id); if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(d.id); save(); render(); },
  'rp-step': (d) => { const r = getRecipe(d.id); const pp = recipePortions(r); pp[d.pid] = Math.max(0, Math.min(5, pp[d.pid] + +d.d)); render(); },
  'plan-recipe': (d) => openSheet('plan-recipe', { id: d.id }),
  'plan-recipe-go': (d) => {
    const s = ui.sheet, sl = slot(s.date, s.meal, true);
    if (!sl.dishes.includes(d.id)) { sl.dishes.push(d.id); sl.portions = {}; delete sl.from; }
    save(); closeSheet(); toast(`Added to ${MEAL_LABEL[s.meal]}, ${fmtDate(s.date)}`);
  },
  'del-recipe': (d) => {
    if (!confirm('Delete this recipe? It will also be removed from your plan.')) return;
    deleteRecipe(d.id);
    for (const day of Object.values(state.plan)) for (const sl of Object.values(day)) if (sl?.dishes) sl.dishes = sl.dishes.filter((x) => x !== d.id);
    save(); go('#/recipes');
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
  'weight-del': (d) => { state.weights[d.pid] = (state.weights[d.pid] || []).filter((w) => w.d !== d.d); save(); render(); },
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

document.addEventListener('toggle', (e) => { if (e.target.dataset?.toggle === 'grid') ui.gridOpen = e.target.open; }, true);

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
    if (el.dataset.kind === 'grocery') { const p = document.querySelector('main p.sub'); if (p) { const all = document.querySelectorAll('main input[data-kind="grocery"]'); const done = [...all].filter((x) => x.checked).length; p.textContent = p.textContent.replace(/^\d+\/\d+/, `${done}/${all.length}`); } }
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
    go(state.profiles.length === 1 || isNew ? '#/' : '#/me');
  }
});

render();
