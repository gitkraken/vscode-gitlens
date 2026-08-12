//@ts-check
import { spawnSync } from 'child_process';

if (process.env.GL_SKIP_BUNDLE) {
	console.log('Skipping bundle because GL_SKIP_BUNDLE is set');
	process.exit(0);
}

const result = spawnSync('pnpm run bundle', { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
