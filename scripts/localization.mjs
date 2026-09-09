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

// Re-implements (does not import) the grammar in packages/utils/src/plural.ts, since that module is
// TypeScript and this validator is a plain .mjs script. Keep the two in sync if the grammar changes.
const pluralBlockStart = /\{\s*([^{}\s,][^{},]*?)\s*,\s*plural\s*,/;
const pluralCategories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Finds every TOP-LEVEL ICU-style plural block in `value` — `{selector, plural, branch{...} ...}`, an
 * `other` branch required. A block's own selector and branches are only ever validated once, here, so
 * this deliberately does not look inside a branch body for a nested block; a caller that needs those
 * (`checkPluralBlocks`, `normalize`) recurses on the branch body itself.
 *
 * Throws when a `{selector, plural,` prefix is found but the block cannot be parsed (unbalanced braces,
 * unterminated, or no "other" branch).
 */
export function parsePluralBlocks(value) {
	const blocks = [];
	let offset = 0;

	for (;;) {
		const match = pluralBlockStart.exec(value.slice(offset));
		if (match == null) break;

		const start = offset + match.index;
		const selector = match[1];
		const branches = {};
		let index = start + match[0].length;

		for (;;) {
			while (index < value.length && /\s/.test(value[index])) {
				index++;
			}
			if (value[index] === '}') {
				if (!Object.hasOwn(branches, 'other')) throw new Error(`plural block without an "other" branch`);

				blocks.push({ selector, branches, start, end: index + 1 });
				offset = index + 1;
				break;
			}

			const braceIndex = value.indexOf('{', index);
			if (braceIndex === -1) throw new Error('unterminated plural block');

			const name = value.slice(index, braceIndex).trim();
			if (!name) throw new Error('unterminated plural block');

			let depth = 1;
			let i = braceIndex + 1;
			while (i < value.length && depth > 0) {
				if (value[i] === '{') depth++;
				else if (value[i] === '}') depth--;
				i++;
			}
			if (depth !== 0) throw new Error('unbalanced braces in plural block');

			branches[name] = value.slice(braceIndex + 1, i - 1);
			index = i;
		}
	}
	return blocks;
}

/**
 * Collects every placeholder `value` actually references — plain `{name}` text, and every plural block's
 * own selector, at any nesting depth (a block's branches are walked too, so a selector used only inside a
 * nested block still counts) — into `set`. This is what makes a block's placeholder set comparable to a
 * plain translation's: a block is not "the text `{selector, plural, ...}`" for this purpose, it is
 * "a reference to `{selector}`, resolved differently at runtime." Throws the same as `parsePluralBlocks`.
 */
function collectEffectivePlaceholders(value, set) {
	const blocks = parsePluralBlocks(value);
	let index = 0;
	for (const block of blocks) {
		for (const placeholder of placeholders(value.slice(index, block.start))) {
			set.add(placeholder);
		}
		set.add(block.selector);
		for (const body of Object.values(block.branches)) {
			collectEffectivePlaceholders(body, set);
		}
		index = block.end;
	}
	for (const placeholder of placeholders(value.slice(index))) {
		set.add(placeholder);
	}
}

function effectivePlaceholders(value) {
	const set = new Set();
	collectEffectivePlaceholders(value, set);
	return [...set].sort();
}

/**
 * Recursively validates the STRUCTURE of every plural block in `value`, including ones nested inside a
 * branch body: every branch name must be a valid category or `=N`. (A block's selector and its branches'
 * placeholders are validated separately, by comparing `effectivePlaceholders()` against the source — that
 * walk already visits every selector and placeholder at every nesting depth, so re-checking them here
 * would just repeat that same comparison one block at a time; a branch legitimately need not repeat
 * every placeholder its enclosing message has, so there is nothing block-local left to check there.)
 */
function checkPluralBlocks(value, label, file, errors) {
	let blocks;
	try {
		blocks = parsePluralBlocks(value);
	} catch (ex) {
		errors.push(`${file}: ${ex.message} for ${label}`);
		return;
	}

	for (const block of blocks) {
		for (const [name, body] of Object.entries(block.branches)) {
			if (name !== 'other' && !pluralCategories.has(name) && !/^=\d+$/.test(name)) {
				errors.push(`${file}: unknown plural branch ${JSON.stringify(name)} for ${label}`);
			}
			checkPluralBlocks(body, label, file, errors);
		}
	}
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

		let sourcePlaceholders;
		try {
			sourcePlaceholders = effectivePlaceholders(original);
		} catch (ex) {
			errors.push(`${file}: ${ex.message} for ${JSON.stringify(key)} (source)`);
			continue;
		}
		let translatedPlaceholders;
		try {
			translatedPlaceholders = effectivePlaceholders(translated);
		} catch (ex) {
			errors.push(`${file}: ${ex.message} for ${JSON.stringify(key)}`);
			continue;
		}

		if (JSON.stringify(sourcePlaceholders) !== JSON.stringify(translatedPlaceholders)) {
			errors.push(`${file}: mismatched placeholders for ${JSON.stringify(key)}`);
			continue;
		}

		// A block is accepted, and its branch names validated the same way, whether it lives in the English
		// source or only in a translation (a translator adding categories English doesn't distinguish).
		checkPluralBlocks(original, `${JSON.stringify(key)} (source)`, file, errors);
		checkPluralBlocks(translated, JSON.stringify(key), file, errors);
	}
	return errors;
}

