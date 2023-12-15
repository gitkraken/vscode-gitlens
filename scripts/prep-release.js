const { exec } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const versionRegex = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
console.log(changelogPath);
let data = fs.readFileSync(changelogPath, 'utf8');

// Find the current version number
const match = /\[unreleased\]: https:\/\/github\.com\/gitkraken\/vscode-gitlens\/compare\/v(.+)\.\.\.HEAD/.exec(data);
const currentVersion = match?.[1];
if (currentVersion == null || versionRegex.test(currentVersion) === false) {
	console.error('Unable to find current version number.');
	return;
}

// Create readline interface for getting input from user
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

// Ask for new version number
rl.question(`Enter the new version number (format x.x.x, current is ${currentVersion}): `, function (version) {
	// Validate the version input
	if (!versionRegex.test(version)) {
		console.error(
			'Invalid version number. Please use the format x.y.z where x, y, and z are positive numbers no greater than 4 digits.',
		);
		rl.close();
		return;
	}

	// Get today's date
	const today = new Date();
	const yyyy = today.getFullYear();
	const mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
	const dd = String(today.getDate()).padStart(2, '0');

	const newVersionHeader = `## [Unreleased]\n\n## [${version}] - ${yyyy}-${mm}-${dd}`;
	const newVersionLink = `[${version}]: https://github.com/gitkraken/vscode-gitlens/compare/v${currentVersion}...gitkraken:v${version}`;

	// Add the new version header below the ## [Unreleased] header
	data = data.replace('## [Unreleased]', newVersionHeader);

	const unreleasedLink = match[0].replace(/\/compare\/v(.+?)\.\.\.HEAD/, `/compare/v${version}...HEAD`);

	// Update the [unreleased]: line
	data = data.replace(match[0], `${unreleasedLink}\n${newVersionLink}`);

	// Writing the updated version data to CHANGELOG
	fs.writeFileSync(changelogPath, data);

	// Stage CHANGELOG
	exec('git add CHANGELOG.md', err => {
		if (err) {
			console.error(`Unable to stage CHANGELOG.md: ${err}`);
			return;
		}

		// Call 'yarn version' to commit and create the tag
		exec(`yarn version --new-version ${version}`, err => {
			if (err) {
				console.error(`'yarn version' failed: ${err}`);
				return;
			}

			console.log(`${version} is ready for release.`);
		});
	});

	rl.close();
});
