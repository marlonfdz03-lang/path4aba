// Typed surface for the shared intervention parser.
//
// The implementation lives in lib/extractInterventions.impl.js as PLAIN JS, because it is copied verbatim into
// extension/extract-interventions.js — a classic browser script that cannot carry type annotations. This file
// declares the signature callers see; lib/extractInterventionsParity.test.mjs proves the copy has not drifted.
import { extractInterventions as _extractInterventions } from './extractInterventions.impl.js';

export const extractInterventions: (noteText: string) => string[] =
  _extractInterventions as (noteText: string) => string[];
