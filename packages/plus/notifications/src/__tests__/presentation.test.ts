import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	formatUnreadCount,
	getCategoryChip,
	getDisplayBody,
	isSafeExternalUrl,
	isToastEligible,
	toPlainText,
} from '../presentation.js';

suite('presentation', () => {
	test('getCategoryChip gives every content type but feature a chip', () => {
		assert.strictEqual(getCategoryChip('help'), 'help');
		assert.strictEqual(getCategoryChip('marketing'), 'offer');
		assert.strictEqual(getCategoryChip('security'), 'security');
		assert.strictEqual(getCategoryChip('system'), 'system');
		assert.strictEqual(getCategoryChip('feature'), undefined);
	});

	test('isToastEligible is limited to security and system', () => {
		assert.strictEqual(isToastEligible({ contentType: 'security' }), true);
		assert.strictEqual(isToastEligible({ contentType: 'system' }), true);
		assert.strictEqual(isToastEligible({ contentType: 'marketing' }), false);
		assert.strictEqual(isToastEligible({ contentType: 'help' }), false);
		assert.strictEqual(isToastEligible({ contentType: 'feature' }), false);
	});

	test('isSafeExternalUrl only allows https', () => {
		assert.strictEqual(isSafeExternalUrl('https://gitkraken.dev/settings'), true);
		assert.strictEqual(isSafeExternalUrl('HTTPS://gitkraken.dev'), true);
		assert.strictEqual(isSafeExternalUrl('http://gitkraken.dev'), false);
		assert.strictEqual(isSafeExternalUrl('command:gitlens.showSettingsPage'), false);
		assert.strictEqual(isSafeExternalUrl('javascript:alert(1)'), false);
		assert.strictEqual(isSafeExternalUrl('vscode://eamodio.gitlens'), false);
		assert.strictEqual(isSafeExternalUrl('/relative'), false);
		assert.strictEqual(isSafeExternalUrl(''), false);
	});

	test('formatUnreadCount caps at 99+', () => {
		assert.strictEqual(formatUnreadCount(0), '0');
		assert.strictEqual(formatUnreadCount(99), '99');
		assert.strictEqual(formatUnreadCount(100), '99+');
	});

	test('getDisplayBody drops a first paragraph that repeats the headline and keeps the rest', () => {
		assert.strictEqual(
			getDisplayBody(
				'jane@acme.dev has requested to join Acme. This request is waiting on your approval.',
				'jane@acme.dev has requested to join _Acme_. This request is waiting on your approval. \n\n**User message:**\n_Hi! Please let me in._\n',
			),
			'**User message:**\n_Hi! Please let me in._',
		);
	});

	test('getDisplayBody returns undefined when the body only repeats the headline', () => {
		assert.strictEqual(
			getDisplayBody(
				'3 people are waiting for your approval to join Acme.',
				'3 people are waiting for your approval to join _Acme_.',
			),
			undefined,
		);
		// A trailing period difference and markdown code/strong markers are ignored
		assert.strictEqual(getDisplayBody('Update `main` now', '**Update** `main`  now.'), undefined);
	});

	test('getDisplayBody leaves non-matching bodies unchanged', () => {
		assert.strictEqual(
			getDisplayBody('New release', 'GitLens 18 is out.\n\nSee what changed.'),
			'GitLens 18 is out.\n\nSee what changed.',
		);
		// Only the first paragraph is ever dropped
		assert.strictEqual(getDisplayBody('Heads up', 'Something else.\n\nHeads up'), 'Something else.\n\nHeads up');
		assert.strictEqual(getDisplayBody('Heads up', 'Heads up, more text'), 'Heads up, more text');
	});

	test('getDisplayBody returns undefined without a body', () => {
		assert.strictEqual(getDisplayBody('Headline', undefined), undefined);
		assert.strictEqual(getDisplayBody('Headline', '  \n '), undefined);
	});

	test('toPlainText keeps the alt text of images and the text of links', () => {
		assert.strictEqual(
			toPlainText('See ![logo](https://x.dev/a.png) and [docs](https://x.dev/d)'),
			'See logo and docs',
		);
	});

	test('toPlainText strips HTML tags', () => {
		assert.strictEqual(toPlainText('Hello <b>there</b><br/>friend'), 'Hello there friend');
	});

	test('toPlainText removes emphasis, code and strike markers', () => {
		assert.strictEqual(toPlainText('Your **poll** is _live_, `run` ~~it~~ *now*'), 'Your poll is live, run it now');
	});

	test('toPlainText keeps underscores and asterisks inside words', () => {
		assert.strictEqual(toPlainText('Rename _my_feature_flag_ to a*b'), 'Rename my_feature_flag to a*b');
	});

	test('toPlainText removes heading, blockquote and list markers at line starts', () => {
		assert.strictEqual(
			toPlainText('## Title\n> quoted\n- one\n* two\n+ three\n1. four'),
			'Title quoted one two three four',
		);
	});

	test('toPlainText collapses whitespace and trims', () => {
		assert.strictEqual(toPlainText('  a \n\n  b\t c  '), 'a b c');
		assert.strictEqual(toPlainText(''), '');
	});
});
