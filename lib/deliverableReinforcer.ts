// Advisory community-outing check — a sibling of edibleReinforcer.ts, same two-tier shape (warn at add-time,
// firewall at selection in buildServerSessionInput).
//
// WHY THIS EXISTS (Marlon's clinical rule): a reinforcer documented in a session note must be something the
// RBT can actually DELIVER during that session. A community outing — the beach, a mall walk, a park or pool
// trip, visiting family, a birthday party, going to a store — is a FAMILY activity, not something an RBT
// delivers in session. Naming one as the in-session reinforcer is a FALSE CLINICAL RECORD. So these are
// firewalled out of the reinforcer list before a note can name them (and warned about at add-time so the RBT
// understands why "beach visits" never appears in a note, rather than assuming a bug).
//
// A reinforcer is a CLEAR non-deliverable when either signal fires:
//   1. travel-to-a-place — "go to", "going to", "trip to", "visiting", "outing(s)", "walk(s)"
//   2. a named public venue — beach, mall, park, pool, store, restaurant, zoo, arcade, the movies / theater,
//      birthday party, family's house
//
// THE BORDERLINE SET IS DELIBERATELY EXCLUDED — playground, outside, recess, trampoline, water (play). Their
// deliverability depends on the SESSION LOCATION, which the reinforcer string does not encode: a school
// client's on-site playground and recess, and a home client's backyard "outside" or "water play", ARE
// deliverable. Auto-stripping them would erase legitimate in-session activities. So they are held for the RBT
// (or future location-aware logic), never firewalled here.
//
// The borderline terms also act as a VETO: if one is present, the entry is HELD even when a travel verb is
// also present ("going to the playground" stays, while "going to the park" does not). This is what keeps a
// school client's "Recess at school" and "going to the playground" untouched. Do NOT add playground / outside
// / recess / trampoline / water to the venue or travel lists — the tests enforce this.

// Location-dependent — never firewalled. Present -> HELD (vetoes the travel signal). Word-boundary matched.
const BORDERLINE_HOLD = ['playground', 'outside', 'recess', 'trampoline', 'water']

// Signal 1 — travel to a place.
const TRAVEL_WORDS = ['visiting', 'outing', 'outings', 'walk', 'walks'] // word-boundary
const TRAVEL_PHRASES = ['go to', 'going to', 'trip to'] // substring

// Signal 2 — a named public venue. Single words are word-boundary matched so "mall" ≠ "Small", "pool" ≠
// "carpool", "park" ≠ "parking". "movies" is INTENTIONALLY absent as a bare word (it would flag the
// deliverable "watching movies"); the outing form is covered by "the movies" / "movie theater" / "theater".
const VENUE_WORDS = ['beach', 'mall', 'park', 'pool', 'store', 'restaurant', 'zoo', 'arcade', 'theater']
const VENUE_PHRASES = ['the movies', 'movie theater', "family's house", 'family home', 'birthday party', 'birthday parties']

const wordHit = (s: string, words: string[]): boolean =>
  words.some((w) => new RegExp(`\\b${w}\\b`).test(s))
const subHit = (s: string, phrases: string[]): boolean =>
  phrases.some((p) => s.includes(p))

// True if `text` names a community outing / off-site destination the RBT cannot deliver in session.
// Case-insensitive. Borderline (on-site-or-not) activities return false — see the header.
export function isCommunityOuting(text: unknown): boolean {
  const s = String(text ?? '').toLowerCase().trim()
  if (!s) return false
  // Borderline VETO first: location-dependent, held even if a travel verb is present.
  if (wordHit(s, BORDERLINE_HOLD)) return false
  if (wordHit(s, VENUE_WORDS) || subHit(s, VENUE_PHRASES)) return true
  if (wordHit(s, TRAVEL_WORDS) || subHit(s, TRAVEL_PHRASES)) return true
  return false
}

export const COMMUNITY_OUTING_WARNING =
  "This looks like a community outing — somewhere the RBT can't take the client during a session. " +
  "Path4ABA notes never document outings as reinforcers, so if you add it, it won't appear in generated notes."
