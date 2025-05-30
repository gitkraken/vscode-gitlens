/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');

// Patch README
const insert = fs.readFileSync('./README.pre.md', { encoding: 'utf8' });
if (insert.trim().length !== 0) {
	const data = fs.readFileSync('./README.md', { encoding: 'utf8' });
	fs.writeFileSync('./README.md', `${insert}\n${data}`);
}

// Patch package.json
const date = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
let packageJSON = require('../package.json');

packageJSON = JSON.stringify(
	{
		...packageJSON,
		version: `${String(date.getFullYear())}.${date.getMonth() + 1}.${date.getDate()}${String(
			date.getHours(),
		).padStart(2, '0')}`,
	},
	undefined,
	'\t',
);
packageJSON += '\n';

fs.writeFileSync('./package.json', packageJSON);
