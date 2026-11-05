import * as assert from 'assert';
import { Marked } from 'marked';
import { getUntrustedLinkHref, untrustedMarkdownRenderer } from '../markdown.utils.js';

suite('untrusted markdown', () => {
	const marked = new Marked({ breaks: true, gfm: true, renderer: untrustedMarkdownRenderer });
	const render = (markdown: string) => marked.parse(markdown, { async: false }).trim();

	test('allows only absolute http, https and mailto links', () => {
		assert.strictEqual(getUntrustedLinkHref('https://gitkraken.dev/a?b=1&c=2'), 'https://gitkraken.dev/a?b=1&c=2');
		assert.strictEqual(getUntrustedLinkHref('http://example.com'), 'http://example.com/');
		assert.strictEqual(getUntrustedLinkHref('mailto:support@gitkraken.com'), 'mailto:support@gitkraken.com');

		for (const href of [
			'command:gitlens.showSettingsPage',
			'javascript:alert(1)',
			'JavaScript:alert(1)',
			'&#106;avascript:alert(1)',
			'file:///etc/passwd',
			'vscode://gitkraken.gitlens/link',
			'data:text/html,<script>alert(1)</script>',
			'/relative/path',
			'relative',
			'',
			undefined,
		]) {
			assert.strictEqual(getUntrustedLinkHref(href), undefined, `${href} must not become a link`);
		}
	});

	test('renders safe links as anchors', () => {
		assert.strictEqual(
			render('Read [the docs](https://help.gitkraken.com/x?a=1&b="2" "Docs")'),
			'<p>Read <a href="https://help.gitkraken.com/x?a=1&amp;b=%222%22" title="Docs">the docs</a></p>',
		);
		assert.strictEqual(
			render('<https://gitkraken.dev>'),
			'<p><a href="https://gitkraken.dev/">https://gitkraken.dev</a></p>',
		);
	});

	test('renders unsafe links as their text only', () => {
		assert.strictEqual(render('[Open](command:gitlens.openSettings)'), '<p>Open</p>');
		assert.strictEqual(render('[Run](javascript:alert(1))'), '<p>Run</p>');
		assert.strictEqual(render('[a <b>bold</b> link](file:///etc/passwd)'), '<p>a &lt;b&gt;bold&lt;/b&gt; link</p>');
	});

	test('renders no images', () => {
		assert.strictEqual(render('Look ![alt <b>x</b>](https://example.com/a.png)'), '<p>Look </p>');
		assert.strictEqual(
			render('[![img](https://example.com/a.png)](https://example.com)'),
			'<p><a href="https://example.com/"></a></p>',
		);
	});

	test('escapes raw HTML', () => {
		assert.strictEqual(
			render('Hi <span style="color:red" onclick="x()">there</span>'),
			'<p>Hi &lt;span style=&quot;color:red&quot; onclick=&quot;x()&quot;&gt;there&lt;/span&gt;</p>',
		);
		assert.strictEqual(render('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
	});
});
