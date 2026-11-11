import { FOODS } from './foods.js';

export const MEALS = [
  { k: 'b', label: 'Breakfast', icon: '🌅' },
  { k: 'l', label: 'Lunch', icon: '🍱' },
  { k: 's', label: 'Snack', icon: '🍎' },
  { k: 'd', label: 'Dinner', icon: '🌙' },
];
export const MEAL_LABEL = Object.fromEntries(MEALS.map((m) => [m.k, m.label]));

export const ACTIVITY = {
  sedentary: { f: 1.2, label: 'Sedentary – desk job, little exercise' },
  light: { f: 1.375, label: 'Light – walks / exercise 1–3 days a week' },
  moderate: { f: 1.55, label: 'Moderate – exercise 3–5 days a week' },
  active: { f: 1.725, label: 'Very active – hard exercise 6–7 days' },
};

export const GOALS = {
  maintain: { d: 0, label: 'Maintain weight' },
  mild: { d: 250, label: 'Mild deficit (−250 kcal/day, ~0.25 kg/week)' },
  moderate: { d: 400, label: 'Moderate deficit (−400 kcal/day, ~0.4 kg/week)' },
  strong: { d: 550, label: 'Stronger deficit (−550 kcal/day, ~0.5 kg/week)' },
};

export const DEFAULT_SPLIT = { b: 0.25, l: 0.35, s: 0.1, d: 0.3 };

const ZERO = () => ({ kcal: 0, p: 0, c: 0, f: 0, fib: 0 });

export function addN(a, b, k = 1) {
  return { kcal: a.kcal + b.kcal * k, p: a.p + b.p * k, c: a.c + b.c * k, f: a.f + b.f * k, fib: a.fib + b.fib * k };
}

/** Normalise an ingredient (array form in the library, object form in custom recipes). */
export function normIng(x) {
  if (Array.isArray(x)) return { f: x[0], g: x[1], note: x[2] || '' };
  return { f: x.f || null, g: Number(x.g) || 0, note: x.note || '', name: x.name, n: x.n };
}

export function ingFood(i) {
  if (i.f && FOODS[i.f]) return FOODS[i.f];
  const n = i.n || {};
  return { id: null, name: i.name || 'Ingredient', cat: 'other', kcal: +n.kcal || 0, p: +n.p || 0, c: +n.c || 0, f: +n.f || 0, fib: +n.fib || 0 };
}

const cache = new WeakMap();
/** Nutrition for ONE serving of a recipe. */
export function perServing(recipe) {
  if (!recipe) return ZERO();
  if (cache.has(recipe)) return cache.get(recipe);
  let t = ZERO();
  for (const raw of recipe.ing || []) {
    const i = normIng(raw);
    const food = ingFood(i);
    t = addN(t, food, i.g / 100);
  }
  const s = Math.max(1, recipe.serves || 1);
  const r = { kcal: t.kcal / s, p: t.p / s, c: t.c / s, f: t.f / s, fib: t.fib / s };
  cache.set(recipe, r);
  return r;
}
export function invalidateNutrition(recipe) { cache.delete(recipe); }

export function bmi(p) {
  const h = (p.heightCm || 0) / 100;
  return h ? p.weightKg / (h * h) : 0;
}

/** Daily targets for a profile. */
export function targets(p) {
  const w = +p.weightKg || 60, h = +p.heightCm || 165, a = +p.age || 30;
  const bmr = 10 * w + 6.25 * h - 5 * a + (p.sex === 'f' ? -161 : 5);
  const tdee = bmr * (ACTIVITY[p.activity]?.f || 1.375);
  const deficit = GOALS[p.goal]?.d ?? 400;
  const floor = p.sex === 'f' ? 1200 : 1500;
  let kcal = Math.max(floor, Math.round((tdee - deficit) / 10) * 10);
  if (p.kcalOverride) kcal = +p.kcalOverride;
  // Protein on a reference weight (caps at BMI 25 so overweight bodies aren't over-targeted).
  const refW = Math.min(w, 25 * (h / 100) ** 2);
  let protein = Math.round(refW * (+p.proteinPerKg || 1.4));
  if (p.proteinOverride) protein = +p.proteinOverride;
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const fib = Math.round((kcal / 1000) * 14);
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, p: protein, f: fat, c: carbs, fib };
}

export function mealTarget(profile, meal) {
  const split = { ...DEFAULT_SPLIT, ...(profile.split || {}) };
  const t = targets(profile);
  return { kcal: t.kcal * split[meal], p: t.p * split[meal] };
}

/** Suggested portion multiplier (servings) for a person, given the dishes in a meal slot. */
export function autoPortion(profile, meal, recipes) {
  const kcal = recipes.reduce((s, r) => s + perServing(r).kcal, 0);
  if (!kcal) return 1;
  const m = mealTarget(profile, meal).kcal / kcal;
  return Math.min(meal === 's' ? 2 : 2.5, Math.max(0.5, Math.round(m * 4) / 4));
}

// ───────── Quantity formatting ─────────
const FRAC = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.33: '⅓', 0.67: '⅔' };
export function niceNum(x) {
  if (x >= 10) return String(Math.round(x));
  const whole = Math.floor(x);
  const rem = x - whole;
  const q = Math.round(rem * 4) / 4;
  if (q === 1) return String(whole + 1);
  if (q === 0) return whole ? String(whole) : (x > 0 ? '¼' : '0');
  return (whole ? whole : '') + FRAC[q];
}

export function roundG(g) {
  if (g >= 100) return Math.round(g / 10) * 10;
  if (g >= 20) return Math.round(g / 5) * 5;
  if (g >= 5) return Math.round(g);
  return Math.round(g * 2) / 2;
}

const pluralize = (w) => (w === 'medium' ? w : w === 'leaf' ? 'leaves' : w.endsWith('i') ? w + 'es' : w + 's');

/** Human-friendly amount: "2 medium (220 g)", "1½ tsp", "300 ml". */
export function fmtQty(foodId, g, food) {
  food = food || FOODS[foodId] || {};
  if (!g) return 'to taste';
  if (food.pc) {
    const [pg, label] = food.pc;
    const n = g / pg;
    if (pg < 2) { const c = Math.max(1, Math.round(n)); return `${c} ${c > 1 ? pluralize(label) : label}`; }
    return `${niceNum(n)} ${n > 1.1 ? pluralize(label) : label} (${roundG(g)} g)`;
  }
  if (food.sp && g < food.sp * 4) {
    const tbsp = g / food.sp;
    if (tbsp < 0.9) return `${niceNum((g / food.sp) * 3)} tsp`;
    return `${niceNum(tbsp)} tbsp`;
  }
  if (food.ml) return `${roundG(g)} ml`;
  if (g >= 1000) return `${(g / 1000).toFixed(g % 1000 ? 2 : 0).replace(/0$/, '')} kg`;
  return `${roundG(g)} g`;
}

export const r0 = (x) => Math.round(x || 0);
