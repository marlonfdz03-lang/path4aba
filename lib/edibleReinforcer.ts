// Advisory edible-reinforcer check. Notes NEVER document edibles (the master prompt ignores/substitutes
// food), so an edible reinforcer added to a profile simply won't appear in generated notes. This surfaces a
// WARNING at add time so the RBT knows the consequence — it never blocks the add (Marlon's ruling: inform,
// don't override judgment).
//
// CONSERVATIVE by design: a false warning on a real non-edible ("fidget toy", "tablet") is more annoying
// than missing an obscure edible, so this lists only clear food/drink words and deliberately omits ambiguous
// ones (chip/bar/pop/gum/ice/tablet, which collide with poker chip, monkey bars, bubble pop, iPad, etc.).

const EDIBLE_KEYWORDS = [
  // original set
  'edible', 'edibles', 'snack', 'snacks', 'candy', 'candies', 'chocolate',
  'cookie', 'cookies', 'cracker', 'crackers', 'goldfish', 'pretzel', 'pretzels',
  'popcorn', 'cereal', 'gummy', 'gummies', 'fruit', 'juice',
  'strawberry', 'strawberries', 'grapes', 'raisins', 'marshmallow', 'marshmallows',
  'lollipop', 'lollipops', 'skittles', 'jellybean', 'yogurt', 'applesauce', 'pizza',
  'cheese', 'milk', 'food', 'drink', 'consumable', 'consumables',
  // savory / fast food — added after a live miss ("French fries", "chicken nuggets" reached a note).
  // NOTE (regression-guarded, do not re-add as bare words): "chip"/"chips" would flag "poker chip(s)",
  // "egg"/"eggs" would flag "egg shaker"/"plastic eggs", bare "chicken" would flag "chicken dance song".
  // Chips are covered only as branded/multi-word terms below; chicken only via "nugget(s)" + multi-word.
  'fries', 'fry', 'nugget', 'nuggets', 'burger', 'hamburger', 'cheeseburger', 'hotdog', 'sandwich',
  'taco', 'tacos', 'nacho', 'nachos', 'meat', 'sausage', 'bacon', 'pasta', 'noodle', 'noodles', 'soup',
  // sweets / bakery / frozen
  'cake', 'cupcake', 'cupcakes', 'brownie', 'brownies', 'donut', 'donuts', 'doughnut', 'doughnuts',
  'muffin', 'muffins', 'pie', 'pudding', 'jello', 'icecream', 'sherbet', 'popsicle', 'popsicles',
  'waffle', 'waffles', 'pancake', 'pancakes',
  // snacks / drinks / brands
  'dorito', 'doritos', 'takis', 'cheeto', 'cheetos', 'pringles', 'granola', 'oatmeal', 'smoothie',
  'soda', 'lemonade', 'gatorade', 'veggie', 'vegetable', 'poptart',
  // multi-word / hyphen / special (matched as substrings)
  'jelly bean', 'fruit snack', 'ice cream', 'ice-cream', 'm&m', 'french fries', 'chicken nuggets',
  'fried chicken', 'chicken tender', 'chicken strip', 'hot dog', 'goldfish crackers', 'fruit snacks',
  'fruit cup', 'cheese stick', 'cheese sticks', 'peanut butter', 'pop tart',
  'potato chip', 'tortilla chip', 'corn chip', 'bag of chips', 'potato chips', 'tortilla chips',
];

// True if `text` looks like an edible/consumable reinforcer. Case-insensitive; single words match on a word
// boundary (so "fruit" ≠ "fruitful", "poker chip" ≠ any bare food word), multi-word / hyphenated / special
// terms match as substrings.
export function looksEdible(text: unknown): boolean {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return false;
  return EDIBLE_KEYWORDS.some((k) =>
    /[ &-]/.test(k) ? s.includes(k) : new RegExp(`\\b${k}\\b`).test(s),
  );
}

export const EDIBLE_WARNING =
  "This looks like an edible reinforcer. Path4ABA notes never document food, so if you add it, it won't appear in generated notes.";
