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
const engineRoot = path.join(repoRoot, 'packages', 'plus', 'commit-graph');
const uiRoot = path.join(repoRoot, 'packages', 'plus', 'commit-graph-ui');
const enginePackageJsonPath = path.join(engineRoot, 'package.json');
const uiPackageJsonPath = path.join(uiRoot, 'package.json');
const changelogPath = path.join(uiRoot, 'CHANGELOG.md');

const versionRegex = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]+)?$/;

const currentVersion = await readVersion(enginePackageJsonPath);
const currentUiVersion = await readVersion(uiPackageJsonPath);
if (currentVersion !== currentUiVersion) {
	console.error(
		`@gitkraken/commit-graph (${currentVersion}) and @gitkraken/commit-graph-ui (${currentUiVersion}) must have the same version before a release.`,
	);
	process.exit(1);
}

const previousTag = await findPreviousTag();

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
		`Enter the new commit graph version (x.y.z, x.y.z-pre.N, or patch/minor/major; current is ${currentVersion}${
			previousTag == null ? ', unreleased — enter it to release it as is' : ''
		}): `,
	);
	rl.close();
	await prepRelease(answer.trim());
}

/** @param {string} spec */
async function prepRelease(spec) {
	if (spec !== 'patch' && spec !== 'minor' && spec !== 'major' && !versionRegex.test(spec)) {
		console.error(`Invalid version "${spec}". Use x.y.z, x.y.z-<prerelease>, or one of: patch, minor, major.`);
		process.exitCode = 1;
		return;
	}

	let newVersion = currentVersion;
	if (spec !== currentVersion) {
		if (!(await bumpVersion(engineRoot, spec))) return;

		newVersion = await readVersion(enginePackageJsonPath);
		if (!(await bumpVersion(uiRoot, newVersion))) return;
	} else if (previousTag != null) {
		console.error(`v${currentVersion} is already released (${previousTag}); pick a new version.`);
		process.exitCode = 1;
		return;
	}

	await updateChangelog(newVersion);

	const tag = `releases/commit-graph/v${newVersion}`;
	const message = `Bumps commit graph to v${newVersion}`;
	try {
		await execFileAsync('git', ['add', changelogPath, enginePackageJsonPath, uiPackageJsonPath], {
			cwd: repoRoot,
		});
		await execFileAsync('git', ['commit', '-m', message], { cwd: repoRoot });
		await execFileAsync('git', ['tag', '-m', message, tag], { cwd: repoRoot });
	} catch (err) {
		console.error(`Unable to commit/tag release: ${describeError(err)}`);
		process.exitCode = 1;
		return;
	}

	console.log(`\ncommit graph v${newVersion} is ready for release.`);
	console.log(`\nNext: git push --follow-tags`);
}

/**
 * @param {string} cwd
 * @param {string} spec
 * @returns {Promise<boolean>}
 */
async function bumpVersion(cwd, spec) {
	try {
		const { stdout, stderr } = await execFileAsync(
			'pnpm',
			['version', spec, '--no-git-tag-version', '--no-git-checks'],
			{ cwd: cwd },
		);
		if (stdout) process.stdout.write(stdout);
		if (stderr) process.stderr.write(stderr);
		return true;
	} catch (err) {
		console.error(`'pnpm version' failed in ${path.relative(repoRoot, cwd)}: ${describeError(err)}`);
		process.exitCode = 1;
		return false;
	}
}

/** @param {string} packageJsonPath */
async function readVersion(packageJsonPath) {
	return /** @type {string} */ (JSON.parse(await readFile(packageJsonPath, 'utf8')).version);
}

/** @returns {Promise<string | undefined>} */
async function findPreviousTag() {
	const tag = `releases/commit-graph/v${currentVersion}`;
	try {
		await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: repoRoot });
		return tag;
	} catch {
		return undefined;
	}
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
	let data = await readFile(changelogPath, 'utf8');

	const today = new Date();
	const yyyy = today.getFullYear();
	const mm = String(today.getMonth() + 1).padStart(2, '0');
	const dd = String(today.getDate()).padStart(2, '0');

	const newVersionHeader = `## [Unreleased]\n\n## [${newVersion}] - ${yyyy}-${mm}-${dd}`;
	const newVersionLink =
		previousTag == null
			? `[${newVersion}]: https://github.com/gitkraken/vscode-gitlens/releases/tag/releases/commit-graph/v${newVersion}`
			: `[${newVersion}]: https://github.com/gitkraken/vscode-gitlens/compare/releases/commit-graph/v${currentVersion}...gitkraken:releases/commit-graph/v${newVersion}`;

	data = data.replace('## [Unreleased]', newVersionHeader);

	const unreleasedRegex =
		/^\[unreleased\]: https:\/\/github\.com\/gitkraken\/vscode-gitlens\/compare\/releases\/commit-graph\/v(.+?)\.\.\.HEAD$/m;
	const newUnreleased = `[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/releases/commit-graph/v${newVersion}...HEAD`;
	const unreleasedMatch = unreleasedRegex.exec(data);
	if (unreleasedMatch) {
		data = data.replace(unreleasedMatch[0], `${newUnreleased}\n${newVersionLink}`);
	} else {
		data = `${data.trimEnd()}\n\n${newUnreleased}\n${newVersionLink}\n`;
	}

	await writeFile(changelogPath, data);
}
