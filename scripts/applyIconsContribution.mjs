import fs from 'fs';
import { globSync } from 'glob';

const packageJSONPromises = Promise.all([
	import('../package.json', { with: { type: 'json' } }),
	import('../dist/icons-contribution.json', { with: { type: 'json' } }),
]);

const scssPromises = Promise.all([
	fs.promises.readFile('./dist/glicons.scss', 'utf8'),
	fs.promises.readFile('./src/webviews/apps/shared/glicons.scss', 'utf8'),
	fs.promises.readFile('./dist/glicons-map.scss', 'utf8'),
	fs.promises.readFile('./src/webviews/apps/shared/styles/icons/glicons-map.scss', 'utf8'),
	fs.promises.readFile('./dist/glicons-map.ts', 'utf8'),
	fs.promises.readFile('./src/webviews/apps/shared/components/icons/glicons-map.ts', 'utf8'),
]);

let pending = [];

// Update the icons contribution point in package.json
const [{ default: packageJSON }, { default: icons }] = await packageJSONPromises;

if (JSON.stringify(packageJSON.contributes.icons) !== JSON.stringify(icons.icons)) {
	packageJSON.contributes.icons = icons.icons;
	const json = `${JSON.stringify(packageJSON, undefined, '\t')}\n`;
	pending.push(fs.promises.writeFile('./package.json', json));
}

// Update the scss file
const [newScss, scss, newSassMap, sassMap, newTsMap, tsMap] = await scssPromises;

if (scss !== newScss) {
	pending.push(fs.promises.writeFile('./src/webviews/apps/shared/glicons.scss', newScss));
}

if (sassMap !== newSassMap) {
	pending.push(fs.promises.writeFile('./src/webviews/apps/shared/styles/icons/glicons-map.scss', newSassMap));
}

if (tsMap !== newTsMap) {
	pending.push(fs.promises.writeFile('./src/webviews/apps/shared/components/icons/glicons-map.ts', newTsMap));
}

// Propagate the new cache-busting hash into the per-app webview HTML files, which declare their own
// `@font-face` for glicons.woff2 and would otherwise keep pointing at a stale cached font missing
// any newly-added glyph. The canonical hash comes from the freshly-generated dist/glicons.scss.
const hashMatch = newScss.match(/glicons\.woff2\?([a-f0-9]+)/);
if (hashMatch != null) {
	const newHash = hashMatch[1];
	const htmlFiles = globSync('src/webviews/apps/**/*.html');
	for (const file of htmlFiles) {
		const html = await fs.promises.readFile(file, 'utf8');
		const updated = html.replace(/(glicons\.woff2\?)[a-f0-9]+/g, `$1${newHash}`);
		if (updated !== html) {
			pending.push(fs.promises.writeFile(file, updated));
		}
	}
}

pending.push(
	fs.promises.rm('./dist/icons-contribution.json'),
	fs.promises.rm('./dist/glicons.scss'),
	fs.promises.rm('./dist/glicons-map.scss'),
	fs.promises.rm('./dist/glicons-map.ts'),
);
await Promise.allSettled(pending);
