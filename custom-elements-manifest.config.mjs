import { customElementVsCodePlugin } from 'custom-element-vs-code-integration';

export default {
	globs: ['src/webviews/apps/**/*.ts'],
	litelement: true,
	plugins: [
		customElementVsCodePlugin({
			// Plugin options
		}),
	],
};
