// Claude-powered recipe suggestions & recipe import.
// Runs in the browser with the user's own API key (stored only on this device).
import { FOODS, FOOD_LIST } from './foods.js';
import { state, uid } from './store.js';
import { targets, mealTarget, MEAL_LABEL } from './nutrition.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm';
const MODEL = 'claude-opus-5-5';

const FOOD_IDS = FOOD_LIST.map((f) => f.id);

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'cuisine', 'cat', 'meals', 'lunchbox', 'serves', 'prep', 'cook', 'unit_count', 'unit_label', 'ingredients', 'weekend_prep', 'night_before', 'before_cooking', 'steps', 'why'],
  properties: {
    name: { type: 'string' },
    cuisine: { type: 'string', enum: ['North Indian', 'South Indian', 'Indian', 'Asian', 'Continental'] },
    cat: { type: 'string', enum: ['breakfast', 'main', 'side', 'soup', 'salad', 'snack'] },
    meals: { type: 'array', items: { type: 'string', enum: ['b', 'l', 'd', 's'] } },
    lunchbox: { type: 'boolean' },
    serves: { type: 'integer' },
    prep: { type: 'integer', description: 'active prep minutes on the day, assuming weekend prep is done' },
    cook: { type: 'integer', description: 'cooking minutes' },
    unit_count: { type: 'number', description: 'how many units make one serving, e.g. 2' },
    unit_label: { type: 'string', description: 'unit name, e.g. "phulkas", "bowl"' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['food_id', 'name', 'grams', 'note', 'kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g', 'fibre_100g'],
        properties: {
          food_id: { type: 'string', enum: [...FOOD_IDS, 'other'] },
          name: { type: 'string' },
          grams: { type: 'number', description: 'raw/dry weight in grams for the whole recipe' },
          note: { type: 'string', description: 'e.g. "chopped"; empty if none' },
          kcal_100g: { type: 'number', description: 'only for food_id "other", else 0' },
          protein_100g: { type: 'number' },
          carbs_100g: { type: 'number' },
          fat_100g: { type: 'number' },
          fibre_100g: { type: 'number' },
        },
      },
    },
    weekend_prep: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['task', 'minutes'], properties: { task: { type: 'string' }, minutes: { type: 'integer' } } } },
    night_before: { type: 'array', items: { type: 'string' } },
    before_cooking: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['task', 'minutes_before'], properties: { task: { type: 'string' }, minutes_before: { type: 'integer' } } } },
    steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'timer_minutes'], properties: { text: { type: 'string' }, timer_minutes: { type: 'integer', description: '0 if no timer' } } } },
    why: { type: 'string', description: 'one sentence on why this fits the brief' },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes'],
  properties: { recipes: { type: 'array', items: RECIPE_SCHEMA } },
};

const SYSTEM = `You design quick, healthy home recipes for an Indian household cooking on weekdays.

House rules:
- Non-vegetarian is welcome (chicken, eggs, fish, prawns). Never use pork or beef.
- Weekday active time must fit 15–20 minutes (prep + cook), assuming batch prep (chopping, pastes, boiled legumes, marinades, masala base) was done on the weekend. Put that batch work in weekend_prep and keep the day-of steps short.
- Typical Indian kitchen: pressure cooker, gas stove, tawa, kadai, mixer; sometimes an air fryer or microwave. Ingredients should be easy to buy in an Indian city.
- Goal: well-balanced meals in a slight calorie deficit with high protein (aim for at least 25 g protein per main-meal serving). Use modest oil (about 1 tsp to 1 tbsp per serving).
- Write the recipe for "serves" standard servings (normally 2). Ingredient grams are for the WHOLE recipe, raw/dry weight.
- Use food_id values from the allowed list wherever an ingredient matches. Only use "other" when nothing fits, and then give realistic per-100 g nutrition. For listed foods, set all *_100g fields to 0.
- Steps: short, imperative, one action each; set timer_minutes for waiting steps (simmer, pressure-cook, rest), else 0.
- Lunchbox = true only if it travels well and tastes fine warm or at room temperature.

Available food_id values (id: name):
${FOOD_LIST.map((f) => `${f.id}: ${f.name}`).join('\n')}`;

