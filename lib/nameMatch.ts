// Typed surface for the shared name matcher.
//
// The implementation lives in lib/nameMatch.impl.js as PLAIN JS, because it is copied verbatim
// into extension/name-match.js — a classic browser script that cannot carry type annotations.
// Splitting them keeps the port possible without suppressing type checking anywhere: this file
// is fully checked, and it declares every signature callers see. lib/nameMatchParity.test.mjs
// proves the copy has not drifted.
//
// See lib/nameMatch.impl.js for the failure class this replaces and the tier definitions.
import {
  normName as _normName,
  stripOuterQuotes as _stripOuterQuotes,
  matchWords as _matchWords,
  acronymsOf as _acronymsOf,
  sharedAcronym as _sharedAcronym,
  TIERS as _TIERS,
  namesMatch as _namesMatch,
  canonicalName as _canonicalName,
  resolveName as _resolveName,
  buildVariantIndex as _buildVariantIndex,
} from './nameMatch.impl.js';

export type MatchTier = 'strict' | 'shared2' | 'loose';
export type VariantIndex = Record<string, string>;
export interface MatchOptions {
  /** Normalized-name -> canonical-key map from buildVariantIndex(). Positive only. */
  variantIndex?: VariantIndex;
}
export interface LibraryRow {
  canonical_key?: string;
  canonicalKey?: string;
  display_name?: string;
  displayName?: string;
  variants?: string[];
}

export const normName: (s: unknown) => string = _normName;
export const stripOuterQuotes: (s: unknown) => string = _stripOuterQuotes;
export const matchWords: (normalized: string) => string[] = _matchWords;
export const acronymsOf: (s: unknown) => string[] = _acronymsOf;
export const sharedAcronym: (a: unknown, b: unknown) => string | null = _sharedAcronym;
export const TIERS: readonly MatchTier[] = _TIERS as readonly MatchTier[];
export const namesMatch: (a: unknown, b: unknown, tier: MatchTier, options?: MatchOptions) => boolean = _namesMatch;
export const canonicalName: (incoming: string, existingNames: readonly string[], tier: MatchTier, options?: MatchOptions) => string = _canonicalName;
export const resolveName: (name: string, pool: readonly string[], tier: MatchTier, options?: MatchOptions) => { resolvedName: string; matched: boolean } = _resolveName;
export const buildVariantIndex: (rows: readonly LibraryRow[] | null | undefined) => VariantIndex =
  _buildVariantIndex as (rows: readonly LibraryRow[] | null | undefined) => VariantIndex;
