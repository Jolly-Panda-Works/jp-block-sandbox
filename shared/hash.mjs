// Prints a hash of shared/src so the client and server copies can be compared (`npm run shared:hash`).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = new URL('./src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const h = createHash('sha256');
for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts')).sort()) {
  h.update(f);
  h.update(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'));
}
console.log(`shared/src ${h.digest('hex').slice(0, 16)}`);
