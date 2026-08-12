#!/usr/bin/env node
/**
 * Vendor packages/avatar-protocol/src into src/protocol/.
 *
 * The published SDK cannot depend on the private @avatar/protocol workspace package — the mirror
 * lane (scripts/mirror-avatar-client.sh) copies only packages/avatar-client to the public repo,
 * where a workspace dep would not resolve. So the protocol source is vendored verbatim (its
 * internal imports are all relative) with a GENERATED banner per file, and
 * test/protocol-sync.spec.ts fails CI whenever the copy drifts from the source of truth.
 *
 * In the public-repo mirror this script is inert: the source package does not exist there.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(__dirname, '..');
const SRC = resolve(PKG, '../avatar-protocol/src');
const DEST = resolve(PKG, 'src/protocol');

if (!existsSync(SRC)) {
  console.log('[sync-protocol] packages/avatar-protocol not present (standalone checkout) — nothing to sync');
  process.exit(0);
}

const BANNER = (rel) =>
  `// GENERATED from packages/avatar-protocol/src/${rel} — do not edit.\n` +
  `// Re-sync with: pnpm --filter @casola/avatar-client sync-protocol\n`;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

rmSync(DEST, { recursive: true, force: true });
let count = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  const out = join(DEST, rel);
  mkdirSync(dirname(out), { recursive: true });
  if (file.endsWith('.ts')) {
    writeFileSync(out, BANNER(rel) + readFileSync(file, 'utf8'));
  } else {
    copyFileSync(file, out);
  }
  count += 1;
}
console.log(`[sync-protocol] vendored ${count} files into src/protocol/`);
