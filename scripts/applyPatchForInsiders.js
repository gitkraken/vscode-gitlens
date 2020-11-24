/* eslint-disable import/order */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';
const fs = require('fs');

// Patch README
const insert = fs.readFileSync('./README.insiders.md', { encoding: 'utf8' });
const data = fs.readFileSync('./README.md', { encoding: 'utf8' });
fs.writeFileSync('./README.md', `${insert}\n${data}`);

// Patch package.json
const date = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
let json = require('../package.json');

json = JSON.stringify({
	...json,
	name: `${json.name}-insiders`,
	displayName: `${json.displayName} (Insiders)`,
	version: `${String(date.getFullYear())}.${date.getMonth() + 1}.${date.getDate()}${String(date.getHours()).padStart(
		2,
		'0',
	)}`,
	preview: true,
});
fs.writeFileSync('./package.json', json);
