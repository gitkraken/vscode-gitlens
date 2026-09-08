import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getL10nJson, getL10nPseudoLocalized } from '@vscode/l10n-dev';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function formatCatalog(catalog) {
	return `${JSON.stringify(Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, '\t')}\n`;
}

export function placeholders(message) {
	return [...new Set([...message.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]))].sort();
}

export function validateTranslations(source, translations, file) {
	const errors = [];
	for (const [key, value] of Object.entries(translations)) {
		if (!Object.hasOwn(source, key)) {
			errors.push(`${file}: unknown message ${JSON.stringify(key)}`);
			continue;
		}
		const original = typeof source[key] === 'string' ? source[key] : source[key].message;
		const translated = typeof value === 'string' ? value : value?.message;
		if (typeof translated !== 'string' || !translated.trim()) {
			errors.push(`${file}: empty or invalid translation for ${JSON.stringify(key)}`);
			continue;
		}
		if (JSON.stringify(placeholders(original)) !== JSON.stringify(placeholders(translated))) {
			errors.push(`${file}: mismatched placeholders for ${JSON.stringify(key)}`);
		}
	}
	return errors;
}

async function sourceFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (['node_modules', 'dist', 'out', '__tests__', 'fixtures', 'scripts'].includes(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await sourceFiles(path)));
		} else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

export async function extractCatalog() {
	const files = (await Promise.all(['src', 'packages'].map(path => sourceFiles(join(root, path))))).flat().sort();
	const sources = await Promise.all(
		files.map(async path => ({
			contents: await readFile(path, 'utf8'),
			extension: extname(path).replace(/\.[cm]/, '.'),
		})),
	);
	return getL10nJson(sources);
}

async function main(command) {
	const bundlePath = join(root, 'l10n', 'bundle.l10n.json');
	const source = await extractCatalog();
	const serialized = formatCatalog(source);
	if (command === 'export') {
		await mkdir(dirname(bundlePath), { recursive: true });
		await writeFile(bundlePath, serialized);
		console.log(`Extracted ${Object.keys(source).length} runtime messages`);
		return;
	}
	if (command !== 'check' && command !== 'pseudo') {
		throw new Error('Usage: node scripts/localization.mjs <export|check|pseudo>');
	}
	// The repository formatter may compact translator-comment arrays without changing the catalog.
	if (!existsSync(bundlePath) || formatCatalog(JSON.parse(await readFile(bundlePath, 'utf8'))) !== serialized) {
		throw new Error('Runtime catalog is stale. Run pnpm run generate:l10n.');
	}
	const manifestSource = JSON.parse(await readFile(join(root, 'package.nls.json'), 'utf8'));
	if (command === 'pseudo') {
		await writeFile(join(root, 'package.nls.qps-ploc.json'), formatCatalog(getL10nPseudoLocalized(manifestSource)));
		await writeFile(join(root, 'l10n', 'bundle.l10n.qps-ploc.json'), formatCatalog(getL10nPseudoLocalized(source)));
		console.log('Generated qps-ploc catalogs; reload VS Code with the pseudo display language');
		return;
	}
	const errors = [];
	const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
	function checkReferences(value) {
		if (
			typeof value === 'string' &&
			/^%[^%]+%$/.test(value) &&
			!Object.hasOwn(manifestSource, value.slice(1, -1))
		) {
			errors.push(`package.json: unresolved ${value}`);
		} else if (value && typeof value === 'object') {
			Object.values(value).forEach(checkReferences);
		}
	}
	checkReferences(manifest);
	for (const [directory, pattern, catalog] of [
		[root, /^package\.nls\.(.+)\.json$/, manifestSource],
		[join(root, 'l10n'), /^bundle\.l10n\.(.+)\.json$/, source],
	]) {
		for (const file of await readdir(directory)) {
			if (!pattern.test(file)) continue;
			errors.push(
				...validateTranslations(catalog, JSON.parse(await readFile(join(directory, file), 'utf8')), file),
			);
		}
	}
	if (errors.length) throw new Error(errors.join('\n'));
	console.log(
		`Validated ${Object.keys(source).length} runtime and ${Object.keys(manifestSource).length} manifest messages`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main(process.argv[2]);
}
