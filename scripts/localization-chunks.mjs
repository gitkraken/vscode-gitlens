import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCatalog, validateTranslations } from './localization.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultChunkSize = 600;
const defaultWorkRoot = join(root, '.work', 'l10n-chunks');

/** @returns {[name: string, sourcePath: string, localePath: string, chunkPrefix: string][]} */
function catalogs(locale) {
	return [
		['manifest', join(root, 'package.nls.json'), join(root, `package.nls.${locale}.json`), 'manifest'],
		['runtime', join(root, 'l10n', 'bundle.l10n.json'), join(root, 'l10n', `bundle.l10n.${locale}.json`), 'bundle'],
	];
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, catalog) {
	writeFileSync(path, formatCatalog(catalog), 'utf8');
}

function usage() {
	console.log(`Usage: node scripts/localization-chunks.mjs <command> <locale> [options]

Commands:
  split <locale> [--size N] [--dir D]   Write untranslated entries as chunk files (D/chunk-NN.json)
  merge <locale> [--dir D]              Merge translated chunk files into the locale catalogs
  prune <locale>                        Remove locale entries whose English message no longer exists

Chunk files are JSON objects of { "<english message>": <translated value> }; the same file
name is used for the translated output. Partial locales are valid: VS Code falls back to
English per message. Always run "pnpm run check:l10n" after a merge or prune.`);
	process.exit(1);
}

function split(locale, options) {
	const outDir = join(options.dir ?? join(defaultWorkRoot, locale));
	mkdirSync(outDir, { recursive: true });
	for (const [name, sourcePath, localePath, prefix] of catalogs(locale)) {
		const source = readJson(sourcePath);
		const current = existsSync(localePath) ? readJson(localePath) : {};
		const missing = Object.keys(source).filter(key => !Object.hasOwn(current, key));
		console.log(`${name}: ${missing.length} of ${Object.keys(source).length} entries untranslated`);
		if (!missing.length) continue;

		const size = options.size ?? defaultChunkSize;
		for (let index = 0; index < missing.length; index += size) {
			const chunk = Object.fromEntries(missing.slice(index, index + size).map(key => [key, source[key]]));
			const file = join(outDir, `${prefix}-${String(Math.floor(index / size)).padStart(2, '0')}.json`);
			writeJson(file, chunk);
			console.log(`  wrote ${file} (${Object.keys(chunk).length} entries)`);
		}
	}
	console.log('Translate the values in each chunk file (keys stay byte-identical), then run merge.');
}

function merge(locale, options) {
	const dir = options.dir ?? join(defaultWorkRoot, locale);
	let touched = false;
	for (const [name, sourcePath, localePath, prefix] of catalogs(locale)) {
		const source = readJson(sourcePath);
		const chunkPattern = new RegExp(`^${prefix}-\\d{2}\\.json$`);
		const chunks = readdirSync(dir).filter(file => chunkPattern.test(file));
		if (!chunks.length) {
			console.log(`${name}: no chunk files found in ${dir}`);
			continue;
		}
		const current = existsSync(localePath) ? readJson(localePath) : {};
		const translated = { ...current };
		let count = 0;
		for (const file of chunks) {
			const entries = readJson(join(dir, file));
			const errors = validateTranslations(source, entries, file);
			if (errors.length) {
				console.error(`${errors.join('\n')}\nFix the chunk and re-run merge; nothing was written.`);
				process.exit(1);
			}

			// Locale bundles hold plain strings: VS Code's extension host does not unwrap { message, comment } values.
			for (const [key, value] of Object.entries(entries)) {
				translated[key] = typeof value === 'string' ? value : value.message;
			}

			count += Object.keys(entries).length;
		}
		writeJson(localePath, translated);
		touched = true;
		console.log(`${name}: merged ${count} entries from ${chunks.length} chunk(s) into ${localePath}`);
	}
	if (touched) console.log('Now run "pnpm run check:l10n" to validate the updated catalogs.');
}

function prune(locale) {
	for (const [name, sourcePath, localePath] of catalogs(locale)) {
		if (!existsSync(localePath)) continue;
		const source = readJson(sourcePath);
		const current = readJson(localePath);
		const obsolete = Object.keys(current).filter(key => !Object.hasOwn(source, key));
		if (!obsolete.length) {
			console.log(`${name}: no obsolete entries`);
			continue;
		}

		const pruned = Object.fromEntries(Object.entries(current).filter(([key]) => Object.hasOwn(source, key)));
		writeJson(localePath, pruned);
		console.log(`${name}: removed ${obsolete.length} obsolete entries from ${localePath}`);
	}
	console.log('Now run "pnpm run check:l10n" to validate the updated catalogs.');
}

const [command, locale, ...args] = process.argv.slice(2);
if (!command || !locale || !['split', 'merge', 'prune'].includes(command)) usage();

const options = {};
for (let index = 0; index < args.length; index += 2) {
	if (args[index] === '--size') {
		options.size = Number(args[index + 1]);
	} else if (args[index] === '--dir') {
		options.dir = args[index + 1];
	} else {
		usage();
	}
}

if (command === 'split') {
	split(locale, options);
} else if (command === 'merge') {
	merge(locale, options);
} else {
	prune(locale);
}
