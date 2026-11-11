// Plain-text builders formatted for WhatsApp (*bold*, _italic_).
import { state, getRecipe, slot } from './store.js';
import { MEALS, MEAL_LABEL, perServing, r0 } from './nutrition.js';
import { TASKS } from './recipes.js';
import { fmtDate, scaledIngredients, dayCooking, nightBefore, addDays, groceryList, prepPlan, portionOf, slotRecipes, DAY, dow, ingredientPrep, prepName, nextPlannedDate, today } from './planner.js';

const fmtMin = (m) => (m ? `${m} min` : '');

function portionLine(portions) {
  return state.profiles.filter((p) => portions[p.id]).map((p) => `${p.name} ×${portions[p.id]}`).join(', ');
}

const ingLine = (i, prep) => {
  const v = i.f && prep.get(i.f);
  return `• ${i.food.name}${i.note ? ` (${i.note})` : ''} – ${i.qty}${v ? ` _[prepped: ${prepName(v, i.f)}]_` : ''}`;
};

export function recipeText(r, servings, portions = {}) {
  const n = perServing(r);
  const lines = [`*${r.name}*`, `_${r.cuisine} · ${r.prep + r.cook} min active · makes ${+servings.toFixed(2)} servings_`];
  const pl = portionLine(portions);
  if (pl) lines.push(`Portions: ${pl}`);
  lines.push('', '*Ingredients*');
  const prep = ingredientPrep(r, nextPlannedDate(r.id) || addDays(today(), 1));
  for (const i of scaledIngredients(r, servings)) lines.push(ingLine(i, prep));
  const wk = [...(r.wk || []).map((k) => TASKS[k]?.t).filter(Boolean), ...(r.wkCustom || []).map((c) => c.t)];
  if (wk.length) { lines.push('', '*Prep ahead (weekend)*'); wk.forEach((t) => lines.push(`☐ ${t}`)); }
  if (r.nt?.length) { lines.push('', '*Night before*'); r.nt.forEach((t) => lines.push(`☐ ${t}`)); }
  if (r.pre?.length) { lines.push('', '*Before you start*'); r.pre.forEach(([t, m]) => lines.push(`☐ ${m} min before: ${t}`)); }
  lines.push('', '*Steps*');
  (r.steps || []).forEach((s, i) => {
    const [t, m] = Array.isArray(s) ? s : [s, 0];
    lines.push(`${i + 1}. ${t}${m ? ` ⏱ ${m} min` : ''}`);
  });
  lines.push('', `_Per serving: ${r0(n.kcal)} kcal · ${r0(n.p)} g protein · ${r0(n.c)} g carbs · ${r0(n.f)} g fat_`);
  return lines.join('\n');
}

export function dayCookText(date) {
  const { insts, pre } = dayCooking(date);
  const lines = [`*Cooking plan – ${fmtDate(date, true)}*`];
  const nb = nightBefore(addDays(date, 1));
  const left = [];
  for (const { k } of MEALS) {
    const sl = slot(date, k);
    if (sl?.from && sl.dishes.length) left.push(`${MEAL_LABEL[k]}: pack leftovers – ${slotRecipes(sl).map((r) => r.name).join(' + ')}`);
  }
  if (left.length) { lines.push('', '*Leftovers*'); left.forEach((t) => lines.push(`• ${t}`)); }
  if (pre.length) { lines.push('', '*Before you start cooking*'); pre.forEach((p) => lines.push(`☐ ${p.m} min before: ${p.t} _(${p.dish})_`)); }
  for (const { k } of MEALS) {
    const list = insts.filter((i) => i.meal === k);
    if (!list.length) continue;
    lines.push('', `━━ *${MEAL_LABEL[k].toUpperCase()}* ━━`);
    for (const it of list) {
      lines.push('', `*${it.recipe.name}* – ${+it.servings.toFixed(2)} servings${it.leftovers.length ? ' _(includes tomorrow’s lunchbox)_' : ''}`);
      const prep = ingredientPrep(it.recipe, date);
      for (const i of scaledIngredients(it.recipe, it.servings)) lines.push(ingLine(i, prep));
      (it.recipe.steps || []).forEach((s, n) => {
        const [t, m] = Array.isArray(s) ? s : [s, 0];
        lines.push(`${n + 1}. ${t}${m ? ` ⏱ ${m} min` : ''}`);
      });
    }
    const sl = slot(date, k);
    if (sl) {
      const portions = Object.fromEntries(state.profiles.map((p) => [p.id, portionOf(sl, k, p.id, date)]));
      const pl = portionLine(portions);
      if (pl) lines.push(`_Serve: ${pl}_`);
    }
  }
  if (nb.length) { lines.push('', '*Tonight, for tomorrow*'); nb.forEach((t) => lines.push(`☐ ${t.t} _(${t.dish})_`)); }
  return lines.join('\n');
}

export function groceryText(dates, checked = {}, extras = []) {
  const { groups, pantry } = groceryList(dates);
  const lines = [`*Grocery list – week of ${fmtDate(dates[0])}*`];
  for (const g of groups) {
    const items = g.items.filter((i) => !checked[i.key]);
    if (!items.length) continue;
    lines.push('', `*${g.label}*`);
    items.forEach((i) => lines.push(`☐ ${i.food.name} – ${i.qty}`));
  }
  const ex = extras.filter((e) => !checked['x:' + e]);
  if (ex.length) { lines.push('', '*Also*'); ex.forEach((e) => lines.push(`☐ ${e}`)); }
  const pt = pantry.filter((i) => !checked[i.key]);
  if (pt.length) lines.push('', '*Pantry check*', pt.map((i) => i.food.name).join(', '));
  return lines.join('\n');
}

export function prepText(dates, checked = {}) {
  const { weekend, midweek, minutes, sunday } = prepPlan(dates);
  const lines = [`*Weekend prep – ${fmtDate(sunday)}* (~${minutes} min)`];
  const task = (t) => {
    lines.push('', `☐ *${t.t}* (${fmtMin(t.m)})`);
    if (t.startText) lines.push(`   ⏰ ${t.startText}`);
    if (t.amountText) lines.push(`   ${t.amountText}`);
    if (t.dishText) lines.push(`   _For: ${t.dishText}_`);
    if (t.freezeText) lines.push(`   ❄️ ${t.freezeText}`);
  };
  weekend.filter((t) => !checked[t.gk]).forEach(task);
  for (const day of midweek) {
    const open = day.tasks.filter((t) => !checked[t.gk]);
    if (!open.length) continue;
    lines.push('', `*Mid-week – ${fmtDate(day.date)} evening*`);
    open.forEach(task);
  }
  return lines.join('\n');
}

export function weekPlanText(dates) {
  const lines = [`*Meal plan – week of ${fmtDate(dates[0])}*`];
  for (const d of dates) {
    const day = state.plan[d];
    if (!day) continue;
    const rows = MEALS.filter(({ k }) => day[k]?.dishes?.length).map(({ k }) => `${MEAL_LABEL[k]}: ${day[k].dishes.map((id) => getRecipe(id)?.name).filter(Boolean).join(' + ')}${day[k].from ? ' _(leftovers)_' : ''}`);
    if (rows.length) lines.push('', `*${DAY[dow(d)]} ${fmtDate(d).split(', ').pop()}*`, ...rows);
  }
  return lines.join('\n');
}

export const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
