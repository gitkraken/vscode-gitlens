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
	assetTypes: ['html', 'scss', 'json', 'sass', 'css'],
	templates: {
		html: './images/icons/template/icons-contribution.hbs',
		scss: './images/icons/template/styles.hbs',
		sass: './images/icons/template/sass-map.hbs',
		css: './images/icons/template/component-map.hbs',
	},
	formatOptions: {
		json: {
			indent: 2,
		},
	},
	pathOptions: {
		woff2: './dist/glicons.woff2',
		scss: './dist/glicons.scss',
		sass: './dist/glicons-map.scss',
		html: './dist/icons-contribution.json',
		json: './images/icons/template/mapping.json',
		css: './dist/glicons-map.ts',
	},
};

module.exports = config;
