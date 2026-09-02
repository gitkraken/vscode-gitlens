import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	assertNoWorkspaceSpecifiers,
	bundleForBrowser,
	verifyPackedPackage,
} from '../../../../scripts/package/verifyPackage.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '..', '..', '..');

await verifyPackedPackage({
	tempPrefix: 'commit-graph-consumer-',
	repoRoot,
	packages: [
		{
			root: packageRoot,
			scope: '@gitkraken',
			name: 'commit-graph',
			// One entrypoint per shape in the exports map — attw skips wildcard entries unless they are
			// named, and `./theme.css` has no types to resolve.
			publishGates: {
				attwEntrypoints: [
					'./zones.js',
					'./lanes/colors.js',
					'./wip/nearest.js',
					'./engine/session.js',
					'./engine/types.js',
				],
			},
		},
	],
	beforeTsc: ({ consumerDir }) =>
		assertNoWorkspaceSpecifiers(
			join(consumerDir, 'node_modules', '@gitkraken', 'commit-graph'),
			'Packed @gitkraken/commit-graph',
		),
	compilerOptions: { lib: ['DOM', 'ES2023'] },
	sources: {
		'src/contract.ts':
			`import { CommitGraphEngineSession } from '@gitkraken/commit-graph/engine/session.js';\n` +
			`import type { GraphCommit } from '@gitkraken/commit-graph/engine/types.js';\n` +
			`const rows: GraphCommit[] = [{ sha: 'a', shortSha: 'a', message: 'A', author: 'A', authorEmail: '', date: 1, parents: [], kind: 'commit' }];\n` +
			`const session = new CommitGraphEngineSession<GraphCommit, GraphCommit>();\n` +
			`export const state = session.update({ identity: 'external', sourceRows: rows, toCommit: row => row });\n`,
		'src/run.mjs':
			`import { readFile } from 'node:fs/promises';\n` +
			`import { fileURLToPath } from 'node:url';\n` +
			`import { CommitGraphEngineSession } from '@gitkraken/commit-graph/engine/session.js';\n` +
			`const row = { sha: 'a', shortSha: 'a', message: 'A', author: 'A', authorEmail: '', date: 1, parents: [], kind: 'commit' };\n` +
			`const state = new CommitGraphEngineSession().update({ identity: 'external', sourceRows: [row], toCommit: value => value });\n` +
			`if (state.transition.kind !== 'initial' || state.rows.length !== 1) throw new Error('engine contract failed');\n` +
			`const theme = await readFile(fileURLToPath(import.meta.resolve('@gitkraken/commit-graph/theme.css')), 'utf8');\n` +
			`if (!theme.includes('--brand:')) throw new Error('theme export failed');\n`,
	},
	// No tree-shaking check here (unlike the sibling packages) — this consumer only proves the engine bundles
	// and runs for the browser, not which parts of it a real profile would keep.
	verify: ({ repoRoot, consumerDir }) => {
		bundleForBrowser(repoRoot, consumerDir, 'src/contract.ts', 'browser.js', { treeShaking: false });
		execFileSync(process.execPath, ['src/run.mjs'], { cwd: consumerDir, stdio: 'inherit' });
	},
	successMessage:
		'[commit-graph verify-package] packed TypeScript, browser bundle, runtime, and theme consumer passed',
});
