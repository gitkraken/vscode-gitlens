// @ts-check

import * as path from 'node:path';

/**
 * Disallow reading `.message` off an error, unless the read is provably not user-facing display text.
 *
 * `GitCommandError.message` is always the English sentence, kept that way so logs and stack traces stay
 * searchable; the translated text lives on `localizedMessage`. `getPresentableErrorMessage()` (from
 * `src/errors.ts`) picks the right one for any error.
 *
 * The rule defaults to "flag": any `<err>.message` read is reported unless it matches one of a short list of
 * known non-display uses — a classification check (`.includes()`, `===`, `.length`), a logging/telemetry sink
 * (which wants the English text on purpose), or rewrapping into a `new Error(...)`. This is intentionally the
 * inverse of an allowlist-of-sinks approach: notification call sites are numerous and easy to add without
 * thinking about localization, so the safe default is to require an explicit reason to skip the fix rather
 * than an explicit sink to catch.
 *
 * `packages/git/` can't import `src/errors.ts` (see `no-src-imports` / package boundaries), so files under it
 * get pointed at `.localizedMessage` directly instead of `getPresentableErrorMessage()`.
 *
 * Scope is deliberately narrow: only `src/` and `packages/git/src/`. Every other `packages/*` layer (HTTP
 * clients, provider SDKs, process/exec wrappers, generic utils) never touches a `GitCommandError` — its
 * `.message` reads are classifying or logging plain JS/HTTP errors, not skipping localization.
 */

/** Keeps `options.message` and friends out of it — only names that read as an error are candidates. */
const errorIdentifier = /^(?:ex|err|error|e)$|(?:Ex|Err|Error)$/;

const comparisonOperators = new Set(['===', '!==', '==', '!=', 'in', 'instanceof']);
const loggerMethodNames = new Set(['error', 'warn', 'log', 'debug', 'trace', 'info']);
/** Matches `scope`, `logger`, or any name ending in `Logger`/`logger` (e.g. `myLogger`, `gitLogger`). */
const loggerObjectName = /^(?:scope|logger)$|(?:Logger|logger)$/;
const telemetryCalleeNames = new Set(['sendEvent', 'sendTelemetryEvent', 'trackEvent', 'captureException']);
/** String/RegExp classification methods — an argument here is being pattern-matched, not displayed. */
const classificationMethodNames = new Set([
	'test',
	'includes',
	'startsWith',
	'endsWith',
	'indexOf',
	'match',
	'search',
	'exec',
]);
/** Matches `Error`, or any class name ending in `Error` (e.g. `GitCommandError`). */
const errorClassName = /Error$/;
/** Known object-literal paths that are understood to carry the raw message into telemetry on purpose. */
const namedTelemetryPaths = new Set(['error.message', 'failure.error.message', 'items.error']);

/**
 * Is `node` an `X.message` read where `X` looks like an error?
 * @param {any} node
 */
function isErrorMessageRead(node) {
	return (
		node?.type === 'MemberExpression' &&
		!node.computed &&
		node.property?.type === 'Identifier' &&
		node.property.name === 'message' &&
		node.object?.type === 'Identifier' &&
		errorIdentifier.test(node.object.name)
	);
}

/**
 * The read is the object of a further member access or call, or the operand of `typeof` — a classification
 * read, not display.
 */
function isClassificationRead(node) {
	const parent = node.parent;
	if (parent == null) return false;

	if (parent.type === 'MemberExpression' && parent.object === node) return true;
	if (parent.type === 'CallExpression' && parent.callee === node) return true;
	if (parent.type === 'UnaryExpression' && parent.operator === 'typeof' && parent.argument === node) return true;

	return false;
}

/** The read is an operand of a comparison or `in`/`instanceof`. */
function isComparisonOperand(node) {
	const parent = node.parent;

	return (
		parent?.type === 'BinaryExpression' &&
		comparisonOperators.has(parent.operator) &&
		(parent.left === node || parent.right === node)
	);
}

/**
 * Climbs from a leaf expression through wrappers that don't change where the value ultimately lands —
 * optional chaining (`ChainExpression`), parens, `as`/`satisfies` casts, the branches of a ternary or `??`,
 * and template-literal interpolation — so the sink/property checks below see the real syntactic argument or
 * property value instead of stopping one of these wrappers short of it.
 * @param {any} node
 */
function unwrapToOuterExpression(node) {
	let current = node;

	for (;;) {
		const parent = current.parent;
		if (parent == null) return current;

		if (parent.type === 'ChainExpression' || parent.type === 'ParenthesizedExpression') {
			current = parent;
			continue;
		}
		if (parent.type === 'TSAsExpression' && parent.expression === current) {
			current = parent;
			continue;
		}
		if (
			parent.type === 'ConditionalExpression' &&
			(parent.consequent === current || parent.alternate === current)
		) {
			current = parent;
			continue;
		}
		if (parent.type === 'LogicalExpression' && (parent.left === current || parent.right === current)) {
			current = parent;
			continue;
		}
		if (parent.type === 'TemplateLiteral') {
			current = parent;
			continue;
		}

		return current;
	}
}

/**
 * Does `callExpressionOrNew`'s callee match one of the known non-display sinks (String(), a Logger/console
 * call, a scoped logger call, a telemetry call, or `new <X>Error()`)?
 * @param {any} node
 */
