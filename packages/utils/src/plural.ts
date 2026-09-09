import { getNumericFormat } from './date.js';

/*
 * Plural forms for localized count messages.
 *
 * `formatPlural` resolves a translated template that may contain one or more ICU-style plural blocks:
 *
 *   {selector, plural, branch{...} branch{...} ...}
 *
 * `selector` names an argument (a positional index such as `0`, or a property name such as `count`).
 * Each `branch` is one of the six CLDR plural categories (`zero`, `one`, `two`, `few`, `many`, `other`)
 * or an exact match `=N`. An `other` branch is required. Blocks may appear anywhere in the template, more
 * than once, and a branch body may itself contain another block (nested arbitrarily) as well as plain
 * `{placeholder}` references, including to its own block's selector. This module must not import
 * `vscode` or `@vscode/l10n` — it stays pure so the same helper works in the extension host, webviews and
 * packages. This grammar is re-implemented (not imported) by `scripts/localization.mjs`'s
 * `parsePluralBlocks`, since that validator is a plain `.mjs` script and cannot import this module — keep
 * the two in sync if the grammar changes.
 */

let pluralRules: Intl.PluralRules | undefined;

/** Sets the UI locale used to categorize counts. `undefined` resets to the default (see {@link getPluralCategory}). */
export function setPluralLocale(locale: string | undefined): void {
	pluralRules = locale ? new Intl.PluralRules(locale) : undefined;
}

/**
 * Returns the CLDR plural category for `count` in the current UI locale. Until {@link setPluralLocale} is
 * called, the document language is used when there is a document (a host that only configures
 * `@vscode/l10n`, such as an external consumer of the graph packages, still gets its language's rules),
 * else English.
 */
export function getPluralCategory(count: number): Intl.LDMLPluralRule {
	pluralRules ??= new Intl.PluralRules(
		(typeof document !== 'undefined' ? document.documentElement.lang : undefined) || 'en',
	);
	return pluralRules.select(count);
}

interface PluralBlock {
	/** Index of the block's opening `{` in the text it was found in. */
	readonly start: number;
	/** Index just past the block's closing `}` in the text it was found in. */
	readonly end: number;
	readonly selector: string;
	readonly branches: ReadonlyMap<string, string>;
	readonly otherBranch: string;
}

class MalformedPluralBlockError extends Error {}

const pluralBlockStart = /\{\s*([^{}\s,][^{},]*?)\s*,\s*plural\s*,/;

/**
 * Finds the first top-level ICU-style plural block anywhere in `text`.
 *
 * Returns `undefined` when no `{selector, plural, ...}` prefix is present at all — plain text with no
 * block. Throws `MalformedPluralBlockError` when that prefix is present but the block cannot be parsed
 * (unbalanced braces, or no `other` branch); callers must catch this. Does not look inside a branch body
 * for a nested block — callers that need nested blocks resolved recurse on the branch body themselves.
 */
function findPluralBlock(text: string): PluralBlock | undefined {
	const match = pluralBlockStart.exec(text);
	if (match == null) return undefined;

	const selector = match[1];
	const branches = new Map<string, string>();
	let index = match.index + match[0].length;

	for (;;) {
		while (index < text.length && /\s/.test(text[index])) {
			index++;
		}

		if (text[index] === '}') {
			const otherBranch = branches.get('other');
			if (otherBranch == null) throw new MalformedPluralBlockError(`plural block without an "other" branch`);

			return {
				start: match.index,
				end: index + 1,
				selector: selector,
				branches: branches,
				otherBranch: otherBranch,
			};
		}

		const braceIndex = text.indexOf('{', index);
		if (braceIndex === -1) throw new MalformedPluralBlockError('unterminated plural block');

		const name = text.slice(index, braceIndex).trim();
		if (!name) throw new MalformedPluralBlockError('unterminated plural block');

		let depth = 1;
		let i = braceIndex + 1;
		while (i < text.length && depth > 0) {
			if (text[i] === '{') {
				depth++;
			} else if (text[i] === '}') {
				depth--;
			}
			i++;
		}
		if (depth !== 0) throw new MalformedPluralBlockError('unbalanced braces in plural block');

		branches.set(name, text.slice(braceIndex + 1, i - 1));
		index = i;
	}
}

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
	if (warned.has(key)) return;

	warned.add(key);
	console.warn(message);
}

