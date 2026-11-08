/**
 * Production build: bundles the server into dist/index.js and the migrator into dist/migrate.js.
 *
 * Workspace packages (@stagehand/*) are shipped as TypeScript source, so they are inlined.
 * Every other runtime dependency stays external and is installed into the image's
 * node_modules (by `pnpm deploy --prod`), which keeps native and worker-thread packages
 * (pino transports now; sharp, pg-boss later) working as their authors intended.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

interface PackageJson {
  dependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageJson;
const external = Object.keys(pkg.dependencies ?? {}).filter(
  (name) => !name.startsWith('@stagehand/'),
);

await build({
  absWorkingDir: packageDir,
  // dist/index.js: the server. dist/migrate.js: the one-shot migration runner.
  entryPoints: { index: 'src/index.ts', migrate: 'src/migrate-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  // Bare `pkg/subpath` imports must be external too, not just the package root.
  external: external.flatMap((name) => [name, `${name}/*`]),
  logLevel: 'info',
});
