import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getL10nJson, getL10nPseudoLocalized } from '@vscode/l10n-dev';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Microsoft's pseudo-localization locale id — generated on demand, never shipped. */
const pseudoLocale = 'qps-ploc';
/** Pinned coverage numbers the `check` command ratchets against; refresh with `check --update`. */
const baselinePath = join(root, 'scripts', 'l10n-coverage-baseline.json');

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

/**
 * Asserts the VSIX would actually carry every catalog, and none of the generated pseudo ones.
 *
 * Nothing else checks this. The E2E suite runs the extension from a directory
 * (`--extensionDevelopmentPath`), where `.vscodeignore` has no effect at all, so a catalog dropped
 * from the package would keep every test green and reach users as an untranslated UI.
 */
async function checkPackagedCatalogs(locales) {
	// Spawn vsce's own Node entry, not the `.bin` shim: that shim is a POSIX shell script, and its
	// Windows `.CMD` sibling cannot be spawned without a shell (Node refuses with EINVAL).
	const result = spawnSync(
		process.execPath,
		[join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), 'ls', '--no-dependencies'],
		{
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
		},
	);
	if (result.status !== 0) {
		throw new Error(`vsce ls failed (${result.status ?? result.error?.code}):\n${result.stderr || result.stdout}`);
	}

	// vsce prints POSIX-style paths on every platform.
	const packaged = new Set(result.stdout.split('\n').map(line => line.trim()));
	const catalogsOf = locale => [
		locale ? `package.nls.${locale}.json` : 'package.nls.json',
		locale ? `l10n/bundle.l10n.${locale}.json` : 'l10n/bundle.l10n.json',
	];

	const errors = [];
	const shipped = ['', ...locales].flatMap(catalogsOf);
	for (const file of shipped) {
		if (packaged.has(file)) continue;

		errors.push(`${file} is not in the VSIX — check .vscodeignore; that locale would ship untranslated.`);
	}

	// The pseudo catalogs are generated and git-ignored, so on a fresh checkout they do not exist and
	// `vsce ls` cannot list them. Asserting only their absence from the listing would therefore pass
	// while proving nothing — and would keep passing if their `.vscodeignore` entries were deleted.
	// Assert the ignore rules themselves, and check the listing too whenever the files do exist.
	const ignored = new Set((await readFile(join(root, '.vscodeignore'), 'utf8')).split('\n').map(l => l.trim()));
	for (const file of catalogsOf(pseudoLocale)) {
		if (!ignored.has(file)) {
			errors.push(`${file} is not excluded by .vscodeignore — a generated pseudo catalog would ship.`);
		}
		if (existsSync(join(root, file)) && packaged.has(file)) {
			errors.push(`${file} is in the VSIX — the generated pseudo catalogs must stay out of the package.`);
		}
	}
	if (errors.length) throw new Error(errors.join('\n'));

	console.log(
		`Verified ${shipped.length} catalogs are packaged, and that .vscodeignore keeps the ${pseudoLocale} pair out`,
	);
}

/** A catalog entry's text — the English sources store some entries as `{ message, comment }`. */
function entryMessage(value) {
	return typeof value === 'string' ? value : value?.message;
}

/**
 * How much of `source` a translation carries: the messages it defines at all, and how many of those
 * are byte-identical to the English original. A missing message is not an error — English is the
 * documented fallback — but a catalog that has drifted far behind, or one whose entries came back
 * as the source text, is what these two numbers are here to surface.
 */
export function measureCoverage(source, translated) {
	const keys = Object.keys(source);
	let present = 0;
	let untranslated = 0;
	for (const key of keys) {
		const value = entryMessage(translated[key]);
		if (value == null) continue;

		present++;
		if (value === entryMessage(source[key])) {
			untranslated++;
		}
	}

	return { total: keys.length, present: present, untranslated: untranslated };
}

/**
 * Counts plural branches a locale can never select — a `one` branch in Chinese, say, where CLDR has
 * only `other`. Such a branch is harmless at runtime (the fallback fires) but it is the fingerprint
 * of a catalog imported without adapting to the target's grammar, which is worth noticing before the
 * next import brings the same mechanical treatment to a locale where it does change the text.
 *
 * The opposite direction — a category the locale HAS but the translation omits — is deliberately not
 * counted: Spanish gained a `many` category for millions, and none of GitLens' 373 file/line counts
 * needs it, so requiring it would flag every single block and say nothing.
 */
