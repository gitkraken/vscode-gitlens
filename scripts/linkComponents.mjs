import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { globSync } from 'glob';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const action = process.argv[2]; // 'link' | 'unlink'
const root = join(__dirname, '..');
const packageJsonPath = join(root, 'package.json');
const versionStateFile = join(root, '.gitkraken-components.version');

function getCurrentBranch(repoPath) {
	try {
		// Try normal branch first; fallback to detached HEAD short sha
		let branch = execSync('git rev-parse --abbrev-ref HEAD', {
			cwd: repoPath,
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'ignore'],
		}).trim();
		if (branch === 'HEAD') {
			branch = execSync('git rev-parse --short HEAD', {
				cwd: repoPath,
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'ignore'],
			}).trim();
		}
		return branch || 'unknown';
	} catch {
		return 'unknown';
	}
}

function findComponentsPaths() {
	const results = [];

	let parentRoot;
	try {
		const gitCommonDir = execSync('git rev-parse --git-common-dir', {
			cwd: root,
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'ignore'],
		}).trim();
		if (gitCommonDir === '.git') {
			parentRoot = join(root, '..');
		} else {
			parentRoot = join(gitCommonDir, '../..');
		}
	} catch {
		parentRoot = resolve(root, '..');
	}

	// Main repo
	const mainRoot = join(parentRoot, 'GitKrakenComponents');
	if (existsSync(join(mainRoot, 'package.json'))) {
		results.push({
			path: relative(root, mainRoot).replace(/\\/g, '/'),
			description: `${getCurrentBranch(mainRoot)} (default)`,
			abs: mainRoot,
		});
	}

	// Worktrees
	const worktreesRoot = join(parentRoot, 'GitKrakenComponents.worktrees');
	if (existsSync(worktreesRoot)) {
		try {
			const pkgs = globSync('**/package.json', { cwd: worktreesRoot, ignore: ['**/node_modules/**'] });
			for (const pkg of pkgs) {
				const dir = join(worktreesRoot, dirname(pkg));
				results.push({
					path: relative(root, dir).replace(/\\/g, '/'),
					description: `${getCurrentBranch(dir)} (worktree)`,
					abs: dir,
				});
			}
		} catch {}
	}

	return results.sort((a, b) => {
		if (a.description.includes('(default)')) return -1;
		if (b.description.includes('(default)')) return 1;
		return a.description.localeCompare(b.description);
	});
}

async function promptForPath() {
	// Check if path provided via environment variable or argument
	const envPath = process.env.GK_COMPONENTS_PATH;
	const argPath = process.argv[3];

	if (argPath) {
		console.log(`Using path from argument: ${argPath}`);
		return argPath;
	}

	if (envPath) {
		console.log(`Using path from GK_COMPONENTS_PATH: ${envPath}`);
		return envPath;
	}

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	const availablePaths = findComponentsPaths();
	if (!availablePaths.length) {
		console.log('\n⚠️ No GitKrakenComponents directories found.');
		const customPath = await rl.question('Enter path to GitKrakenComponents: ');
		rl.close();
		return customPath.trim() || '../GitKrakenComponents';
	}

	console.log('\n┌─ Select a GitKrakenComponents Path ───────────────────────────────────┐');
	console.log('│');
	for (let i = 0; i < availablePaths.length; i++) {
		const num = String(i + 1).padStart(2);
		const label = availablePaths[i].description;
		console.log(`│ ${num}. ${label}`);
	}
	const customNum = String(availablePaths.length + 1).padStart(2);
	console.log(`│ ${customNum}. Custom path`);
	console.log('│');
	console.log('└───────────────────────────────────────────────────────────────────────┘');

	const choice = await rl.question(`\nChoice [1-${availablePaths.length + 1}] (default: 1): `);

	let selectedPath;
	const trimmedChoice = choice.trim() || '1';
	const choiceNum = parseInt(trimmedChoice, 10);

	if (choiceNum > 0 && choiceNum <= availablePaths.length) {
		selectedPath = availablePaths[choiceNum - 1].path;
		console.log(`\n✓ ${availablePaths[choiceNum - 1].description}`);
	} else if (choiceNum === availablePaths.length + 1) {
		const customPath = await rl.question('\nEnter custom path: ');
		selectedPath = customPath.trim() || '../GitKrakenComponents';
		console.log(`\n✓ Custom: ${selectedPath}`);
	} else {
		selectedPath = availablePaths[0].path;
		console.log(`\n✓ ${availablePaths[0].description}`);
	}

	rl.close();
	return selectedPath;
}

try {
	if (!['link', 'unlink'].includes(action)) {
		console.error('Usage: node linkComponents.mjs [link|unlink] [path]');
		process.exit(1);
	}

	const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	const depSection = pkg.dependencies || {};

	if (action === 'link') {
		const targetPath = (await promptForPath()).replace(/\\/g, '/');
		const currentSpec = depSection['@gitkraken/gitkraken-components'];
		if (!currentSpec) {
			console.error('Dependency @gitkraken/gitkraken-components not found in package.json');
			process.exit(1);
		}

		// Save original version if not already saved
		if (!existsSync(versionStateFile)) {
			writeFileSync(versionStateFile, currentSpec, 'utf8');
		}

		console.log(`Linking @gitkraken/gitkraken-components -> file:${targetPath}`);
		execSync(`pnpm add @gitkraken/gitkraken-components@file:${targetPath}`, { stdio: 'inherit' });
		console.log('✓ Link complete');
		process.exit(0);
	}

	// unlink
	if (!existsSync(versionStateFile)) {
		console.error('No saved version found (dotfile missing). Cannot restore.');
		process.exit(1);
	}

	const originalVersion = readFileSync(versionStateFile, 'utf8').trim();
	if (!originalVersion) {
		console.error('Saved version file is empty. Aborting.');
		process.exit(1);
	}

	console.log(`Restoring @gitkraken/gitkraken-components to ${originalVersion}`);
	execSync(`pnpm add @gitkraken/gitkraken-components@${originalVersion}`, { stdio: 'inherit' });

	try {
		unlinkSync(versionStateFile);
	} catch {}
	console.log('✓ Unlink complete');
} catch (ex) {
	console.error('Error:', ex.message);
	process.exit(1);
}
