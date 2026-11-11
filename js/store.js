import { RECIPES } from './recipes.js';

const KEY = 'nutrition-dashboard.v1';

const blank = () => ({
  version: 1,
  profiles: [],
  customRecipes: [],
  favorites: [],
  plan: {}, // { 'YYYY-MM-DD': { b|l|s|d: { dishes:[id], portions:{pid:m}, eaten:{pid:true}, from:'YYYY-MM-DD' } } }
  log: {}, // { 'YYYY-MM-DD': { pid: [{ id, name, kcal, p, c, f }] } }
  weights: {}, // { pid: [{ d:'YYYY-MM-DD', kg }] }
  checks: {}, // { 'grocery:WEEK': { key: true }, 'prep:WEEK': {...} }
  extras: {}, // { WEEK: ['item', ...] } extra grocery items
  settings: { workdays: [1, 2, 3, 4, 5], apiKey: '', leftoverLunch: true },
});

export let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw), settings: { ...blank().settings, ...JSON.parse(raw).settings } };
  } catch (e) { console.warn('load failed', e); }
  return blank();
}

let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { alert('Could not save: storage is full or blocked. Export a backup from Settings.'); }
  }, 50);
}

export function replaceState(next) {
  state = { ...blank(), ...next, settings: { ...blank().settings, ...(next.settings || {}), apiKey: state.settings.apiKey } };
  localStorage.setItem(KEY, JSON.stringify(state));
}

// Ask iOS/Safari to keep our data (helps avoid eviction).
try { navigator.storage?.persist?.(); } catch {}

// ───────── Recipes ─────────
let recipeIndex = null;
export function allRecipes() {
  return [...RECIPES, ...state.customRecipes];
}
export function getRecipe(id) {
  if (!recipeIndex || recipeIndex.size !== RECIPES.length + state.customRecipes.length) {
    recipeIndex = new Map(allRecipes().map((r) => [r.id, r]));
  }
  return recipeIndex.get(id) || allRecipes().find((r) => r.id === id);
}
export function resetRecipeIndex() { recipeIndex = null; }

export function upsertRecipe(r) {
  const i = state.customRecipes.findIndex((x) => x.id === r.id);
  if (i >= 0) state.customRecipes[i] = r; else state.customRecipes.push(r);
  resetRecipeIndex();
  save();
}
export function deleteRecipe(id) {
  state.customRecipes = state.customRecipes.filter((r) => r.id !== id);
  resetRecipeIndex();
  save();
}

// ───────── Profiles ─────────
export const profileById = (id) => state.profiles.find((p) => p.id === id);

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

// ───────── Plan ─────────
export function slot(date, meal, create = false) {
  const day = state.plan[date] || (create ? (state.plan[date] = {}) : null);
  if (!day) return null;
  if (!day[meal] && create) day[meal] = { dishes: [], portions: {}, eaten: {} };
  return day[meal] || null;
}

// ───────── Backup ─────────
export function exportData() {
  const copy = JSON.parse(JSON.stringify(state));
  copy.settings.apiKey = ''; // never export the API key
  copy.exportedAt = new Date().toISOString();
  return JSON.stringify(copy, null, 1);
}