export function countDeadPluralBranches(catalog, locale) {
	let categories;
	try {
		categories = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
	} catch (ex) {
		// A catalog named with an id `Intl` cannot parse (`pt_BR` instead of `pt-BR`, say) would
		// otherwise surface as a bare RangeError naming neither the locale nor its file.
		throw new Error(`${locale} is not a locale identifier Intl.PluralRules accepts: ${ex.message}`);
	}

	let dead = 0;
	let example;

	// `parsePluralBlocks` returns TOP-LEVEL blocks only, so walk each branch body too — the shipped
	// Chinese catalogs carry nested force-push messages whose inner blocks hold dead branches of
	// their own, and counting only the outer ones would let a future import add more unnoticed.
	function walk(text, key) {
		let blocks;
		try {
			blocks = parsePluralBlocks(text);
		} catch {
			// Malformed blocks are already reported, with their own message, by `validateTranslations`.
			return;
		}

		for (const block of blocks) {
			for (const [name, body] of Object.entries(block.branches)) {
				// `=N` branches select an exact count, so they are outside the category system.
				if (!/^=\d+$/.test(name) && !categories.has(name)) {
					dead++;
					example ??= { key: key, branch: name };
				}

				walk(body, key);
			}
		}
	}

	for (const [key, value] of Object.entries(catalog)) {
		const text = entryMessage(value);
		if (typeof text !== 'string' || !text.includes('plural')) continue;

		walk(text, key);
	}

	return { dead: dead, example: example };
}

/**
 * How far a locale's coverage may slip below its pinned value before the check fails. Adding an
 * English message lowers every locale's coverage until the next import lands, so a ratchet with no
 * give here would redden a PR that did nothing wrong; a drop past this is the catalogs falling
 * behind, which is worth saying out loud.
 */
const defaultCoverageSlack = 0.02;

async function readBaseline() {
	const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
	if (baseline.schemaVersion !== 1) {
		throw new Error(`Unsupported l10n coverage baseline schema ${String(baseline.schemaVersion)}`);
	}

	return baseline;
}

async function writeBaseline(source, manifestSource, translations, slack) {
	const locales = {};
	for (const locale of [...translations.keys()].sort()) {
		const { runtime, manifest } = translations.get(locale);
		locales[locale] = {
			runtime: {
				...measureCoverage(source, runtime.catalog),
				deadPluralBranches: countDeadPluralBranches(runtime.catalog, locale).dead,
			},
			// The manifest catalogs carry no plural blocks (`contributes` titles are not counted text),
			// so they get no plural measurement.
			manifest: measureCoverage(manifestSource, manifest.catalog),
		};
	}

	await writeFile(
		baselinePath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				producer: 'node ./scripts/localization.mjs check --update',
				rationale:
					'Ratchets the shipped locales against silent catalog damage that the per-message validation cannot see: a translation that came back as its English source (a mis-keyed or partially imported catalog), and a catalog that has fallen far behind the source. Untranslated counts may not grow at all — a translator keeping a term as-is is a deliberate decision, so it is recorded here rather than tolerated silently. Coverage is allowed to slip by `coverageSlack` because adding an English message legitimately lowers every locale until the next import; a larger drop means the catalogs need re-importing, not that the PR is wrong.',
				coverageSlack: slack,
				locales: locales,
			},
			null,
			'\t',
		)}\n`,
	);
}

/**
 * A locale users see half of is worse than one they cannot see at all: the runtime catalog and the
 * manifest one are separate files, and shipping only one renders part of the UI translated and the
 * rest English. Unlike the ratchet below this is absolute, so it also runs while re-baselining.
 */
export function checkLocaleSymmetry(translations) {
	const errors = [];
	for (const [locale, catalogs] of [...translations].sort(([a], [b]) => (a < b ? -1 : 1))) {
		if (catalogs.runtime == null) {
			errors.push(`${locale}: ships package.nls.${locale}.json but no l10n/bundle.l10n.${locale}.json.`);
		}
		if (catalogs.manifest == null) {
			errors.push(`${locale}: ships l10n/bundle.l10n.${locale}.json but no package.nls.${locale}.json.`);
		}
	}

	return errors;
}

/**
 * Ratchets each shipped locale against {@link baselinePath} — the damage the per-message validation
 * cannot see, because every individual entry is well-formed. Returns the errors rather than throwing
 * so they join the per-message ones.
 */
export function checkCoverageRatchet(source, manifestSource, translations, baseline) {
	const errors = [];
	const slack = baseline.coverageSlack ?? defaultCoverageSlack;

	for (const locale of [...new Set([...translations.keys(), ...Object.keys(baseline.locales)])].sort()) {
		const catalogs = translations.get(locale);
		if (catalogs == null) {
			errors.push(
				`${locale}: the coverage baseline has it, but no catalog ships for it — if the locale was dropped ` +
					`on purpose, run pnpm run check:l10n:update.`,
			);
			continue;
		}
		if (catalogs.runtime == null || catalogs.manifest == null) continue;

		const pinned = baseline.locales[locale];
		if (pinned == null) {
			errors.push(`${locale}: new locale with no pinned coverage. Run pnpm run check:l10n:update.`);
			continue;
		}

		for (const [kind, sourceCatalog] of [
			['runtime', source],
			['manifest', manifestSource],
		]) {
			const measured = measureCoverage(sourceCatalog, catalogs[kind].catalog);
			const previous = pinned[kind];
			if (measured.untranslated > previous.untranslated) {
				errors.push(
					`${catalogs[kind].file}: ${measured.untranslated} messages are identical to their English ` +
						`source, up from ${previous.untranslated}. That is what a mis-keyed or partially imported ` +
						`catalog looks like; if the new ones are deliberate, run pnpm run check:l10n:update.`,
				);
			}

			if (kind === 'runtime' && previous.deadPluralBranches != null) {
				const plural = countDeadPluralBranches(catalogs[kind].catalog, locale);
				if (plural.dead > previous.deadPluralBranches) {
					errors.push(
						`${catalogs[kind].file}: ${plural.dead} plural branches cannot be selected in this locale, ` +
							`up from ${previous.deadPluralBranches} (e.g. the ${JSON.stringify(plural.example.branch)} ` +
							`branch of ${JSON.stringify(plural.example.key)}). A catalog imported without adapting ` +
							`to the target's plural grammar looks exactly like this.`,
					);
				}
			}

			// Guarded: a hand-trimmed baseline with a zero total would make both ratios NaN, and every
			// comparison against NaN is false — the gate would switch itself off without saying so.
			if (measured.total > 0 && previous.total > 0) {
				const coverage = measured.present / measured.total;
				const pinnedCoverage = previous.present / previous.total;
				if (coverage < pinnedCoverage - slack) {
					errors.push(
						`${catalogs[kind].file}: covers ${(coverage * 100).toFixed(1)}% of the source messages, more ` +
							`than ${(slack * 100).toFixed(0)} points below the pinned ` +
							`${(pinnedCoverage * 100).toFixed(1)}%. The catalogs need re-importing.`,
					);
				}
			}
		}
	}

	return errors;
}

