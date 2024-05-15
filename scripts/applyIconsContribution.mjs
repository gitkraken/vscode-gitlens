import fs from 'fs';

const packageJSONPromises = Promise.all([
	import('../package.json', { assert: { type: 'json' } }),
	import('../dist/icons-contribution.json', { assert: { type: 'json' } }),
]);

const scssPromises = Promise.all([
	fs.promises.readFile('./dist/glicons.scss', 'utf8'),
	fs.promises.readFile('./src/webviews/apps/shared/glicons.scss', 'utf8'),
	fs.promises.readFile('./dist/glicons-properties.scss', 'utf8'),
	fs.promises.readFile('./src/webviews/apps/shared/glicons-properties.scss', 'utf8'),
	fs.promises.readFile('./dist/glicons.ts', 'utf8'),
	fs.promises.readFile('./src/webviews/apps/shared/components/glicons.ts', 'utf8'),
]);

let pending = [];

// Update the icons contribution point in package.json
const [{ default: packageJSON }, { default: icons }] = await packageJSONPromises;

if (JSON.stringify(packageJSON.contributes.icons) !== JSON.stringify(icons.icons)) {
	packageJSON.contributes.icons = {
		...icons.icons,
	};
	const json = `${JSON.stringify(packageJSON, undefined, '\t')}\n`;
	pending.push(fs.promises.writeFile('./package.json', json));
}

// Update the scss file
const [newScss, scss, newPropertiesScss, propertiesScss, newMapTs, mapTs] = await scssPromises;

if (scss !== newScss) {
	pending.push(fs.promises.writeFile('./src/webviews/apps/shared/glicons.scss', newScss));
}

if (propertiesScss !== newPropertiesScss) {
	pending.push(fs.promises.writeFile('./src/webviews/apps/shared/glicons-properties.scss', newPropertiesScss));
}

if (mapTs !== newMapTs) {
	pending.push(fs.promises.writeFile('./src/webviews/apps/shared/components/glicons.ts', newMapTs));
}

pending.push(
	fs.promises.rm('./dist/icons-contribution.json'),
	fs.promises.rm('./dist/glicons.scss'),
	fs.promises.rm('./dist/glicons-properties.scss'),
	fs.promises.rm('./dist/glicons.ts'),
);
await Promise.allSettled(pending);
