import { FOODS, CATEGORIES } from './foods.js';
import { TASKS, CHOP_TASK, RECIPES } from './recipes.js';
import { state, getRecipe, slot, profileById } from './store.js';
import { MEALS, normIng, ingFood, perServing, autoPortion, addN, fmtQty, mealTarget, dietOf } from './nutrition.js';

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
const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 864e5); // b − a, in days

// ───────── Which meals, veg or non-veg ─────────
/** 'off' | 'nonveg' | 'veg' for a meal on a date (from the weekday template). */
export const mealSetting = (date, meal) => state.settings.dayMeals?.[dow(date)]?.[meal] || 'off';

/** Meals eaten on a date: turned on in the template, or with dishes added anyway. */
export function enabledMeals(date) {
  const day = state.plan[date] || {};
  return MEALS.map((m) => m.k).filter((k) => mealSetting(date, k) !== 'off' || day[k]?.dishes?.length);
}

// ───────── Slots → cooking instances ─────────
export const slotRecipes = (sl) => (sl?.dishes || []).map(getRecipe).filter(Boolean);

/** Portion (servings) a person eats from a slot on a date. */
export function portionOf(sl, meal, pid, date) {
  const p = profileById(pid);
  if (!p || !sl) return 0;
  if (sl.portions && sl.portions[pid] != null) return sl.portions[pid];
  return autoPortion(p, meal, slotRecipes(sl), date ? enabledMeals(date) : undefined);
}

