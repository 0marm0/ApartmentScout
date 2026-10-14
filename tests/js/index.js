// Entry point so `node --test tests/js` runs every *.test.mjs in this folder (Node resolves the folder to this file).
import fs from 'node:fs';
const here = new URL('.', import.meta.url);
for (const f of fs.readdirSync(here).filter((n) => n.endsWith('.test.mjs')).sort()) await import(new URL(f, here));
