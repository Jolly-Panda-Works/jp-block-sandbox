import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

/**
 * Every relative import must point at a file that exists WITH THE SAME LETTER CASE.
 * Catches "Failed to resolve import …" (a file missing from a commit) before `vite build` does, and
 * case mistakes that only break on Linux CI (or only on Windows/macOS).
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const files: string[] = [];
const walk = (dir: string) => {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (n === 'node_modules' || n.startsWith('.')) continue;
    if (statSync(f).isDirectory()) walk(f);
    else if (/\.(ts|tsx)$/.test(n)) files.push(f);
  }
};
for (const d of ['src', 'shared/src', 'dev-server']) if (existsSync(join(root, d))) walk(join(root, d));

const existsExact = (p: string) => existsSync(p) && readdirSync(dirname(p)).includes(basename(p));

test('every relative import resolves to an existing file (exact letter case)', () => {
  const missing: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = join(dirname(f), m[1]);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx')];
      if (!candidates.some(existsExact)) missing.push(`${f.slice(root.length)} → ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `missing files:\n${missing.join('\n')}`);
});
