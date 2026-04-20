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

const versionRegex = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const tagPrefix = 'v'; //'releases/ext/v';

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
let data = await readFile(changelogPath, 'utf8');

// Find the current version number (accepts either old `v` or new `releases/ext/v` form during the migration window)
const match =
	/\[unreleased\]: https:\/\/github\.com\/gitkraken\/vscode-gitlens\/compare\/(?:releases\/ext\/v|v)(.+)\.\.\.HEAD/.exec(
		data,
	);
let currentVersion = match?.[1];
if (currentVersion == null || versionRegex.test(currentVersion) === false) {
	console.error('Unable to find current version number.');
	currentVersion = '0.0.0';
}

// Create readline interface for getting input from user
const rl = createInterface({
	// @ts-ignore
	input: process.stdin,
	// @ts-ignore
	output: process.stdout,
});

// Ask for new version number
rl.question(`Enter the new version number (format x.x.x, current is ${currentVersion}): `, async version => {
	// Validate the version input
	if (!versionRegex.test(version)) {
		console.error(
			'Invalid version number. Please use the format x.y.z where x, y, and z are positive numbers no greater than 4 digits.',
		);
		rl.close();
		process.exitCode = 1;
		return;
	}
	rl.close();

	// Preflight: the CHANGELOG compare URL for the new entry references the previous version
	// (<tagPrefix><prev>). Verify that tag exists on origin; otherwise the generated GitHub
	// compare link will 404.
	try {
		const { stdout } = await execFileAsync('git', [
			'ls-remote',
			'--tags',
			'origin',
			`refs/tags/${tagPrefix}${currentVersion}`,
		]);
		if (!stdout.trim()) {
			console.error(
				`\nExpected tag '${tagPrefix}${currentVersion}' not found on origin.\n` +
					`The CHANGELOG compare URL for the new release would 404.\n\n` +
					`Create or restore the tag, then rerun. If switching tag prefixes, bridge from the prior tag:\n` +
					`    git tag ${tagPrefix}${currentVersion} <prior-tag-for-v${currentVersion}>\n` +
					`    git push origin ${tagPrefix}${currentVersion}`,
			);
			process.exitCode = 1;
			return;
		}
	} catch (err) {
		console.error(`Unable to verify tag exists on origin: ${err}`);
		process.exitCode = 1;
		return;
	}

	// Get today's date
	const today = new Date();
	const yyyy = today.getFullYear();
	const mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
	const dd = String(today.getDate()).padStart(2, '0');

	const newVersionHeader = `## [Unreleased]\n\n## [${version}] - ${yyyy}-${mm}-${dd}`;
	const newVersionLink = `[${version}]: https://github.com/gitkraken/vscode-gitlens/compare/${tagPrefix}${currentVersion}...gitkraken:${tagPrefix}${version}`;

	// Add the new version header below the ## [Unreleased] header
	data = data.replace('## [Unreleased]', newVersionHeader);

	if (match == null) {
		// Add the [unreleased]: line
		data += `\n[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/${tagPrefix}${version}...HEAD`;
	} else {
		const unreleasedLink = match[0].replace(
			/\/compare\/(?:releases\/ext\/v|v)(.+?)\.\.\.HEAD/,
			`/compare/${tagPrefix}${version}...HEAD`,
		);

		// Update the [unreleased]: line
		data = data.replace(match[0], `${unreleasedLink}\n${newVersionLink}`);
	}

	// Writing the updated version data to CHANGELOG
	await writeFile(changelogPath, data);

	// Stage CHANGELOG so pnpm version's commit picks it up alongside package.json.
	try {
		await execFileAsync('git', ['add', 'CHANGELOG.md']);
	} catch (err) {
		console.error(`Unable to stage CHANGELOG.md: ${err}`);
		process.exitCode = 1;
		return;
	}

	// Call 'pnpm version' to commit and create the tag
	// --tag-version-prefix tells pnpm/npm to use `tagPrefix` instead of the default 'v'.
	try {
		const { stdout, stderr } = await execFileAsync('pnpm', [
			'version',
			version,
			`--tag-version-prefix=${tagPrefix}`,
			'-m',
			'Bumps to v%s',
			'-f',
		]);
		if (stdout) process.stdout.write(stdout);
		if (stderr) process.stderr.write(stderr);
	} catch (err) {
		console.error(`'pnpm version' failed: ${err}`);
		process.exitCode = 1;
		return;
	}

	console.log(`${version} is ready for release.`);
	console.log(`Next: git push --follow-tags`);
});