let sdkPromise;
async function client() {
  const key = state.settings.apiKey?.trim();
  if (!key) throw new Error('Add your Anthropic API key in Me → Settings first.');
  sdkPromise ||= import(SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

function householdBrief() {
  return state.profiles.map((p) => {
    const t = targets(p);
    return `- ${p.name}: ${p.sex === 'f' ? 'female' : 'male'}, ${p.age} y, ${p.weightKg} kg → ${t.kcal} kcal & ${t.p} g protein per day`;
  }).join('\n');
}

async function ask(userText) {
  const anthropic = await client();
  let res;
  try {
    res = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: userText }],
    });
  } catch (e) {
    const status = e?.status;
    if (status === 401) throw new Error('The API key was rejected. Check it in Settings.');
    if (status === 429) throw new Error('Rate limited – wait a minute and try again.');
    if (status === 400) throw new Error('Request rejected: ' + (e?.error?.error?.message || e.message));
    if (status >= 500) throw new Error('Claude is temporarily unavailable. Try again shortly.');
    throw new Error(e?.message || 'Network error – are you online?');
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing it.');
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Ask for fewer recipes.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Could not read Claude’s answer. Try again.'); }
  return (data.recipes || []).map(toRecipe);
}

function toRecipe(x) {
  return {
    id: uid('ai'),
    name: x.name,
    cuisine: x.cuisine,
    cat: x.cat,
    meals: x.meals?.length ? x.meals : ['l', 'd'],
    lunchbox: !!x.lunchbox,
    serves: Math.max(1, x.serves || 2),
    prep: x.prep || 0,
    cook: x.cook || 0,
    unit: x.unit_label ? [x.unit_count || 1, x.unit_label] : undefined,
    ing: x.ingredients.map((i) => (i.food_id !== 'other' && FOODS[i.food_id]
      ? { f: i.food_id, g: i.grams, note: i.note || '' }
      : { name: i.name, g: i.grams, note: i.note || '', n: { kcal: i.kcal_100g, p: i.protein_100g, c: i.carbs_100g, f: i.fat_100g, fib: i.fibre_100g } })),
    wkCustom: x.weekend_prep.map((w) => ({ t: w.task, m: w.minutes })),
    nt: x.night_before,
    pre: x.before_cooking.map((p) => [p.task, p.minutes_before]),
    steps: x.steps.map((s) => (s.timer_minutes ? [s.text, s.timer_minutes] : s.text)),
    why: x.why,
    source: 'ai',
    custom: true,
  };
}

export async function suggestRecipes({ meal, cuisine, have, notes, count = 3 }) {
  const mt = state.profiles.map((p) => { const t = mealTarget(p, meal); return `${p.name} ≈ ${Math.round(t.kcal)} kcal / ${Math.round(t.p)} g protein`; }).join('; ');
  const prompt = `Suggest ${count} different recipes for ${MEAL_LABEL[meal] || meal}${cuisine && cuisine !== 'Any' ? ` in ${cuisine} style` : ''}.
Household:
${householdBrief()}
Per-person targets for this meal: ${mt}. One recipe serving should land roughly at the average of these.
${have ? `Use these ingredients I already have where sensible: ${have}.` : ''}
${notes ? `Extra wishes: ${notes}` : ''}
Make the ${count} recipes clearly different from each other (protein source, cuisine, technique).`;
  return ask(prompt);
}

export async function importRecipe(text) {
  return ask(`Convert this recipe into the structured format. Keep the dish faithful, but reduce oil/sugar slightly if it is very heavy and tell me in "why". If it takes longer than 20 minutes on the day, move what you can into weekend_prep.

Recipe:
"""
${text}
"""

Return exactly one recipe.`);
}
