/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');

// Update the icons contribution point in package.json
const package = require('../package.json');
package.contributes.icons = require('../icons-contribution.json').icons;

const packageJSON = `${JSON.stringify(package, undefined, '\t')}\n`;

fs.writeFileSync('./package.json', packageJSON);
fs.rmSync('./icons-contribution.json');
