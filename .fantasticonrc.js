//@ts-check

/** @type {import('@twbs/fantasticon').RunnerOptions} */
const config = {
	name: 'glicons',
	prefix: 'glicon',
	codepoints: require('./images/icons/template/mapping.json'),
	inputDir: './images/icons',
	outputDir: './dist',
	fontsUrl: '#{root}/dist',
	// @ts-ignore
	fontTypes: ['woff2'],
	normalize: true,
	// @ts-ignore
	assetTypes: ['html', 'scss', 'css', 'json', 'sass'],
	templates: {
		html: './images/icons/template/icons-contribution.hbs',
		scss: './images/icons/template/styles.hbs',
		css: './images/icons/template/css-properties.hbs',
		sass: './images/icons/template/icon-map.hbs',
	},
	formatOptions: {
		json: {
			indent: 2,
		},
	},
	pathOptions: {
		woff2: './dist/glicons.woff2',
		scss: './dist/glicons.scss',
		css: './dist/glicons-properties.scss',
		html: './dist/icons-contribution.json',
		json: './images/icons/template/mapping.json',
		sass: './dist/glicons.ts',
	},
};

module.exports = config;
