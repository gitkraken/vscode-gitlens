import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '..', '..');
const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';

await rm(join(packageRoot, 'dist'), { recursive: true, force: true });
execFileSync(tsc, ['-b', 'tsconfig.build.json', '--force'], { cwd: packageRoot, stdio: 'inherit' });
await cp(join(repoRoot, 'LICENSE'), join(packageRoot, 'LICENSE'));
