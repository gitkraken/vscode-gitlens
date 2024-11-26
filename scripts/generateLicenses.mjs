//@ts-check
/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as path from 'path';
import * as checker from 'license-checker-rseidelsohn';

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
				licenseFile: 'https://raw.github.com/microsoft/vscode/main/LICENSE.txt',
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

		if (name === 'gitlens' || name.startsWith('@gitkraken')) continue;
		if (data.licenseFile == null) continue;

		let license;
		if (data.licenseFile.startsWith('https://')) {
			const response = await fetch(data.licenseFile, { method: 'GET' });
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

async function generate() {
	const packages = await new Promise((resolve, reject) => {
		checker.init(
			{
				direct: 0,
				json: true,
				production: true,
				start: process.cwd(),
			},
			(err, packages) => {
				if (err) {
					reject(err);
				} else {
					resolve(packages);
				}
			},
		);
	});
	void generateThirdpartyNotices(packages);
}

void generate();
