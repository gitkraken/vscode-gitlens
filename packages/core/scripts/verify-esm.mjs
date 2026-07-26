// Load every bundled module under plain Node ESM.
//
// The published package keeps third-party dependencies external, so CJS->ESM interop is resolved by
// whatever loads it. Bundled hosts (webpack for the VS Code extension, esbuild for the package tests)
// bind named exports of a CommonJS dependency correctly, but Node's `cjs-module-lexer` only sees
// statically analyzable `exports.*` assignments — a named value import of an SDK that declares its
// exports through getters makes the importing module unlinkable, and nothing in the bundled builds
// notices. Importing each file here reproduces exactly what a Node ESM consumer does, including the
// lazily loaded modules a smoke test of the public entry points alone would never reach.

import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(dirname(scriptDir), 'dist');

async function collect(dir, files = []) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			await collect(path, files);
		} else if (entry.name.endsWith('.js')) {
			files.push(path);
		}
	}
	return files;
}

async function main() {
	const files = await collect(distDir);
	if (!files.length) {
		throw new Error(
			`No modules found in ${distDir} — run \`pnpm --filter @gitkraken/core-gitlens run bundle\` first.`,
		);
	}

	const failures = [];
	for (const file of files) {
		try {
			await import(pathToFileURL(file).href);
		} catch (ex) {
			failures.push([relative(distDir, file), `${ex?.name ?? 'Error'}: ${String(ex?.message).split('\n')[0]}`]);
		}
	}

	if (failures.length) {
		console.error(`[core-gitlens verify-esm] ${failures.length} of ${files.length} modules failed to load:`);
		for (const [file, message] of failures) {
			console.error(`  ${file}\n    ${message}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log(`[core-gitlens verify-esm] ${files.length} modules loaded`);
}

await main();
