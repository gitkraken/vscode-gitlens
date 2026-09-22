import * as assert from 'assert';
import type { GraphIntentKind } from '../../../../plus/graph/protocol.js';
import { getIntentCopy, getIntentSourceDetail, getIntentTelemetryDetail } from '../intentCopy.js';

const allIntentKinds: GraphIntentKind[] = [
	'show-commit',
	'show-branch',
	'show-tag',
	'show-stash',
	'show-file-history',
	'show-folder-history',
	'open-compare',
	'show-wip',
	'scope-to-branch',
	'show-rebase-summary',
	'enter-compose',
	'enter-review',
	'enter-resolve',
];

suite('graph intent copy', () => {
	test('every intent kind has a heading and a body', () => {
		for (const kind of allIntentKinds) {
			const copy = getIntentCopy({ kind: kind });
			assert.notStrictEqual(copy, undefined, `${kind} has no copy`);
			assert.ok((copy?.heading.length ?? 0) > 0, `${kind} has an empty heading`);
			assert.ok((copy?.body.length ?? 0) > 0, `${kind} has an empty body`);
		}
	});

	test('an intentless arrival has no copy', () => {
		assert.strictEqual(getIntentCopy(undefined), undefined);
	});

	test('a subject-dependent promise is omitted without a subject', () => {
		assert.strictEqual(getIntentCopy({ kind: 'show-commit' })?.promise, undefined);
		assert.strictEqual(getIntentCopy({ kind: 'show-commit', subject: '' })?.promise, undefined);
	});

	test('a subject-dependent promise names its subject', () => {
		const promise = getIntentCopy({ kind: 'show-commit', subject: 'a1b2c3d' })?.promise;
		assert.ok(promise != null);
		assert.strictEqual(promise.subject, 'a1b2c3d');
		assert.ok(promise.message.includes('{subject}'), promise.message);
	});

	test('scope-to-branch falls back to the current-branch promise', () => {
		const fallback = getIntentCopy({ kind: 'scope-to-branch' })?.promise;
		assert.ok(fallback != null);
		assert.strictEqual(fallback.message, 'The Commit Graph will focus on your current branch.');
		assert.strictEqual(fallback.subject, undefined);

		const named = getIntentCopy({ kind: 'scope-to-branch', subject: 'feature/x' })?.promise;
		assert.ok(named != null);
		assert.strictEqual(named.subject, 'feature/x');
		assert.ok(named.message.includes('{subject}'), named.message);
	});

	test('the compare promise needs both refs', () => {
		assert.strictEqual(getIntentCopy({ kind: 'open-compare' })?.promise, undefined);
		assert.strictEqual(getIntentCopy({ kind: 'open-compare', subject: 'main' })?.promise, undefined);
		assert.strictEqual(getIntentCopy({ kind: 'open-compare', subject2: 'dev' })?.promise, undefined);

		const promise = getIntentCopy({ kind: 'open-compare', subject: 'main', subject2: 'dev' })?.promise;
		assert.ok(promise != null);
		assert.strictEqual(promise.subject, 'main');
		assert.strictEqual(promise.subject2, 'dev');
		assert.ok(promise.message.includes('{subject}') && promise.message.includes('{subject2}'), promise.message);
	});

	test('the subjectless promises are always emitted', () => {
		assert.ok((getIntentCopy({ kind: 'show-wip' })?.promise?.message.length ?? 0) > 0);
		assert.ok((getIntentCopy({ kind: 'show-rebase-summary' })?.promise?.message.length ?? 0) > 0);
	});

	test('an intentless arrival keeps the bare telemetry detail', () => {
		assert.strictEqual(getIntentSourceDetail('gate', undefined), 'gate');
		assert.strictEqual(getIntentSourceDetail('signin', undefined), 'signin');
	});

	test('the shipped telemetry details are unchanged', () => {
		assert.strictEqual(getIntentSourceDetail('gate', { kind: 'enter-compose' }), 'gate:compose');
		assert.strictEqual(getIntentSourceDetail('gate', { kind: 'enter-review' }), 'gate:review');
		assert.strictEqual(getIntentSourceDetail('gate', { kind: 'enter-resolve' }), 'gate:resolve');
		assert.strictEqual(getIntentSourceDetail('gate', { kind: 'open-compare' }), 'gate:compare');
	});

	test('the impression and conversion keys agree', () => {
		// The sign-in screen reports its impression with the bare slug and its conversions with
		// `signin:<slug>`; a drift between them would silently break conversion-rate slicing.
		for (const kind of allIntentKinds) {
			const slug = getIntentTelemetryDetail({ kind: kind });
			assert.ok(slug != null, `${kind} produced no telemetry slug`);
			assert.strictEqual(getIntentSourceDetail('signin', { kind: kind }), `signin:${slug}`);
		}

		assert.strictEqual(getIntentTelemetryDetail(undefined), undefined);
	});

	test('every intent kind has a telemetry detail', () => {
		for (const kind of allIntentKinds) {
			const detail = getIntentSourceDetail('signin', { kind: kind });
			assert.notStrictEqual(detail, 'signin', `${kind} produced no telemetry detail`);
			assert.ok(detail.startsWith('signin:'), detail);
		}
	});
});
