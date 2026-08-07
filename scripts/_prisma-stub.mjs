// Stub for @/lib/prisma when running the proof harness. lib/assessmentPipeline.ts imports prisma at
// module level (for saveKnowledgeBase), but the harness NEVER touches the DB — so we avoid loading the
// heavy generated Prisma client (whose extensionless TS imports plain node can't resolve). If any code
// path actually reaches for prisma here, this throws loudly rather than silently hitting a DB.
export const prisma = new Proxy(
  {},
  { get() { throw new Error('prisma is stubbed in proveAssessmentRefresh — the harness must not touch the DB'); } },
);
