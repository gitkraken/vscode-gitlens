/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');

// Update the icons contribution point in package.json
const package = require('../package.json');
const icons = require('../dist/icons-contribution.json').icons;
if (JSON.stringify(package.contributes.icons) !== JSON.stringify(icons)) {
	package.contributes.icons = icons;
	const packageJSON = `${JSON.stringify(package, undefined, '\t')}\n`;
	fs.writeFileSync('./package.json', packageJSON);
}

fs.rmSync('./dist/icons-contribution.json');

// Update the scss file
const newScss = fs.readFileSync('./dist/glicons.scss', 'utf8');
const scss = fs.readFileSync('./src/webviews/apps/shared/glicons.scss', 'utf8');
if (scss !== newScss) {
	fs.writeFileSync('./src/webviews/apps/shared/glicons.scss', newScss);
}

fs.rmSync('./dist/glicons.scss');
