//@ts-check

/** @type { import('fantasticon').RunnerOptions} } */
const config = {
	name: 'glicons',
	prefix: 'glicons',
	codepoints: require('./images/icons/template/mapping.json'),
	inputDir: './images/icons',
	outputDir: './dist',
	// @ts-ignore
	fontTypes: ['woff2'],
	normalize: true,
	// @ts-ignore
	assetTypes: ['html', 'scss', 'json'],
	templates: {
		html: './images/icons/template/icons-contribution.hbs',
		scss: './images/icons/template/styles.hbs',
	},
	formatOptions: {
		json: {
			indent: 2,
		},
	},
	pathOptions: {
		woff2: './dist/glicons.woff2',
		scss: './src/webviews//apps/shared/glicons.scss',
		html: './icons-contribution.json',
		json: './images/icons/template/mapping.json',
	},
	onComplete: _fontConfig => {
		const fs = require('fs');
		// Update the icons contribution point in package.json
		const package = require('./package.json');
		package.contributes.icons = require('./icons-contribution.json').icons;

		const packageJSON = `${JSON.stringify(package, undefined, '\t')}\n`;

		fs.writeFileSync('./package.json', packageJSON);
		fs.rmSync('./icons-contribution.json');
	},
};

module.exports = config;