async function main(command, update) {
	// Ahead of the catalog extraction below: this command needs only the baseline's locale list, and
	// extracting the runtime catalog costs ~45s that every CI build would otherwise pay for a value
	// it never reads.
	if (command === 'packaged') {
		await checkPackagedCatalogs(Object.keys((await readBaseline()).locales));
		return;
	}

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
		throw new Error('Usage: node scripts/localization.mjs <export|check|pseudo|packaged> [--update]');
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
	/** Per locale: `{ runtime: <catalog>, manifest: <catalog> }`, for the coverage checks below. */
	const translations = new Map();
	for (const [directory, pattern, catalog, kind] of [
		[root, /^package\.nls\.(.+)\.json$/, manifestSource, 'manifest'],
		[join(root, 'l10n'), /^bundle\.l10n\.(.+)\.json$/, source, 'runtime'],
	]) {
		for (const file of await readdir(directory)) {
			const match = pattern.exec(file);
			if (match == null) continue;

			const translated = JSON.parse(await readFile(join(directory, file), 'utf8'));
			errors.push(...validateTranslations(catalog, translated, file));

			// The pseudo catalogs are generated from the source on demand, so measuring their coverage
			// would only ever restate that the generator ran.
			if (match[1] === pseudoLocale) continue;

			const locale = translations.get(match[1]) ?? {};
			locale[kind] = { catalog: translated, file: file };
			translations.set(match[1], locale);
		}
	}
	errors.push(...checkLocaleSymmetry(translations));

	const baseline = existsSync(baselinePath) ? await readBaseline() : undefined;
	if (update) {
		if (errors.length) throw new Error(errors.join('\n'));

		await writeBaseline(source, manifestSource, translations, baseline?.coverageSlack ?? defaultCoverageSlack);
		console.log(`Pinned the coverage of ${translations.size} locale(s) in ${relative(root, baselinePath)}`);
		return;
	}
	if (baseline == null) {
		throw new Error(`Missing ${relative(root, baselinePath)}. Run pnpm run check:l10n:update to create it.`);
	}

	errors.push(...checkCoverageRatchet(source, manifestSource, translations, baseline));
	if (errors.length) throw new Error(errors.join('\n'));
	console.log(
		`Validated ${Object.keys(source).length} runtime and ${Object.keys(manifestSource).length} manifest messages` +
			`, and the coverage of ${translations.size} shipped locale(s)`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main(process.argv[2], process.argv.includes('--update'));
}
