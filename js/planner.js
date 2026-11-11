import { FOODS, CATEGORIES } from './foods.js';
import { TASKS, RECIPES } from './recipes.js';
import { state, getRecipe, slot, profileById } from './store.js';
import { MEALS, normIng, ingFood, perServing, autoPortion, addN, fmtQty, mealTarget } from './nutrition.js';

// ───────── Dates (local time) ─────────
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export function weekStart(s = today()) { const d = parse(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d); }
export const weekDates = (ws) => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
export const dow = (s) => parse(s).getDay(); // 0 = Sun
export const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDate = (s, long) => parse(s).toLocaleDateString('en-IN', long ? { weekday: 'long', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' });
export const isWorkday = (s) => state.settings.workdays.includes(dow(s));

// ───────── Slots → cooking instances ─────────
export const slotRecipes = (sl) => (sl?.dishes || []).map(getRecipe).filter(Boolean);

/** Portion (servings) a person eats from a slot. */
export function portionOf(sl, meal, pid) {
  const p = profileById(pid);
  if (!p) return 0;
  if (sl.portions && sl.portions[pid] != null) return sl.portions[pid];
  return autoPortion(p, meal, slotRecipes(sl));
}

export function slotTotalServings(sl, meal) {
  return state.profiles.reduce((s, p) => s + portionOf(sl, meal, p.id), 0);
}

/**
 * Everything that needs cooking within the given dates. Leftover slots (sl.from = source date)
 * are folded into the dinner they come from, so the dinner is cooked once in a bigger batch.
 */
export function cookInstances(dates) {
  const inst = [];
  const byKey = new Map();
  const inRange = new Set(dates);
  for (const date of dates) {
    for (const { k: meal } of MEALS) {
      const sl = slot(date, meal);
      if (!sl || !sl.dishes?.length || sl.from) continue;
      for (const id of sl.dishes) {
        const r = getRecipe(id);
        if (!r) continue;
        const it = { date, meal, recipe: r, servings: slotTotalServings(sl, meal), leftovers: [] };
        inst.push(it);
        byKey.set(`${date}|${meal}|${id}`, it);
      }
    }
  }
  for (const date of dates) {
    for (const { k: meal } of MEALS) {
      const sl = slot(date, meal);
      if (!sl || !sl.from) continue;
      for (const id of sl.dishes) {
        const r = getRecipe(id);
        if (!r) continue;
        const sv = slotTotalServings(sl, meal);
        const src = byKey.get(`${sl.from}|d|${id}`);
        if (src) { src.servings += sv; src.leftovers.push({ date, meal, servings: sv }); }
        else if (!inRange.has(sl.from)) {
          // Source dinner is outside this range: still count the food (e.g. for this week's groceries).
          inst.push({ date, meal, recipe: r, servings: sv, leftovers: [], outside: true });
        }
      }
    }
  }
  return inst;
}

/** Scaled ingredient list for one instance. */
export function scaledIngredients(recipe, servings) {
  const k = servings / (recipe.serves || 1);
  return (recipe.ing || []).map((raw) => {
    const i = normIng(raw);
    const food = ingFood(i);
    return { ...i, food, g: i.g * k, qty: fmtQty(i.f, i.g * k, food) };
  });
}

// ───────── Grocery list ─────────
export function groceryList(dates) {
  const items = new Map();
  for (const it of cookInstances(dates)) {
    for (const i of scaledIngredients(it.recipe, it.servings)) {
      const key = i.f || 'x:' + (i.name || '').toLowerCase();
      const cur = items.get(key) || { key, food: i.food, g: 0, dishes: new Set() };
      cur.g += i.g;
      cur.dishes.add(it.recipe.name);
      items.set(key, cur);
    }
  }
  const groups = {};
  const pantry = [];
  for (const it of items.values()) {
    it.qty = fmtQty(it.food.id, it.g, it.food);
    if (it.food.pantry) { pantry.push(it); continue; }
    const cat = it.food.cat || 'other';
    (groups[cat] = groups[cat] || []).push(it);
  }
  const ordered = Object.keys(CATEGORIES)
    .filter((c) => groups[c])
    .map((c) => ({ cat: c, label: CATEGORIES[c], items: groups[c].sort((a, b) => a.food.name.localeCompare(b.food.name)) }));
  pantry.sort((a, b) => a.food.name.localeCompare(b.food.name));
  return { groups: ordered, pantry };
}

// ───────── Weekend prep ─────────
const SPLIT_DOW = 3; // chopped veg for dishes up to Wednesday on the weekend; the rest mid-week

export function prepPlan(dates) {
  const insts = cookInstances(dates);
  const tasks = new Map();
  const chopEarly = new Map();
  const chopLate = new Map();
  const custom = [];

  for (const it of insts) {
    const r = it.recipe;
    const covered = new Set();
    for (const key of r.wk || []) {
      const def = TASKS[key];
      if (!def) continue;
      const t = tasks.get(key) || { key, t: def.t, m: def.m, dishes: [], amounts: new Map() };
      t.dishes.push({ name: r.name, date: it.date });
      for (const i of scaledIngredients(r, it.servings)) {
        if (def.ing?.includes(i.f)) {
          t.amounts.set(i.f, (t.amounts.get(i.f) || 0) + i.g);
          covered.add(i.f);
        }
      }
      tasks.set(key, t);
    }
    for (const c of r.wkCustom || []) custom.push({ key: 'c:' + r.id + ':' + c.t, t: c.t, m: c.m || 10, dishes: [{ name: r.name, date: it.date }] });

    // Chop-ahead vegetables (not already handled by a batch task like masala base).
    const late = (dow(it.date) || 7) > SPLIT_DOW;
    for (const i of scaledIngredients(r, it.servings)) {
      if (!i.food.chop || covered.has(i.f)) continue;
      const bucket = late ? chopLate : chopEarly;
      const cur = bucket.get(i.f) || { food: i.food, g: 0, dishes: new Set() };
      cur.g += i.g;
      cur.dishes.add(r.name);
      bucket.set(i.f, cur);
    }
  }

  const list = [...tasks.values()].map((t) => ({
    ...t,
    amountText: [...t.amounts.entries()].map(([f, g]) => `${FOODS[f]?.name || f} ${fmtQty(f, g)}`).join(', '),
    dishText: uniqDishes(t.dishes),
  }));
  const chop = (m) => [...m.values()].map((c) => ({ ...c, qty: fmtQty(c.food.id, c.g, c.food) }));
  const early = chop(chopEarly), lateList = chop(chopLate);
  if (early.length) list.unshift({ key: 'chop-early', t: 'Wash, chop & store veg for Mon–Wed in airtight boxes lined with paper towel.', m: 10 + early.length * 3, amountText: early.map((c) => `${c.food.name} ${c.qty}`).join(', '), dishText: '' });
  const mid = lateList.length ? { key: 'chop-late', t: 'Wednesday night: chop veg for Thu–Sun (keeps it fresh).', m: 8 + lateList.length * 3, amountText: lateList.map((c) => `${c.food.name} ${c.qty}`).join(', '), dishText: '' } : null;
  const dedup = new Map(custom.map((c) => [c.key, c]));
  for (const c of dedup.values()) list.push({ ...c, amountText: '', dishText: uniqDishes(c.dishes) });
  const minutes = list.reduce((s, t) => s + t.m, 0);
  return { tasks: list, midweek: mid, minutes };
}

function uniqDishes(ds) {
  const seen = new Map();
  for (const d of ds) seen.set(d.name, [...(seen.get(d.name) || []), DAY[dow(d.date)]]);
  return [...seen.entries()].map(([n, days]) => `${n} (${[...new Set(days)].join(', ')})`).join('; ');
}

// ───────── Day: night-before + before-cooking + cooking ─────────
export function dayCooking(date) {
  const insts = cookInstances([date]).filter((i) => !i.outside);
  // leftovers cooked today for tomorrow
  const tomorrow = addDays(date, 1);
  for (const { k: meal } of MEALS) {
    const sl = slot(tomorrow, meal);
    if (!sl?.from || sl.from !== date) continue;
    for (const id of sl.dishes) {
      const src = insts.find((i) => i.meal === 'd' && i.recipe.id === id);
      const sv = slotTotalServings(sl, meal);
      if (src) { src.servings += sv; src.leftovers.push({ date: tomorrow, meal, servings: sv }); }
    }
  }
  const pre = [];
  for (const it of insts) for (const [t, m] of it.recipe.pre || []) pre.push({ t, m, dish: it.recipe.name, meal: it.meal });
  pre.sort((a, b) => b.m - a.m);
  return { insts, pre };
}

export function nightBefore(date) {
  const out = [];
  for (const it of cookInstances([date]).filter((i) => !i.outside)) {
    for (const t of it.recipe.nt || []) out.push({ t, dish: it.recipe.name, meal: it.meal });
  }
  return out;
}

// ───────── Nutrition per person ─────────
export function slotNutrition(sl, meal, pid) {
  const m = portionOf(sl, meal, pid);
  return slotRecipes(sl).reduce((a, r) => addN(a, perServing(r), m), { kcal: 0, p: 0, c: 0, f: 0, fib: 0 });
}

export function dayIntake(date, pid, { plannedOnly = false, eatenOnly = false } = {}) {
  let t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0 };
  const day = state.plan[date] || {};
  for (const { k } of MEALS) {
    const sl = day[k];
    if (!sl?.dishes?.length) continue;
    if (eatenOnly && !sl.eaten?.[pid]) continue;
    t = addN(t, slotNutrition(sl, k, pid));
  }
  if (!plannedOnly) for (const e of state.log[date]?.[pid] || []) t = addN(t, { fib: 0, ...e });
  return t;
}

// ───────── Auto-fill ─────────
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function autoFill(dates, { leftoverLunch = true, snacks = true } = {}) {
  const pool = (pred) => shuffle([...state.customRecipes, ...RECIPES].filter(pred));
  const used = new Set();
  for (const d of dates) for (const m of ['b', 'l', 's', 'd']) for (const id of state.plan[d]?.[m]?.dishes || []) used.add(id);

  const pick = (cands) => {
    const fresh = cands.filter((r) => !used.has(r.id));
    const r = (fresh.length ? fresh : cands)[0];
    if (r) used.add(r.id);
    return r;
  };
  const proteinDense = (r) => { const n = perServing(r); return n.p * 4 / Math.max(1, n.kcal) >= 0.2; };
  const withSide = (r) => {
    const ids = [r.id];
    const side = r.pair?.length ? getRecipe(r.pair[0]) : null;
    if (side && (side.cat === 'side' || perServing(r).kcal < 380)) ids.push(side.id);
    return ids;
  };

  for (const date of dates) {
    const work = isWorkday(date);
    const put = (meal, ids, extra = {}) => {
      const sl = slot(date, meal, true);
      if (sl.dishes.length) return false;
      sl.dishes = ids; sl.portions = {}; sl.eaten = {}; Object.assign(sl, extra);
      return true;
    };
    const b = pick(pool((r) => r.meals?.includes('b') && r.cat === 'breakfast'));
    if (b) put('b', withSide(b));

    // Lunch: leftovers from yesterday's dinner if allowed, else a lunchbox main.
    const prev = addDays(date, -1);
    const prevDinner = slot(prev, 'd');
    const prevLunchbox = prevDinner?.dishes?.length && !prevDinner.from && prevDinner.dishes.every((id) => getRecipe(id)?.lunchbox);
    if (work && leftoverLunch && prevLunchbox && dates.includes(prev)) {
      put('l', [...prevDinner.dishes], { from: prev });
    } else {
      const l = pick(pool((r) => r.meals?.includes('l') && (r.cat === 'main' || r.cat === 'salad') && (!work || r.lunchbox) && proteinDense(r)));
      if (l) put('l', withSide(l));
    }
    if (snacks) { const s = pick(pool((r) => r.meals?.includes('s'))); if (s) put('s', [s.id]); }
    const dn = pick(pool((r) => r.meals?.includes('d') && r.cat === 'main' && proteinDense(r) && (!leftoverLunch || !isWorkday(addDays(date, 1)) || r.lunchbox)));
    if (dn) put('d', withSide(dn));
  }
}

// ───────── Day plan summary vs target ─────────
export function dayPlanSummary(date) {
  return state.profiles.map((p) => ({ p, t: dayIntake(date, p.id, { plannedOnly: true }) }));
}

export { mealTarget };
