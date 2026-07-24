//@ts-check
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, '..');
const coreRoot = path.join(repoRoot, 'packages', 'core');
const corePackageJsonPath = path.join(coreRoot, 'package.json');
const coreChangelogPath = path.join(coreRoot, 'CHANGELOG.md');

const versionRegex = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]+)?$/;

const currentVersion = JSON.parse(await readFile(corePackageJsonPath, 'utf8')).version;

// Accept the version as the first CLI argument (e.g. `pnpm prep-core-release 0.3.1` or
// `pnpm prep-core-release patch`); otherwise prompt for it interactively.
const argSpec = process.argv[2]?.trim();
if (argSpec) {
	await prepRelease(argSpec);
} else {
	const rl = createInterface({
		// @ts-ignore
		input: process.stdin,
		// @ts-ignore
		output: process.stdout,
	});
	const answer = await rl.question(
		`Enter the new core version (x.y.z, x.y.z-pre.N, or patch/minor/major; current is ${currentVersion}): `,
	);
	rl.close();
	await prepRelease(answer.trim());
}

/**
 * Bumps packages/core to `spec`, updates its CHANGELOG, then commits and tags the release.
 * @param {string} spec A concrete version (x.y.z / x.y.z-pre.N) or a `patch`/`minor`/`major` keyword.
 */
async function prepRelease(spec) {
	if (spec !== 'patch' && spec !== 'minor' && spec !== 'major' && !versionRegex.test(spec)) {
		console.error(`Invalid version "${spec}". Use x.y.z, x.y.z-<prerelease>, or one of: patch, minor, major.`);
		process.exitCode = 1;
		return;
	}

	// Bump package.json's version first so `pnpm version` resolves `spec` — whether a concrete
	// version or a `patch`/`minor`/`major` keyword — letting us read the result back for the
	// changelog, commit message, and tag. `--no-git-tag-version` stops pnpm from making its own
	// commit + tag (e.g. `0.3.1` / `v0.3.1`) and `--no-git-checks` lets it run on a non-clean tree;
	// we stage, commit, and tag manually below so the version bump and changelog land together.
	try {
		const { stdout, stderr } = await execFileAsync(
			'pnpm',
			['version', spec, '--no-git-tag-version', '--no-git-checks'],
			{ cwd: coreRoot },
		);
		if (stdout) process.stdout.write(stdout);
		if (stderr) process.stderr.write(stderr);
	} catch (err) {
		console.error(`'pnpm version' failed: ${describeError(err)}`);
		process.exitCode = 1;
		return;
	}

	const newVersion = JSON.parse(await readFile(corePackageJsonPath, 'utf8')).version;

	// Update CHANGELOG.md: insert new section under [Unreleased], refresh unreleased link, add compare link.
	await updateChangelog(newVersion);

	const tag = `releases/core/v${newVersion}`;
	const message = `Bumps core to v${newVersion}`;
	try {
		await execFileAsync('git', ['add', coreChangelogPath, corePackageJsonPath], { cwd: repoRoot });
		await execFileAsync('git', ['commit', '-m', message], { cwd: repoRoot });
		await execFileAsync('git', ['tag', '-m', message, tag], { cwd: repoRoot });
	} catch (err) {
		console.error(`Unable to commit/tag release: ${describeError(err)}`);
		process.exitCode = 1;
		return;
	}

	console.log(`\ncore v${newVersion} is ready for release.`);
	console.log(`\nNext: git push --follow-tags`);
}

/** @param {unknown} err */
function describeError(err) {
	if (err != null && typeof err === 'object') {
		const e = /** @type {{ stderr?: string; stdout?: string; message?: string }} */ (err);
		const detail = e.stderr?.trim() || e.stdout?.trim() || e.message;
		if (detail) return detail;
	}
	return String(err);
}

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
