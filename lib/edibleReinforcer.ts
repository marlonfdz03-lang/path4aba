// Advisory edible-reinforcer check. Notes NEVER document edibles (the master prompt ignores/substitutes
// food), so an edible reinforcer added to a profile simply won't appear in generated notes. This surfaces a
// WARNING at add time so the RBT knows the consequence — it never blocks the add (Marlon's ruling: inform,
// don't override judgment).
//
// CONSERVATIVE by design: a false warning on a real non-edible ("fidget toy", "tablet") is more annoying
// than missing an obscure edible, so this lists only clear food/drink words and deliberately omits ambiguous
// ones (chip/bar/pop/gum/ice/tablet, which collide with poker chip, monkey bars, bubble pop, iPad, etc.).

const EDIBLE_KEYWORDS = [
  'edible', 'edibles', 'snack', 'snacks', 'candy', 'candies', 'chocolate',
  'cookie', 'cookies', 'cracker', 'crackers', 'goldfish', 'pretzel', 'pretzels',
  'popcorn', 'cereal', 'gummy', 'gummies', 'fruit', 'juice',
  'strawberry', 'strawberries', 'grapes', 'raisins', 'marshmallow', 'marshmallows',
  'lollipop', 'lollipops', 'skittles', 'jellybean', 'yogurt', 'applesauce', 'pizza',
  'cheese', 'milk', 'food', 'drink', 'consumable', 'consumables',
  // multi-word / special (matched as substrings)
  'jelly bean', 'fruit snack', 'ice cream', 'm&m',
];

// True if `text` looks like an edible/consumable reinforcer. Case-insensitive; single words match on a word
// boundary (so "fruit" ≠ "fruitful"), multi-word/special terms match as substrings.
export function looksEdible(text: unknown): boolean {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return false;
  return EDIBLE_KEYWORDS.some((k) =>
    /[ &]/.test(k) ? s.includes(k) : new RegExp(`\\b${k}\\b`).test(s),
  );
}

export const EDIBLE_WARNING =
  "This looks like an edible reinforcer. Path4ABA notes never document food, so if you add it, it won't appear in generated notes.";
