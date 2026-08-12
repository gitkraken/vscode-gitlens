//@ts-check
import { spawnSync } from 'child_process';
import fs from 'fs';
import { generateForksReadme } from './generateForksReadme.mjs';

const original = fs.readFileSync('./README.md', { encoding: 'utf8' });

try {
	fs.writeFileSync('./README.md', generateForksReadme(original));

	/** @type {{ name: string; version: string }} */
	const pkg = JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf8' }));

	const args = ['pnpm', 'vsce', 'package', '--no-dependencies', '--out', `${pkg.name}-${pkg.version}-forks.vsix`];
	if (process.argv.slice(2).includes('--pre-release')) {
		args.push('--pre-release');
	}

	// Joined into one command rather than passed as an args array, which `shell: true` deprecates (DEP0190)
	const result = spawnSync(args.join(' '), {
		stdio: 'inherit',
		shell: true,
		env: { ...process.env, GL_SKIP_BUNDLE: '1' },
	});

	// Set (not `process.exit()`) so the `finally` below still runs before the process exits.
	process.exitCode = result.status ?? 1;
} finally {
	fs.writeFileSync('./README.md', original);
}
