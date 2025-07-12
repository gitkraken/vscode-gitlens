import fs from 'fs';

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

pending.push(
	fs.promises.rm('./dist/icons-contribution.json'),
	fs.promises.rm('./dist/glicons.scss'),
	fs.promises.rm('./dist/glicons-map.scss'),
	fs.promises.rm('./dist/glicons-map.ts'),
);
await Promise.allSettled(pending);
