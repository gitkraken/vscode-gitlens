//@ts-check
import * as fs from 'fs';
import * as path from 'path';
import * as checker from 'license-checker-rseidelsohn';
import { getBundledPackageDirs } from './workspace.mjs';

/** @typedef { { licenses: string; repository: string; licenseFile: string } } PackageInfo **/

/**
 * @param { { [key: string]: PackageInfo } } packages
 */
async function generateThirdpartyNotices(packages) {
	/**
	 *	@type [string, PackageInfo][]
	 */
	const codeOnlyPackages = [
		[
			'microsoft/vscode',
			{
				licenses: 'MIT',
				repository: 'https://github.com/microsoft/vscode',
				licenseFile: 'https://raw.githubusercontent.com/microsoft/vscode/refs/heads/main/LICENSE.txt',
			},
		],
	];

	const packageOutputs = [];
	const licenseOutputs = [];

	let count = 0;
	for (const [key, data] of Object.entries(packages)
		.concat(codeOnlyPackages)
		.sort(([a], [b]) => a.localeCompare(b))) {
		let name;
		let version;

		const index = key.lastIndexOf('@');
		if (index !== -1) {
			name = key.substring(0, index);
			version = key.substring(index + 1);
		} else {
			name = key;
		}

		if (name === 'gitlens' || name.startsWith('@gitkraken') || name.startsWith('@gitlens/')) continue;
		if (data.licenseFile == null) continue;

		let license;
		if (data.licenseFile.startsWith('https://')) {
			const response = await fetch(data.licenseFile, { method: 'GET' });
			// Without this, an error page's body is embedded verbatim as the licence text.
			if (!response.ok) {
				throw new Error(`Failed to fetch ${data.licenseFile}: ${response.status} ${response.statusText}`);
			}
			license = await response.text();
		} else {
			license = fs.readFileSync(data.licenseFile, 'utf8');
		}
		license = license.replace(/\r\n/g, '\n');

		packageOutputs.push(`${++count}. ${name}${version ? ` version ${version}` : ''} (${data.repository})`);
		licenseOutputs.push(
			`\n%% ${name} NOTICES AND INFORMATION BEGIN HERE\n=========================================\n${license}\n=========================================\nEND OF  ${name} NOTICES AND INFORMATION`,
		);
	}

	const content = `GitLens\n\nTHIRD-PARTY SOFTWARE NOTICES AND INFORMATION\nThis project incorporates components from the projects listed below.\n\n${packageOutputs.join(
		'\n',
	)}\n${licenseOutputs.join('\n')}`;
	fs.writeFileSync(path.join(process.cwd(), 'ThirdPartyNotices.txt'), content, 'utf8');
}

/** @param {string} start */
function collectDirectProductionPackages(start) {
	return new Promise((resolve, reject) => {
		checker.init({ direct: 0, json: true, production: true, start: start }, (err, packages) => {
			if (err) {
				reject(err);
			} else {
				resolve(packages);
			}
		});
	});
}

async function generate() {
	// The extension bundles the `@gitlens/*` packages from source, so their runtime dependencies
	// (e.g. @octokit/* via @gitlens/git-github) ship in dist/ too. Scanning only the root manifest
	// would omit their notices.
	const roots = [process.cwd(), ...getBundledPackageDirs()];
	// Each scan walks node_modules independently, so run them concurrently rather than nine-in-a-row.
	const results = await Promise.allSettled(roots.map(start => collectDirectProductionPackages(start)));

	const failure = results.find(result => result.status === 'rejected');
	if (failure != null) throw failure.reason;

	/** @type { { [key: string]: PackageInfo } } */
	const packages = {};
	for (const result of results) {
		// Keyed by `name@version`, so shared dependencies collapse to one entry.
		Object.assign(packages, result.value);
	}

	await generateThirdpartyNotices(packages);
}

void generate();
