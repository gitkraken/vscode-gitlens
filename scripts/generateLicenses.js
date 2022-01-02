//@ts-check
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fetch = require('node-fetch');

/** @typedef { { licenses: string; repository: string; licenseFile: string } } PackageInfo **/

/**
 * @param { string } file
 */
async function generateThirdpartyNotices(file) {
	file = path.join(process.cwd(), file);
	const data = fs.readFileSync(file, 'utf8');
	fs.rmSync(file);

	/**
	 *	@type { { [key: string]: PackageInfo } }
	 */
	const packages = JSON.parse(data);

	// Add any packages used in directly in the code

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
		[
			'chalk/ansi-regex',
			{
				licenses: 'MIT',
				repository: 'https://github.com/chalk/ansi-regex',
				licenseFile: 'https://raw.github.com/chalk/ansi-regex/main/license',
			},
		],
		[
			'sindresorhus/string-width',
			{
				licenses: 'MIT',
				repository: 'https://github.com/sindresorhus/string-width',
				licenseFile: 'https://raw.github.com/sindresorhus/string-width/main/license',
			},
		],
		[
			'sindresorhus/is-fullwidth-code-point',
			{
				licenses: 'MIT',
				repository: 'https://github.com/sindresorhus/is-fullwidth-code-point',
				licenseFile: 'https://raw.github.com/sindresorhus/is-fullwidth-code-point/main/license',
			},
		],
	];

	const packageOutputs = [];
	const licenseOutputs = [];

	let count = 0;
	for (const [key, data] of Object.entries(packages).concat(codeOnlyPackages)) {
		let name;
		let version;

		const index = key.lastIndexOf('@');
		if (index !== -1) {
			name = key.substr(0, index);
			version = key.substr(index + 1);
		} else {
			name = key;
		}

		if (name === 'gitlens') continue;

		let license;
		if (data.licenseFile.startsWith('https://')) {
			const response = await fetch(data.licenseFile);
			license = await response.text();
		} else {
			license = fs.readFileSync(data.licenseFile, 'utf8');
		}

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
	await exec('npx license-checker --json --production --relativeLicensePath > thirdparty.json');
	void generateThirdpartyNotices('thirdparty.json');
}

void generate();
