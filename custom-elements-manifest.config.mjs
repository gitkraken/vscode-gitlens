import { cemSorterPlugin } from '@wc-toolkit/cem-sorter';

export default {
	globs: ['src/webviews/apps/**/*.ts'],
	litelement: true,
	plugins: [cemSorterPlugin()],
};