/**
 * `getL10nPseudoLocalized` (from `@vscode/l10n-dev`) preserves a placeholder by matching `{\S+\}` — one
 * or more NON-whitespace characters between braces — so it never recognizes a plural block as a unit: a
 * block's "plural" keyword, its branch names, and its braces all contain spaces or span multiple `{}`
 * pairs. Left to it directly, the block's structural syntax gets pseudo-localized as if it were prose,
 * corrupting it (`plural` no longer reads as the literal keyword `parsePluralBlocks` requires). So a
 * catalog bound for the `pseudo` command is preprocessed here first: every block's selector, "plural"
 * keyword, branch names and braces pass through untouched, and only genuine text — the surrounding plain
 * message and each branch's own prose — is handed to `getL10nPseudoLocalized`, recursively for a nested
 * block's branches too.
 */
function pseudoLocalizeText(text) {
	if (!text) return text;

	return Object.values(getL10nPseudoLocalized({ x: text }))[0];
}

function pseudoLocalizeValue(value) {
	let blocks;
	try {
		blocks = parsePluralBlocks(value);
	} catch {
		// Malformed — `check:l10n` already reports this; don't let the pseudo command crash over it.
		return pseudoLocalizeText(value);
	}
	if (blocks.length === 0) return pseudoLocalizeText(value);

	let result = '';
	let index = 0;
	for (const block of blocks) {
		result += pseudoLocalizeText(value.slice(index, block.start));
		const branches = Object.entries(block.branches)
			.map(([name, body]) => `${name}{${pseudoLocalizeValue(body)}}`)
			.join(' ');
		result += `{${block.selector}, plural, ${branches}}`;
		index = block.end;
	}
	return result + pseudoLocalizeText(value.slice(index));
}

/** Pseudo-localizes a catalog the same way `getL10nPseudoLocalized` would (flattening a `{message,
 *  comment}` entry to its localized `message` as a plain string, matching how a real translation file
 *  looks), but through `pseudoLocalizeValue` so a plural block's syntax survives intact. */
function pseudoLocalizeCatalog(catalog) {
	const result = {};
	for (const [key, value] of Object.entries(catalog)) {
		result[key] = pseudoLocalizeValue(typeof value === 'string' ? value : value.message);
	}
	return result;
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
		await writeFile(join(root, 'package.nls.qps-ploc.json'), formatCatalog(pseudoLocalizeCatalog(manifestSource)));
		await writeFile(join(root, 'l10n', 'bundle.l10n.qps-ploc.json'), formatCatalog(pseudoLocalizeCatalog(source)));
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
