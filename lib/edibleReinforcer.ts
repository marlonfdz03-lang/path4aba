// Advisory edible-reinforcer check. Edibles ARE now documented in notes (Marlon's ruling: if a clinician puts
// food on the plan, the note records what was actually delivered — see buildServerSessionInput, where edibles
// are no longer filtered out). This check no longer gates anything; it only powers an ADD-TIME GUIDANCE note
// letting the RBT know food isn't generally recommended for skill-building. It never blocks the add.
//
// Because it is now purely advisory, it should be OVER-inclusive rather than under-inclusive: a false hit on a
// real non-edible costs a harmless guidance line, but a MISS makes the guidance a lie — silent on exactly the
// items it claims to flag (the live "Vanilla flavor sweets" / "Fruits" miss). We still omit words that collide
// with common non-edibles (chip/bar/pop/gum/ice/tablet → poker chip, monkey bars, bubble pop, iPad).

const EDIBLE_KEYWORDS = [
  // original set
  'edible', 'edibles', 'snack', 'snacks', 'candy', 'candies', 'chocolate',
  'cookie', 'cookies', 'cracker', 'crackers', 'goldfish', 'pretzel', 'pretzels',
  'popcorn', 'cereal', 'gummy', 'gummies', 'fruit', 'juice',
  'strawberry', 'strawberries', 'grapes', 'raisins', 'marshmallow', 'marshmallows',
  'lollipop', 'lollipops', 'skittles', 'jellybean', 'yogurt', 'applesauce', 'pizza',
  'cheese', 'milk', 'food', 'drink', 'consumable', 'consumables',
  // gap fix (live miss): "Vanilla flavor sweets" matched nothing; "Fruits" (plural) slipped \bfruit\b.
  'sweet', 'sweets', 'fruits', 'dessert', 'desserts',
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

// Add-time GUIDANCE (not a filter warning — edibles now appear in notes). English + Spanish; both shown under
// the reinforcer input so the copy matches what Marlon wants users to see.
export const EDIBLE_WARNING =
  "Edible reinforcers aren't generally recommended for skill-building, but you can add one if it's part of this client's plan.";
export const EDIBLE_WARNING_ES =
  "No se recomiendan los reforzadores comestibles para la enseñanza de habilidades, pero puedes agregarlos si son parte del plan de este cliente.";
