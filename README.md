# Meal Prep Planner

A phone-first web app for planning quick (15–20 min), balanced, high-protein meals in a slight calorie deficit. It also handles weekend prep, grocery lists and nutrition tracking, and you can share any of it on WhatsApp.

There's no build step: it's plain HTML/CSS/JS that GitHub Pages can serve as-is, and it works offline once installed.

## Features

| Area | What it does |
|---|---|
| **Profiles** | One per person. Calorie and protein targets come from age, sex, height, weight, activity and goal (Mifflin-St Jeor, with a deficit of −250/−400/−550 kcal and 1.0–2.0 g protein per kg). You can override them by hand. |
| **Recipes** | 80 built-in recipes (North and South Indian, Asian, soups, salads, breakfasts, snacks), including air-fryer-only, microwave-only and ⚡ no-prep quick fixes. No pork or beef. Add your own with nutrition worked out automatically from ingredients. |
| **✨ Ask Claude** | Suggests 3 recipes that fit your targets and the ingredients you have, or turns any pasted recipe into the app's format. Needs your own Anthropic API key. |
| **Meals per day** | A grid on the Plan screen: for each weekday choose which meals to plan (breakfast, lunch, snack, dinner) and whether each is 🍗 non-veg or 🥦 veg (no meat, fish or egg). The default is lunch + dinner + snack, all non-veg. Skipped meals' calories are spread over the others. |
| **Plan** | A weekly planner with one-tap **auto-fill** (lunchbox-friendly on workdays, and dinner cooked extra for the next day's lunchbox). Portions are set per person automatically and can be adjusted. |
| **Prepped vs fresh** | Every ingredient is tagged 🧺 *prepped* (masala base, sprouted, marinated, pre-chopped…) or 🛒 *fresh/pantry*. Tap a 🧺 tag to see exactly when to do it, e.g. soak Fri 9 pm → drain Sat 7 am → ready Sun, keeps 4 days, or freeze and thaw the night before. |
| **Prep** | A **grocery list** grouped by aisle, a **weekend prep list** (batch tasks with quantities, e.g. masala base or marinades, merged across dishes) and a mid-week chopping top-up. |
| **Cook mode** | Steps with tap-to-start timers, scaled quantities, "X min before" and "night before" tasks, plus a full-screen **step-by-step** mode with big text. Keeps the screen awake. |
| **First-run setup** | After adding profiles: choose meals per day → auto-fill the week → open the grocery list. |
| **Tracking** | Tick meals as eaten, log extra food, see a 7-day calorie chart and a weight trend. |
| **WhatsApp** | Share a recipe, a day's cooking plan, the prep list, the grocery list or the week's plan as formatted text. |

## Put it on GitHub Pages

1. Create a new repository on github.com, e.g. `meal-prep`. It can be private if you have GitHub Pro; otherwise it needs to be public.
2. Upload the files:
   - **No git installed:** on the repo page, click **Add file → Upload files** and drag in *everything in this folder* (`index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `icons/`). Commit.
   - **With git:** `git init && git add . && git commit -m "Meal prep app" && git branch -M main && git remote add origin https://github.com/<you>/meal-prep.git && git push -u origin main`
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, pick `main` and `/ (root)`, then click Save.
4. After about a minute the app is live at `https://<you>.github.io/meal-prep/`.

> When you change files later, bump `CACHE = 'meal-prep-vN'` in `sw.js` so installed phones pick up the update.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the icon. It runs full-screen and works offline.

## Using it with your wife's phone

All data is stored **on the phone** (no server, no login). To get the same plan on a second phone:

1. On your phone go to **Me → Export / send backup** and send the file on WhatsApp or AirDrop.
2. On her phone (with the app installed) go to **Me → Import** and choose **Merge**.

This copies a snapshot; it doesn't sync live. If live two-way sync becomes important, the storage layer (`js/store.js`) is small enough to move onto a free Supabase/Firebase backend.

## Claude API key

- Create one at console.anthropic.com → API Keys and **set a monthly spend limit**. Each suggestion costs a few rupees.
- Paste it in **Me → Settings**. It is stored only in that phone's browser storage and is never included in backups.
- The app calls `claude-opus-5-5` directly from the browser using the official Anthropic SDK, loaded from jsDelivr. It has server-side refusal fallback enabled (`fallbacks: "default"`).

## Files

```
index.html            app shell
css/app.css           styles (light and dark)
js/app.js             screens, routing, actions
js/store.js           local storage, backup/import
js/foods.js           nutrition per 100 g for ~120 Indian kitchen foods (IFCT/USDA approximations)
js/recipes.js         built-in recipes and shared weekend prep tasks
js/nutrition.js       targets, portion maths, quantity formatting
js/planner.js         week dates, grocery and prep aggregation, auto-fill
js/share.js           WhatsApp text formatting
js/ai.js              Claude suggestions and recipe import
js/chart.js           small SVG charts
sw.js                 offline cache
```

To preview locally: `python3 -m http.server 8000`, then open http://localhost:8000.

*Nutrition numbers are estimates (±10–15%). They're not medical advice.*
