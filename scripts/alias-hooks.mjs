// Node module hooks for the proof harness: (1) resolve the project's `@/*` TS path alias + extensionless
// TS imports, and (2) transpile .ts/.tsx with the real TypeScript compiler. We can't rely on Node's
// built-in type-stripping because the app's prod files use `import { SomeType }` (not `import type`), which
// stripping leaves as a runtime import and crashes; tsc's per-file import elision handles it correctly.
// Registered from proveAssessmentRefresh.mjs via module.register. Dev-tooling only — never used by the app.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = new URL('../', import.meta.url); // scripts/ -> project root
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json'];

// Modules the harness must NOT really load (DB client) — redirect to a stub. The harness never uses them.
const OVERRIDES = { '@/lib/prisma': new URL('./_prisma-stub.mjs', import.meta.url).href };

export async function resolve(specifier, context, next) {
  if (OVERRIDES[specifier]) return next(OVERRIDES[specifier], context);

  // @/* -> project root; probe extensions (TS imports are extensionless).
  if (specifier.startsWith('@/')) {
    const baseHref = new URL(specifier.slice(2), ROOT).href;
    return next(withExt(baseHref), context);
  }
  // Relative extensionless TS imports (e.g. ./enums) — add the extension so Node can find them.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const baseHref = new URL(specifier, context.parentURL).href;
    const resolved = withExt(baseHref);
    if (resolved !== baseHref) return next(resolved, context);
  }
  return next(specifier, context);
}

function withExt(baseHref) {
  const basePath = fileURLToPath(baseHref);
  if (existsSync(basePath)) return baseHref;
  const direct = EXTS.map((e) => [basePath + e, baseHref + e]).find(([f]) => existsSync(f));
  if (direct) return direct[1];
  const index = EXTS.map((e) => [`${basePath}/index${e}`, `${baseHref}/index${e}`]).find(([f]) => existsSync(f));
  return index ? index[1] : baseHref;
}

export async function load(url, context, next) {
  if (/\.tsx?(\?|$)/.test(url)) {
    const src = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve,
        esModuleInterop: true,
        verbatimModuleSyntax: false, // let tsc elide type-only imports it detects per-file
      },
      fileName: fileURLToPath(url),
    });
    return { format: 'module', shortCircuit: true, source: outputText };
  }
  return next(url, context);
}
