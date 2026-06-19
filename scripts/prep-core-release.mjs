//@ts-check
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, '..');
const coreRoot = path.join(repoRoot, 'packages', 'core');
const corePackageJsonPath = path.join(coreRoot, 'package.json');
const coreChangelogPath = path.join(coreRoot, 'CHANGELOG.md');

const versionRegex = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]+)?$/;

const currentVersion = JSON.parse(await readFile(corePackageJsonPath, 'utf8')).version;

const rl = createInterface({
	// @ts-ignore
	input: process.stdin,
	// @ts-ignore
	output: process.stdout,
});

rl.question(
	`Enter the new core version (format x.y.z or x.y.z-pre.N, current is ${currentVersion}): `,
	async version => {
		if (!versionRegex.test(version)) {
			console.error('Invalid version number. Use x.y.z or x.y.z-<prerelease>.');
			rl.close();
			process.exitCode = 1;
			return;
		}
		rl.close();

		// Update CHANGELOG.md: insert new section under [Unreleased], refresh unreleased link, add compare link.
		await updateChangelog(version);

		// `pnpm version` would otherwise abort on the dirty tree (we just edited CHANGELOG.md) and
		// then create its own commit + tag (e.g. `0.3.1` / `v0.3.1`). We only want it to rewrite
		// package.json's version: `--no-git-checks` skips the clean-tree check and
		// `--no-git-tag-version` skips the commit/tag, so we stage, commit, and tag manually below.
		try {
			const { stdout, stderr } = await execFileAsync(
				'pnpm',
				['version', version, '--no-git-tag-version', '--no-git-checks'],
				{ cwd: coreRoot },
			);
			if (stdout) process.stdout.write(stdout);
			if (stderr) process.stderr.write(stderr);
		} catch (err) {
			console.error(`'pnpm version' failed: ${err}`);
			process.exitCode = 1;
			return;
		}

		const tag = `releases/core/v${version}`;
		const message = `Bumps core to v${version}`;
		try {
			await execFileAsync('git', ['add', coreChangelogPath, corePackageJsonPath], { cwd: repoRoot });
			await execFileAsync('git', ['commit', '-m', message], { cwd: repoRoot });
			await execFileAsync('git', ['tag', '-m', message, tag], { cwd: repoRoot });
		} catch (err) {
			console.error(`Unable to commit/tag release: ${err}`);
			process.exitCode = 1;
			return;
		}

		console.log(`\ncore v${version} is ready for release.`);
		console.log(`\nNext: git push --follow-tags`);
	},
);

/** @param {string} newVersion */
async function updateChangelog(newVersion) {
	let data = await readFile(coreChangelogPath, 'utf8');

	const today = new Date();
	const yyyy = today.getFullYear();
	const mm = String(today.getMonth() + 1).padStart(2, '0');
	const dd = String(today.getDate()).padStart(2, '0');

	const newVersionHeader = `## [Unreleased]\n\n## [${newVersion}] - ${yyyy}-${mm}-${dd}`;
	const newVersionLink = `[${newVersion}]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v${currentVersion}...gitkraken:releases/core/v${newVersion}`;

	data = data.replace('## [Unreleased]', newVersionHeader);

	const unreleasedRegex =
		/^\[unreleased\]: https:\/\/github\.com\/gitkraken\/vscode-gitlens\/compare\/releases\/core\/v(.+?)\.\.\.HEAD$/m;
	const unreleasedMatch = unreleasedRegex.exec(data);
	if (unreleasedMatch) {
		const newUnreleased = `[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v${newVersion}...HEAD`;
		data = data.replace(unreleasedMatch[0], `${newUnreleased}\n${newVersionLink}`);
	} else {
		data += `\n[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v${newVersion}...HEAD\n${newVersionLink}\n`;
	}

	await writeFile(coreChangelogPath, data);
}