function calleeIsKnownSink(node) {
	if (node.type === 'NewExpression') {
		return node.callee?.type === 'Identifier' && errorClassName.test(node.callee.name);
	}

	const callee = node.callee;
	if (callee?.type === 'Identifier') return callee.name === 'String';

	if (callee?.type !== 'MemberExpression' || callee.computed || callee.property?.type !== 'Identifier') {
		return false;
	}

	if (callee.object?.type !== 'Identifier') return false;

	const propertyName = callee.property.name;
	if (callee.object.name === 'Logger' || callee.object.name === 'console') return true;
	if (loggerMethodNames.has(propertyName) && loggerObjectName.test(callee.object.name)) return true;
	if (telemetryCalleeNames.has(propertyName)) return true;

	return false;
}

/** Is `node` (through wrapper expressions) a direct argument of a call whose callee is a known sink? */
function isDirectArgumentOfKnownSink(node) {
	const outer = unwrapToOuterExpression(node);
	const parent = outer.parent;

	return (
		(parent?.type === 'CallExpression' || parent?.type === 'NewExpression') &&
		parent.arguments.includes(outer) &&
		calleeIsKnownSink(parent)
	);
}

/**
 * Is `node` (through wrapper expressions) a direct argument of a `.test()`/`.includes()`/`.match()`/… call —
 * a classification/pattern-match, e.g. `/No provider registered/i.test(ex.message)`?
 * @param {any} node
 */
function isArgumentOfClassificationCall(node) {
	const outer = unwrapToOuterExpression(node);
	const parent = outer.parent;
	if (parent?.type !== 'CallExpression' || !parent.arguments.includes(outer)) return false;

	const callee = parent.callee;

	return (
		callee?.type === 'MemberExpression' &&
		!callee.computed &&
		callee.property?.type === 'Identifier' &&
		classificationMethodNames.has(callee.property.name)
	);
}

/**
 * Is `node`'s callee a telemetry call (`sendEvent`, `sendTelemetryEvent`, `trackEvent`, `captureException`) —
 * bare (`sendEvent(...)`) or as a member call (`telemetry.sendEvent(...)`, the shape it takes everywhere in
 * this codebase)?
 * @param {any} node
 */
function isTelemetryCall(node) {
	if (node.type !== 'CallExpression') return false;

	const callee = node.callee;
	if (callee?.type === 'Identifier') return telemetryCalleeNames.has(callee.name);

	return (
		callee?.type === 'MemberExpression' &&
		!callee.computed &&
		callee.property?.type === 'Identifier' &&
		telemetryCalleeNames.has(callee.property.name)
	);
}

/** @param {any} property */
function propertyKeyName(property) {
	if (property.computed) return undefined;
	if (property.key?.type === 'Identifier') return property.key.name;
	if (property.key?.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;

	return undefined;
}

/**
 * Walks up through nested `{ key: { ... } }` object literals. If the outermost one is a direct argument to a
 * telemetry call, and the dotted key path (or any single segment of it) is a known error-carrying key, the
 * read is an intentional, labeled telemetry field rather than display text.
 * @param {any} node
 */
function isLabeledTelemetryField(node) {
	let current = unwrapToOuterExpression(node);
	/** @type {string[]} */
	const keyPath = [];

	while (current.parent?.type === 'Property' && current.parent.value === current) {
		const key = propertyKeyName(current.parent);
		if (key == null) return false;

		keyPath.unshift(key);

		const objectExpression = current.parent.parent;
		if (objectExpression?.type !== 'ObjectExpression') return false;

		const call = objectExpression.parent;
		if (call != null && call.arguments?.includes(objectExpression) && isTelemetryCall(call)) {
			const dotted = keyPath.join('.');
			if (namedTelemetryPaths.has(dotted) || keyPath.some(segment => /error/i.test(segment))) return true;
		}

		current = objectExpression;
	}

	return false;
}

/** Webview-side errors already arrive presentable; tests assert on the raw English message text. */
function isExemptFile(normalizedFilename) {
	return (
		normalizedFilename.includes('/webviews/apps/') ||
		normalizedFilename.includes('/__tests__/') ||
		normalizedFilename.endsWith('.test.ts')
	);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow reading a raw, untranslated `Error.message` outside a handful of known-safe uses',
			recommended: true,
		},
		messages: {
			usePresentable:
				'Use `getPresentableErrorMessage({{arg}})` here — on git errors `{{arg}}.message` is English, not the translated text.',
			useLocalized:
				'Use `{{arg}}.localizedMessage` here — `{{arg}}.message` is English, not the translated text.',
		},
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		// `context.filename` is only available inside the Program visitor, not in `createOnce` itself.
		let exempt = false;
		let inPackagesGit = false;

		return {
			Program() {
				const filename = (context.filename ?? '').replace(/\\/g, '/');
				// Scope: only `src/` and `packages/git/src/` — see the header comment for why the rest of
				// `packages/` is out of scope.
				const relative = path.relative(process.cwd(), filename).replace(/\\/g, '/');
				inPackagesGit = relative.startsWith('packages/git/src/');
				const inScope = relative.startsWith('src/') || inPackagesGit;

				exempt = !inScope || isExemptFile(filename);
			},
			/** @param {any} node */
			MemberExpression(node) {
				if (exempt) return;
				if (!isErrorMessageRead(node)) return;

				if (isClassificationRead(node)) return;
				if (isComparisonOperand(node)) return;
				if (isArgumentOfClassificationCall(node)) return;
				if (isDirectArgumentOfKnownSink(node)) return;
				if (isLabeledTelemetryField(node)) return;

				context.report({
					node,
					messageId: inPackagesGit ? 'useLocalized' : 'usePresentable',
					data: { arg: node.object.name },
				});
			},
		};
	},
};