// Templates are catalog literals, so the distinct texts parsed over a session are few and are parsed
// again on every render (graph rows, tooltips, tree nodes); a malformed text is warned about only once
// because it is only ever parsed once.
const parsedBlocks = new Map<string, PluralBlock | undefined>();

function findBlockOrWarn(text: string): PluralBlock | undefined {
	if (parsedBlocks.has(text)) return parsedBlocks.get(text);

	let block: PluralBlock | undefined;
	try {
		block = findPluralBlock(text);
	} catch (ex) {
		if (!(ex instanceof MalformedPluralBlockError)) throw ex;

		console.warn(`formatPlural: malformed plural block in "${text}"; leaving it untouched`);
	}

	parsedBlocks.set(text, block);
	return block;
}

/** Picks a branch for `block`: an exact `=N` match wins, then the CLDR category, then `other`. A
 *  non-number (or missing) selector value is a caller mistake — it always resolves to `other`, warned
 *  once per distinct block. */
function selectBranch(block: PluralBlock, values: Record<string, unknown>, raw: string): string {
	const value = values[block.selector];
	if (typeof value === 'number') {
		return block.branches.get(`=${value}`) ?? block.branches.get(getPluralCategory(value)) ?? block.otherBranch;
	}

	warnOnce(raw, `formatPlural: selector "${block.selector}" is not a number; using the "other" branch`);
	return block.otherBranch;
}

function toDisplayString(value: unknown): string {
	if (typeof value === 'number') return getNumericFormat()(value);
	if (typeof value === 'string') return value;
	if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);

	// Not a value formatPlural() is documented to take (a count or a name) — render something rather
	// than crash on an object without a meaningful `toString()`.
	return JSON.stringify(value) ?? '';
}

const placeholderRegex = /\{([^}]+)\}/g;

function substitutePlaceholders(text: string, values: Record<string, unknown>): string {
	if (!text) return text;

	return text.replace(placeholderRegex, (match: string, key: string) => {
		const value = values[key];
		return value == null ? match : toDisplayString(value);
	});
}

function normalizeArgs(args: Record<string, unknown> | readonly unknown[]): Record<string, unknown> {
	if (Array.isArray(args)) return Object.fromEntries(args.map((value, index) => [String(index), value]));

	return args as Record<string, unknown>;
}

function resolve(template: string, values: Record<string, unknown>): string {
	let result = '';
	let rest = template;

	for (;;) {
		const block = findBlockOrWarn(rest);
		if (block == null) break;

		result += substitutePlaceholders(rest.slice(0, block.start), values);
		result += resolve(selectBranch(block, values, rest.slice(block.start, block.end)), values);
		rest = rest.slice(block.end);
	}

	result += substitutePlaceholders(rest, values);
	return result;
}

/**
 * Renders a localized template that may contain one or more ICU-style plural blocks (see the module
 * comment for the grammar). Every block is resolved for the current UI locale, including any nested
 * inside a chosen branch; plain `{placeholder}` text outside of and inside blocks is then substituted —
 * positional args map to `{0}`, `{1}`, …, an object's properties map by name, and an unknown placeholder
 * is left as-is. A numeric value is formatted with the date-locale number formatter, matching what count
 * messages have always formatted their counts with; anything else is stringified.
 */
export function formatPlural(template: string, args: Record<string, unknown> | readonly unknown[] = []): string {
	return resolve(template, normalizeArgs(args));
}
