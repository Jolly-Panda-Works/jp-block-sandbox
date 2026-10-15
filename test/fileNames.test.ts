import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Windows and macOS file systems ignore letter case: "particles.ts" and "Particles.tsx" in one folder make
 * `import './Particles'` load the wrong file there ("does not provide an export named …"), while it works on
 * Linux. Keep module names unique regardless of case.
 */
test('no two modules in a folder differ only by letter case', () => {
  const clashes: string[] = [];
  const walk = (dir: string) => {
    const seen = new Map<string, string>();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'node_modules' || name.startsWith('.')) continue;
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
      const base = name.replace(/\.[^.]+$/, '').toLowerCase();
      if (seen.has(base)) clashes.push(`${join(dir, seen.get(base)!)} <-> ${full}`);
      else seen.set(base, name);
    }
  };
  walk(fileURLToPath(new URL('../src', import.meta.url)));
  walk(fileURLToPath(new URL('../shared/src', import.meta.url)));
  assert.deepEqual(clashes, []);
});
