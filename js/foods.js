// Approximate nutrition per 100 g (edible, raw/dry unless noted).
// Sources: IFCT 2017 / USDA FoodData Central, rounded. Good enough for planning, not lab-accurate.
// Row: [id, name, category, kcal, protein, carbs, fat, fibre, extra]
// extra: pc:[grams, label] = household piece; sp: grams per tbsp (tsp = sp/3); ml: liquid; chop: days chopped veg keeps
// pantry: true = staple you usually have (shown under "Pantry check" on grocery list)

export const CATEGORIES = {
  veg: 'Vegetables & herbs',
  fruit: 'Fruits',
  meat: 'Chicken, fish & eggs',
  dairy: 'Dairy & tofu',
  grain: 'Grains, flours & bread',
  pulse: 'Dals & legumes',
  nuts: 'Nuts & seeds',
  sauce: 'Sauces & condiments',
  frozen: 'Frozen',
  spice: 'Spices & pantry',
  other: 'Other',
};

const S = (g) => ({ sp: g, pantry: true }); // spice helper

const ROWS = [
  // Chicken, fish & eggs
  ['chicken_breast', 'Chicken breast (boneless)', 'meat', 120, 22.5, 0, 2.6, 0],
  ['chicken_thigh', 'Chicken thigh (boneless)', 'meat', 121, 19.9, 0, 4.1, 0],
  ['chicken_bonein', 'Chicken curry cut (skinless, bone-in)', 'meat', 105, 15.5, 0, 4.5, 0],
  ['chicken_mince', 'Chicken mince (keema)', 'meat', 143, 17.4, 0, 8.1, 0],
  ['egg', 'Eggs', 'meat', 143, 12.6, 0.7, 9.5, 0, { pc: [50, 'egg'] }],
  ['egg_white', 'Egg whites', 'meat', 52, 10.9, 0.7, 0.2, 0, { pc: [33, 'white'] }],
  ['fish_seer', 'Fish – seer/surmai or rohu steaks', 'meat', 120, 21, 0, 4, 0],
  ['fish_white', 'Fish – basa/tilapia fillet', 'meat', 96, 20, 0, 1.7, 0],
  ['prawns', 'Prawns (cleaned)', 'meat', 85, 20, 0.2, 0.5, 0],
  ['tuna_can', 'Tuna (canned in water, drained)', 'meat', 116, 25.5, 0, 0.8, 0],

  // Dairy & tofu
  ['paneer', 'Paneer', 'dairy', 265, 18.3, 1.2, 20.8, 0],
  ['paneer_lite', 'Low-fat paneer', 'dairy', 180, 20, 3, 9, 0],
  ['tofu', 'Tofu (firm)', 'dairy', 144, 15.8, 2.8, 8.7, 2.3],
  ['curd', 'Curd / dahi (toned milk)', 'dairy', 60, 3.5, 4.7, 3, 0, { sp: 15 }],
  ['greek_yogurt', 'Greek yogurt / hung curd (low-fat)', 'dairy', 73, 9.9, 3.9, 1.9, 0, { sp: 15 }],
  ['milk', 'Milk (toned)', 'dairy', 58, 3.2, 4.7, 3, 0, { ml: 1 }],
  ['butter', 'Butter', 'dairy', 717, 0.9, 0.1, 81, 0, { sp: 14 }],
  ['cheese', 'Cheese (cheddar/processed)', 'dairy', 330, 20, 4, 26, 0, { pc: [20, 'slice'] }],

  // Grains
  ['atta', 'Whole wheat atta', 'grain', 340, 13.2, 72, 2.5, 10.7],
  ['rice', 'Rice (sona masoori/basmati)', 'grain', 360, 6.8, 79, 0.5, 1],
  ['brown_rice', 'Brown rice', 'grain', 362, 7.5, 76, 2.7, 3.4],
  ['oats', 'Rolled oats', 'grain', 389, 16.9, 66, 6.9, 10.6, { sp: 6 }],
  ['poha', 'Poha (thick)', 'grain', 346, 6.6, 77, 1.2, 2],
  ['rava', 'Rava / sooji', 'grain', 360, 12.7, 72.8, 1.1, 3.9],
  ['ragi', 'Ragi flour', 'grain', 328, 7.3, 72, 1.3, 11.5],
  ['quinoa', 'Quinoa', 'grain', 368, 14.1, 64, 6.1, 7],
  ['bread_ww', 'Whole wheat bread', 'grain', 247, 13, 41, 3.4, 7, { pc: [28, 'slice'] }],
  ['wrap_ww', 'Whole wheat wrap / tortilla', 'grain', 290, 9, 47, 7, 6, { pc: [45, 'wrap'] }],
  ['idli_batter', 'Idli/dosa batter', 'grain', 130, 4, 27, 0.4, 1.5],
  ['noodles', 'Whole wheat / hakka noodles (dry)', 'grain', 350, 12, 70, 2, 4],
  ['rice_noodles', 'Rice noodles (dry)', 'grain', 364, 6, 80, 0.6, 1.6],
  ['cornflour', 'Cornflour', 'grain', 381, 0.3, 91, 0.1, 0.9, { sp: 8, pantry: true }],

  // Dals & legumes (dry weight)
  ['toor_dal', 'Toor dal', 'pulse', 343, 22, 57.6, 1.5, 15],
  ['moong_dal', 'Moong dal (yellow)', 'pulse', 348, 24.5, 59, 1.2, 8],
  ['masoor_dal', 'Masoor dal (red lentils)', 'pulse', 352, 24.6, 63, 1.1, 11],
  ['chana_dal', 'Chana dal', 'pulse', 360, 20.8, 59.8, 5.6, 17],
  ['rajma', 'Rajma (dry)', 'pulse', 333, 23, 60, 0.8, 25],
  ['kabuli_chana', 'Kabuli chana (dry)', 'pulse', 364, 19, 61, 6, 17],
  ['moong_sprouts', 'Moong sprouts', 'pulse', 90, 7, 15, 0.4, 4],
  ['roasted_chana', 'Roasted chana', 'pulse', 369, 22, 58, 5, 17],
  ['besan', 'Besan (gram flour)', 'pulse', 387, 22.4, 57.8, 6.7, 10.8, { sp: 8 }],
  ['soya_chunks', 'Soya chunks (dry)', 'pulse', 345, 52, 33, 0.5, 13],

  // Nuts & seeds
  ['peanuts', 'Peanuts', 'nuts', 567, 25.8, 16.1, 49.2, 8.5, { sp: 9 }],
  ['almonds', 'Almonds', 'nuts', 579, 21.2, 21.6, 49.9, 12.5, { pc: [1.2, 'almond'] }],
  ['cashews', 'Cashews', 'nuts', 553, 18.2, 30.2, 43.8, 3.3, { pc: [1.5, 'cashew'] }],
  ['chia', 'Chia seeds', 'nuts', 486, 16.5, 42, 30.7, 34, { sp: 12 }],
  ['sesame', 'Sesame seeds', 'nuts', 573, 17.7, 23.4, 49.7, 11.8, { sp: 9 }],
  ['makhana', 'Makhana (fox nuts)', 'nuts', 347, 9.7, 76.9, 0.1, 14.5],
  ['peanut_butter', 'Peanut butter (unsweetened)', 'nuts', 588, 25, 20, 50, 6, { sp: 16 }],
  ['coconut', 'Coconut (fresh grated)', 'nuts', 354, 3.3, 15.2, 33.5, 9, { sp: 6 }],

  // Vegetables & herbs
  ['onion', 'Onion', 'veg', 40, 1.1, 9.3, 0.1, 1.7, { pc: [110, 'medium'], chop: 4 }],
  ['tomato', 'Tomato', 'veg', 18, 0.9, 3.9, 0.2, 1.2, { pc: [100, 'medium'] }],
  ['potato', 'Potato', 'veg', 77, 2, 17.5, 0.1, 2.2, { pc: [150, 'medium'] }],
  ['sweet_potato', 'Sweet potato', 'veg', 86, 1.6, 20, 0.1, 3, { pc: [200, 'medium'] }],
  ['spinach', 'Spinach / palak', 'veg', 23, 2.9, 3.6, 0.4, 2.2, { chop: 2 }],
  ['capsicum', 'Capsicum (green)', 'veg', 20, 0.9, 4.6, 0.2, 1.7, { pc: [120, 'medium'], chop: 4 }],
  ['bell_pepper', 'Bell pepper (red/yellow)', 'veg', 31, 1, 6, 0.3, 2.1, { pc: [150, 'medium'], chop: 4 }],
  ['carrot', 'Carrot', 'veg', 41, 0.9, 9.6, 0.2, 2.8, { pc: [70, 'medium'], chop: 5 }],
  ['beans', 'French beans', 'veg', 31, 1.8, 7, 0.2, 2.7, { chop: 5 }],
  ['cabbage', 'Cabbage', 'veg', 25, 1.3, 5.8, 0.1, 2.5, { chop: 4 }],
  ['cauliflower', 'Cauliflower', 'veg', 25, 1.9, 5, 0.3, 2, { chop: 4 }],
  ['broccoli', 'Broccoli', 'veg', 34, 2.8, 6.6, 0.4, 2.6, { chop: 4 }],
  ['cucumber', 'Cucumber', 'veg', 15, 0.7, 3.6, 0.1, 0.5, { pc: [200, 'medium'] }],
  ['mushroom', 'Mushrooms (button)', 'veg', 22, 3.1, 3.3, 0.3, 1, { chop: 2 }],
  ['zucchini', 'Zucchini', 'veg', 17, 1.2, 3.1, 0.3, 1, { chop: 3 }],
  ['lettuce', 'Lettuce / salad greens', 'veg', 15, 1.4, 2.9, 0.2, 1.3],
  ['spring_onion', 'Spring onion', 'veg', 32, 1.8, 7.3, 0.2, 2.6, { chop: 4 }],
  ['bhindi', 'Bhindi / okra', 'veg', 33, 1.9, 7.5, 0.2, 3.2, { chop: 2 }],
  ['pumpkin', 'Pumpkin (red)', 'veg', 26, 1, 6.5, 0.1, 0.5, { chop: 4 }],
  ['beetroot', 'Beetroot', 'veg', 43, 1.6, 9.6, 0.2, 2.8, { pc: [120, 'medium'], chop: 4 }],
  ['ginger', 'Ginger', 'veg', 80, 1.8, 18, 0.8, 2],
  ['garlic', 'Garlic', 'veg', 149, 6.4, 33, 0.5, 2.1, { pc: [3, 'clove'] }],
  ['gg_paste', 'Ginger-garlic paste', 'veg', 110, 4, 25, 0.6, 2, { sp: 15 }],
  ['green_chilli', 'Green chillies', 'veg', 40, 2, 9.5, 0.2, 1.5, { pc: [5, 'chilli'] }],
  ['coriander', 'Coriander leaves', 'veg', 23, 2.1, 3.7, 0.5, 2.8, { sp: 4 }],
  ['mint', 'Mint leaves', 'veg', 44, 3.3, 8.4, 0.7, 6.8, { sp: 4 }],
  ['curry_leaves', 'Curry leaves', 'veg', 108, 6, 18, 1, 6, { pc: [0.1, 'leaf'] }],
  ['lemon', 'Lemon (juice)', 'veg', 22, 0.4, 6.9, 0.2, 0.3, { pc: [30, 'lemon'] }],

  // Fruits
  ['banana', 'Banana', 'fruit', 89, 1.1, 22.8, 0.3, 2.6, { pc: [110, 'medium'] }],
  ['apple', 'Apple', 'fruit', 52, 0.3, 13.8, 0.2, 2.4, { pc: [180, 'medium'] }],
  ['papaya', 'Papaya', 'fruit', 43, 0.5, 10.8, 0.3, 1.7],
  ['pomegranate', 'Pomegranate arils', 'fruit', 83, 1.7, 18.7, 1.2, 4, { sp: 12 }],
  ['orange', 'Orange', 'fruit', 47, 0.9, 11.8, 0.1, 2.4, { pc: [150, 'medium'] }],

  // Frozen
  ['peas', 'Green peas (frozen)', 'frozen', 81, 5.4, 14.5, 0.4, 5.1],
  ['corn', 'Sweet corn (frozen)', 'frozen', 86, 3.3, 19, 1.4, 2],

  // Sauces & condiments
  ['soy_sauce', 'Soy sauce (low sodium)', 'sauce', 53, 8.1, 4.9, 0.6, 0.8, { sp: 16 }],
  ['vinegar', 'Vinegar', 'sauce', 18, 0, 0.04, 0, 0, { sp: 15, pantry: true }],
  ['chilli_sauce', 'Chilli sauce / sriracha', 'sauce', 93, 1.9, 19, 0.9, 2, { sp: 17 }],
  ['green_curry_paste', 'Thai green curry paste', 'sauce', 120, 2, 12, 7, 4, { sp: 16 }],
  ['coconut_milk', 'Coconut milk (light)', 'sauce', 74, 0.6, 1.5, 7.2, 0, { ml: 1 }],
  ['honey', 'Honey', 'sauce', 304, 0.3, 82, 0, 0.2, { sp: 21 }],
  ['jaggery', 'Jaggery', 'sauce', 383, 0.4, 95, 0.1, 0, { sp: 15, pantry: true }],
  ['tamarind', 'Tamarind pulp', 'sauce', 239, 2.8, 62.5, 0.6, 5.1, { sp: 15, pantry: true }],
  ['tomato_ketchup', 'Tomato ketchup', 'sauce', 101, 1.2, 25, 0.1, 0.3, { sp: 17 }],

  // Fats & spices (pantry)
  ['oil', 'Cooking oil', 'spice', 884, 0, 0, 100, 0, { sp: 14, pantry: true }],
  ['ghee', 'Ghee', 'spice', 900, 0, 0, 99.8, 0, { sp: 13, pantry: true }],
  ['sesame_oil', 'Sesame oil', 'spice', 884, 0, 0, 100, 0, { sp: 14, pantry: true }],
  ['salt', 'Salt', 'spice', 0, 0, 0, 0, 0, S(18)],
  ['sugar', 'Sugar', 'spice', 387, 0, 100, 0, 0, S(12)],
  ['turmeric', 'Turmeric powder', 'spice', 312, 9.7, 67, 3.3, 22.7, S(9)],
  ['chilli_powder', 'Red chilli powder', 'spice', 282, 13.5, 50, 14.3, 34.8, S(8)],
  ['coriander_powder', 'Coriander powder', 'spice', 298, 12.4, 55, 17.8, 41.9, S(6)],
  ['cumin', 'Jeera / cumin seeds', 'spice', 375, 17.8, 44, 22.3, 10.5, S(6)],
  ['cumin_powder', 'Cumin powder', 'spice', 375, 17.8, 44, 22.3, 10.5, S(6)],
  ['mustard_seeds', 'Mustard seeds', 'spice', 508, 26, 28, 36, 12, S(10)],
  ['garam_masala', 'Garam masala', 'spice', 380, 14, 45, 15, 30, S(6)],
  ['black_pepper', 'Black pepper', 'spice', 251, 10.4, 64, 3.3, 25.3, S(7)],
  ['kasuri_methi', 'Kasuri methi', 'spice', 323, 23, 58, 6.4, 24.6, S(3)],
  ['chaat_masala', 'Chaat masala', 'spice', 250, 10, 50, 5, 20, S(6)],
  ['sambar_powder', 'Sambar powder', 'spice', 320, 13, 50, 10, 25, S(7)],
  ['rasam_powder', 'Rasam powder', 'spice', 320, 13, 50, 10, 25, S(7)],
  ['chicken_masala', 'Chicken masala', 'spice', 330, 12, 50, 12, 25, S(7)],
  ['tandoori_masala', 'Tandoori / tikka masala', 'spice', 300, 12, 50, 10, 25, S(7)],
  ['urad_dal', 'Urad dal (for tadka)', 'spice', 341, 25, 59, 1.6, 18, S(12)],
  ['hing', 'Hing (asafoetida)', 'spice', 297, 4, 68, 1, 4, S(6)],
  ['bay_leaf', 'Bay leaf', 'spice', 313, 7.6, 75, 8.4, 26, { pc: [0.2, 'leaf'], pantry: true }],
  ['oregano', 'Oregano / mixed herbs', 'spice', 265, 9, 69, 4.3, 42.5, S(3)],
  ['chilli_flakes', 'Chilli flakes', 'spice', 318, 12, 57, 17, 27, S(5)],
];

export const FOODS = {};
for (const [id, name, cat, kcal, p, c, f, fib, extra = {}] of ROWS) {
  FOODS[id] = { id, name, cat, kcal, p, c, f, fib, ...extra };
}

export const FOOD_LIST = Object.values(FOODS).sort((a, b) => a.name.localeCompare(b.name));