export function slotTotalServings(sl, meal, date) {
  return state.profiles.reduce((s, p) => s + portionOf(sl, meal, p.id, date), 0);
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
        const it = { date, meal, recipe: r, servings: slotTotalServings(sl, meal, date), leftovers: [] };
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
        const sv = slotTotalServings(sl, meal, date);
        const src = byKey.get(`${sl.from}|d|${id}`);
        if (src) { src.servings += sv; src.leftovers.push({ date, meal, servings: sv }); }
        else if (!inRange.has(sl.from)) {
          // Source dinner is outside this range: still count the food (e.g. for this week's groceries).
          inst.push({ date: sl.from, meal: 'd', recipe: r, servings: sv, leftovers: [], outside: true });
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

// ───────── Prep scheduling ─────────
/**
 * When a prep task must happen so it's ready to cook on date D.
 * - weekend: done in Sunday's prep session and keeps until D
 * - freeze:  done on Sunday, frozen, moved to the fridge the night before
 * - midweek: doesn't keep or freeze → done Wednesday evening (if it keeps till D) or the evening before
 */
export function schedule(def, keeps, D) {
  const ws = weekStart(D);
  const sun = addDays(ws, -1);
  const wed = addDays(ws, 2);
  let mode, R;
  if (dayDiff(sun, D) <= keeps) { mode = 'weekend'; R = sun; }
  else if (def.freeze) { mode = 'freeze'; R = sun; }
  else { mode = 'midweek'; R = D > wed && dayDiff(wed, D) <= keeps ? wed : addDays(D, -1); }
  const steps = (def.steps || [[0, '', def.t]]).map(([off, time, t]) => ({ date: addDays(R, off), time: time || (mode === 'midweek' ? 'evening' : 'Sunday prep'), t }));
  if (mode === 'freeze') {
    steps.push({ date: R, time: 'Sunday prep', t: 'Freeze this portion, labelled with the dish and day.' });
    steps.push({ date: addDays(D, -1), time: '9 pm', t: 'Move it from the freezer to the fridge to thaw overnight.' });
  }
  return { mode, R, D, steps, keeps, until: mode === 'freeze' ? null : addDays(R, keeps) };
}

const recipeFoods = (r) => new Set((r.ing || []).map((x) => normIng(x).f).filter(Boolean));

/** Prep tasks a recipe uses, with the recipe's ingredients each one covers. */
export function recipeTasks(r) {
  const has = recipeFoods(r);
  const out = [];
  for (const key of r.wk || []) {
    const def = TASKS[key];
    if (def) out.push({ key, def, keeps: def.keeps ?? 3, label: def.label, foods: (def.ing || []).filter((f) => has.has(f)) });
  }
  for (const c of r.wkCustom || []) {
    const def = { t: c.t, m: c.m || 10, freeze: !!c.freeze, label: c.label || 'prepped', steps: [[0, '', c.t]] };
    out.push({ key: 'c:' + c.t, def, keeps: c.keeps ?? 3, label: def.label, foods: (c.ing || []).filter((f) => has.has(f)) });
  }
  return out;
}

/**
 * Map foodId → how that ingredient arrives at the stove: via a prep task (masala base, sprouted…)
 * or pre-chopped. Ingredients not in the map come fresh from the grocery list / pantry.
 * With a cook date D, each entry also gets its schedule.
 */
export function ingredientPrep(r, D) {
  const map = new Map();
  for (const t of recipeTasks(r)) for (const f of t.foods) if (!map.has(f)) map.set(f, t);
  for (const raw of r.ing || []) {
    const i = normIng(raw);
    const food = FOODS[i.f];
    if (food?.chop && !r.noPrep && !map.has(i.f)) map.set(i.f, { key: 'chop', def: CHOP_TASK, keeps: food.chop, label: 'pre-chopped', foods: [i.f] });
  }
  if (D) for (const v of map.values()) v.sched = schedule(v.def, v.keeps, D);
  return map;
}

const ADJ = new Set(['sprouted', 'cleaned & cut', 'marinated', 'cleaned', 'pre-chopped', 'prepped']);
/** "masala base", "marinated chicken breast", "pre-chopped onion"… */
const SHORT = { chicken_bonein: 'chicken', chicken_breast: 'chicken breast', chicken_thigh: 'chicken thigh', chicken_mince: 'keema', moong_sprouts: 'moong', fish_seer: 'fish', fish_white: 'fish', paneer_lite: 'paneer', capsicum: 'capsicum', bell_pepper: 'bell pepper', spinach: 'spinach' };
export function prepName(v, foodId = v.foods?.[0]) {
  const food = SHORT[foodId] || FOODS[foodId]?.name.toLowerCase().replace(/ \(.*\)$/, '').replace(/ \/.*$/, '') || '';
  return ADJ.has(v.label) ? `${v.label} ${food}`.trim() : v.label;
}

/** Next planned date (today or later) for a recipe, if any. */
export function nextPlannedDate(id) {
  const t = today();
  return Object.keys(state.plan).sort().find((d) => d >= t && MEALS.some(({ k }) => state.plan[d][k]?.dishes?.includes(id)));
}

// ───────── Grocery list ─────────
export function groceryList(dates) {
  const items = new Map();
  for (const it of cookInstances(dates)) {
    const prep = ingredientPrep(it.recipe);
    for (const i of scaledIngredients(it.recipe, it.servings)) {
      const key = i.f || 'x:' + (i.name || '').toLowerCase();
      const cur = items.get(key) || { key, food: i.food, g: 0, dishes: new Set(), prep: new Set() };
      cur.g += i.g;
      cur.dishes.add(it.recipe.name);
      if (i.f && prep.has(i.f)) cur.prep.add(prep.get(i.f).label);
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

// ───────── Weekend + mid-week prep list ─────────
const fmtTime = (d, time) => `${fmtDate(d).replace(',', '')}${time && time !== 'Sunday prep' ? ' · ' + time : ''}`;

export function prepPlan(dates) {
  const groups = new Map();
  const add = (gk, base, it, foods, ings, sched) => {
    let g = groups.get(gk);
    if (!g) {
      g = { gk, R: sched.R, mode: sched.mode === 'midweek' ? 'midweek' : 'weekend', ...base, dishes: [], amounts: new Map(), freeze: [], start: null };
      groups.set(gk, g);
    }
    g.dishes.push({ name: it.recipe.name, date: it.date });
    for (const f of foods) { const i = ings.find((x) => x.f === f); if (i) g.amounts.set(f, (g.amounts.get(f) || 0) + i.g); }
    if (sched.mode === 'freeze') g.freeze.push(`${it.recipe.name} (${DAY[dow(it.date)]})`);
    const first = sched.steps[0];
    if (first && first.date < g.R && (!g.start || first.date < g.start.date)) g.start = first;
  };

  for (const it of cookInstances(dates)) {
    const r = it.recipe;
    const ings = scaledIngredients(r, it.servings);
    const tasks = recipeTasks(r);
    const covered = new Set(tasks.flatMap((t) => t.foods));
    for (const t of tasks) {
      const sched = schedule(t.def, t.keeps, it.date);
      const gk = sched.mode === 'midweek' ? `${t.key}@${sched.R}` : t.key;
      const title = t.def.title || (t.def.t.length <= 44 ? t.def.t : t.def.t.slice(0, 42).replace(/\s+\S*$/, '') + '…');
      add(gk, { key: t.key, title, t: t.def.t || t.def.steps[0][2], m: t.def.m || 10, label: t.label, freezable: !!t.def.freeze }, it, t.foods, ings, sched);
    }
    for (const i of ings) {
      if (!i.food.chop || covered.has(i.f) || r.noPrep) continue;
      const sched = schedule(CHOP_TASK, i.food.chop, it.date);
      const gk = sched.mode === 'midweek' ? `chop@${sched.R}` : 'chop';
      add(gk, { key: 'chop', title: 'Chop vegetables', t: 'Wash, dry and chop; store in airtight boxes lined with paper towel.', m: 0, label: 'pre-chopped' }, it, [i.f], ings, sched);
    }
  }

  const out = [...groups.values()].map((g) => {
    if (g.key === 'chop') g.m = 5 + g.amounts.size * 3;
    return {
      ...g,
      amountText: [...g.amounts.entries()].map(([f, gr]) => `${FOODS[f]?.name || f} ${fmtQty(f, gr)}`).join(', '),
      dishText: uniqDishes(g.dishes),
      freezeText: g.freeze.length ? `Freeze the portions for ${[...new Set(g.freeze)].join(', ')}` : '',
      startText: g.start ? `Start ${fmtTime(g.start.date, g.start.time)}: ${g.start.t}` : '',
    };
  });
  const weekend = out.filter((g) => g.mode === 'weekend').sort((a, b) => (a.start ? -1 : 0) - (b.start ? -1 : 0) || (a.key === 'chop' ? -1 : b.key === 'chop' ? 1 : 0));
  const byDay = new Map();
  for (const g of out.filter((x) => x.mode === 'midweek')) byDay.set(g.R, [...(byDay.get(g.R) || []), g]);
  const midweek = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, tasks]) => ({ date, tasks }));
  return { weekend, midweek, minutes: weekend.reduce((s, t) => s + t.m, 0), sunday: addDays(dates[0], -1) };
}

function uniqDishes(ds) {
  const seen = new Map();
  for (const d of ds) seen.set(d.name, [...(seen.get(d.name) || []), DAY[dow(d.date)]]);
  return [...seen.entries()].map(([n, days]) => `${n} (${[...new Set(days)].join(', ')})`).join('; ');
}

// ───────── Day: night-before + before-cooking + cooking ─────────
export function dayCooking(date) {
  const insts = cookInstances([date]).filter((i) => !i.outside);
  // Tomorrow's leftover lunch is cooked as part of tonight's dinner.
  const tomorrow = addDays(date, 1);
  for (const { k: meal } of MEALS) {
    const sl = slot(tomorrow, meal);
    if (!sl?.from || sl.from !== date) continue;
    for (const id of sl.dishes) {
      const src = insts.find((i) => i.meal === 'd' && i.recipe.id === id);
      const sv = slotTotalServings(sl, meal, tomorrow);
      if (src) { src.servings += sv; src.leftovers.push({ date: tomorrow, meal, servings: sv }); }
    }
  }
  const pre = [];
  for (const it of insts) for (const [t, m] of it.recipe.pre || []) pre.push({ t, m, dish: it.recipe.name, meal: it.meal });
  pre.sort((a, b) => b.m - a.m);
  return { insts, pre };
}

/** Tasks to do the evening before `date`: recipe night-before steps + thawing frozen prep + mid-week prep. */
export function nightBefore(date) {
  const out = [];
  for (const it of cookInstances([date]).filter((i) => !i.outside)) {
    for (const t of it.recipe.nt || []) out.push({ t, dish: it.recipe.name, meal: it.meal });
    for (const v of ingredientPrep(it.recipe, date).values()) {
      if (v.sched.mode === 'freeze') out.push({ t: `Thaw the ${prepName(v)}: freezer → fridge`, dish: it.recipe.name, meal: it.meal });
    }
  }
  const seen = new Set();
  return out.filter((x) => { const k = x.t + x.dish; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ───────── Nutrition per person ─────────
export function slotNutrition(sl, meal, pid, date) {
  const m = portionOf(sl, meal, pid, date);
  return slotRecipes(sl).reduce((a, r) => addN(a, perServing(r), m), { kcal: 0, p: 0, c: 0, f: 0, fib: 0 });
}

export function dayIntake(date, pid, { plannedOnly = false, eatenOnly = false } = {}) {
  let t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0 };
  const day = state.plan[date] || {};
  for (const { k } of MEALS) {
    const sl = day[k];
    if (!sl?.dishes?.length) continue;
    if (eatenOnly && !sl.eaten?.[pid]) continue;
    t = addN(t, slotNutrition(sl, k, pid, date));
  }
  if (!plannedOnly) for (const e of state.log[date]?.[pid] || []) t = addN(t, { fib: 0, ...e });
  return t;
}

// ───────── Auto-fill ─────────
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function autoFill(dates, { leftoverLunch = true } = {}) {
  const used = new Set();
  for (const d of dates) for (const m of ['b', 'l', 's', 'd']) for (const id of state.plan[d]?.[m]?.dishes || []) used.add(id);

  // Veg slots only get vegetarian dishes (no egg). Non-veg slots prefer chicken/fish/egg dishes,
  // falling back to anything when the week has used them all.
  const pick = (pred, diet) => {
    const all = shuffle([...state.customRecipes, ...RECIPES].filter((r) => pred(r) && (diet !== 'veg' || dietOf(r) === 'veg')));
    const tiers = diet === 'veg' ? [all] : [all.filter((r) => dietOf(r) !== 'veg'), all];
    for (const tier of tiers) { const fresh = tier.find((r) => !used.has(r.id)); if (fresh) { used.add(fresh.id); return fresh; } }
    return tiers.find((t) => t.length)?.[0] || null;
  };
  const proteinDense = (r) => { const n = perServing(r); return (n.p * 4) / Math.max(1, n.kcal) >= 0.2; };
  // Light dishes (a wrap, a soup) only make a full meal with a side; otherwise portions balloon to 2.5×.
  const mealSized = (r) => perServing(r).kcal >= 300 || r.pair?.length;
  const withSide = (r, meal) => {
    const ids = [r.id];
    const side = r.pair?.length ? getRecipe(r.pair[0]) : null;
    if (side && (side.cat === 'side' || perServing(r).kcal < 380)) ids.push(side.id);
    // Lean protein dish with no carbs (tikka, peri-peri, salad bowl): add phulka/rice so the meal
    // is balanced and portions don't balloon to 400+ g of meat.
    else if ((meal === 'l' || meal === 'd') && perServing(r).c < 25) ids.push(/Indian/.test(r.cuisine) ? 'phulka' : 'brown_rice');
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
    const cfg = (k) => mealSetting(date, k);

    if (cfg('b') !== 'off') {
      const b = pick((r) => r.meals?.includes('b') && r.cat === 'breakfast', cfg('b'));
      if (b) put('b', withSide(b, 'b'));
    }

    if (cfg('l') !== 'off') {
      const prev = addDays(date, -1);
      const pd = slot(prev, 'd');
      const reusable = pd?.dishes?.length && !pd.from && dates.includes(prev)
        && pd.dishes.every((id) => getRecipe(id)?.lunchbox)
        && (cfg('l') === 'veg' ? pd.dishes.every((id) => dietOf(getRecipe(id)) === 'veg') : pd.dishes.some((id) => dietOf(getRecipe(id)) !== 'veg'));
      if (work && leftoverLunch && reusable) put('l', [...pd.dishes], { from: prev });
      else {
        const base = (r) => r.meals?.includes('l') && (r.cat === 'main' || r.cat === 'salad') && (!work || r.lunchbox) && mealSized(r);
        const l = pick((r) => base(r) && proteinDense(r), cfg('l')) || pick(base, cfg('l'));
        if (l) put('l', withSide(l, 'l'));
      }
    }

    if (cfg('s') !== 'off') {
      const s = pick((r) => r.meals?.includes('s'), cfg('s'));
      if (s) put('s', [s.id]);
    }

    if (cfg('d') !== 'off') {
      const next = addDays(date, 1);
      const feedsLunch = leftoverLunch && isWorkday(next) && mealSetting(next, 'l') === cfg('d'); // same veg/non-veg choice
      const base = (r) => r.meals?.includes('d') && r.cat === 'main' && (!feedsLunch || r.lunchbox) && mealSized(r);
      const dn = pick((r) => base(r) && proteinDense(r), cfg('d')) || pick(base, cfg('d'));
      if (dn) put('d', withSide(dn, 'd'));
    }
  }
}

export { mealTarget };
