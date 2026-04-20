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

		// Stage CHANGELOG — the pnpm version command below commits package.json automatically;
		// we amend the staged CHANGELOG into that same commit via -m / -f flags.
		try {
			await execFileAsync('git', ['add', coreChangelogPath], { cwd: repoRoot });
		} catch (err) {
			console.error(`Unable to stage CHANGELOG.md: ${err}`);
			process.exitCode = 1;
			return;
		}

		// pnpm version runs in packages/core/ so packages/core/.npmrc's tag-version-prefix=releases/core/v
		// is picked up automatically. -m = commit message template, -f = force even with staged changes.
		try {
			const { stdout, stderr } = await execFileAsync(
				'pnpm',
				['--filter', '@gitkraken/core-gitlens', 'version', version, '-m', 'Bumps core to v%s', '-f'],
				{ cwd: repoRoot },
			);
			if (stdout) process.stdout.write(stdout);
			if (stderr) process.stderr.write(stderr);
		} catch (err) {
			console.error(`'pnpm version' failed: ${err}`);
			process.exitCode = 1;
			return;
		}

		console.log(`\ncore v${version} is ready for release.`);
		console.log(`\nNext: git push --follow-tags`);
	},
);

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
