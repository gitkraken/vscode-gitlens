import * as assert from 'assert';
import { Marked } from 'marked';
import {
	getCommandLinkId,
	getCommandLinkRenderer,
	getUntrustedLinkHref,
	isAllowedRawHtml,
	untrustedMarkdownRenderer,
} from '../markdown.utils.js';

suite('command links in trusted markdown', () => {
	const createRender = (allowedCommands?: string[], untrusted?: boolean) => {
		let renderer = getCommandLinkRenderer(allowedCommands != null ? new Set(allowedCommands) : undefined);
		if (untrusted) {
			renderer = { ...renderer, ...untrustedMarkdownRenderer };
		}
		const marked = new Marked({ breaks: true, gfm: true, renderer: renderer });
		return (markdown: string) => marked.parse(markdown, { async: false }).trim();
	};
	const defaultMarked = new Marked({ breaks: true, gfm: true });
	const renderDefault = (markdown: string) => defaultMarked.parse(markdown, { async: false }).trim();

	const render = createRender();
	const renderAllowed = createRender(['gitlens.showCommitInView', 'gitlens.action.openIssue']);

	test('extracts the command id the browser would run', () => {
		assert.strictEqual(getCommandLinkId('command:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('command:gitlens.foo?%7B%22a%22%3A1%7D'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('command:gitlens.foo?bar#baz'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('command:gitlens.foo#baz'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('COMMAND:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('CoMmAnD:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId(' \t\x01command:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('com\tmand:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('comm\nand:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('comm\r\nand:gitlens.f\too'), 'gitlens.foo');
		// Character references the browser decodes in the href attribute
		assert.strictEqual(getCommandLinkId('&#99;ommand:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('&#x63;ommand:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('command&colon;gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('command&#58;gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('com&Tab;mand:gitlens.foo'), 'gitlens.foo');
		assert.strictEqual(getCommandLinkId('&NewLine;command:gitlens.foo'), 'gitlens.foo');

		for (const href of [
			'https://example.com/command:gitlens.foo',
			'http://example.com',
			'HTTPS://example.com',
			'mailto:command@example.com',
			'vscode://gitkraken.gitlens/link',
			'javascript:alert(1)',
			'file:///command:gitlens.foo',
			'commands:gitlens.foo',
			'xcommand:gitlens.foo',
			'command%3Agitlens.foo',
			'./command:gitlens.foo',
			'/relative/path',
			'#anchor',
			'relative',
			'',
			undefined,
		]) {
			assert.strictEqual(getCommandLinkId(href), undefined, `${href} must not be a command link`);
		}
	});

	test('renders no command links when none are allowed', () => {
		assert.strictEqual(render('[Open](command:gitlens.showCommitInView)'), '<p>Open</p>');
		assert.strictEqual(
			render('[a **bold** link](command:gitlens.foo?%5B1%5D "Title")'),
			'<p>a <strong>bold</strong> link</p>',
		);
		assert.strictEqual(render('<command:gitlens.foo>'), '<p>command:gitlens.foo</p>');
		assert.strictEqual(render('[Open][ref]\n\n[ref]: command:gitlens.foo'), '<p>Open</p>');
		assert.strictEqual(createRender([])('[Open](command:gitlens.foo)'), '<p>Open</p>');
	});

	test('renders allowed command links as anchors, exactly as before', () => {
		for (const markdown of [
			'[Open](command:gitlens.showCommitInView)',
			'[Open](command:gitlens.showCommitInView?%7B%22a%22%3A%22%5C%28x%5C%29%22%7D "Show Commit")',
			'[`$(git-commit) abc1234`](command:gitlens.showCommitInView?%5B%22x%22%5D)',
			'[#123](command:gitlens.action.openIssue?%7B%7D "Open Issue #123")',
		]) {
			const rendered = renderAllowed(markdown);
			assert.ok(rendered.includes('<a href="command:'), `${markdown} must render as a link`);
			assert.strictEqual(rendered, renderDefault(markdown));
		}
	});

	test('renders command links that are not allowed as their text only', () => {
		assert.strictEqual(renderAllowed('[Run](command:workbench.action.terminal.new)'), '<p>Run</p>');
		assert.strictEqual(renderAllowed('[Run](command:gitlens.showCommitInView2)'), '<p>Run</p>');
		assert.strictEqual(renderAllowed('[Run](command:gitlens.showCommit)'), '<p>Run</p>');
		assert.strictEqual(renderAllowed('[Run](command:xgitlens.showCommitInView)'), '<p>Run</p>');
		assert.strictEqual(renderAllowed('[Run](command:gitlens.action.openIssue.x)'), '<p>Run</p>');
		assert.strictEqual(renderAllowed('[Run](command:GITLENS.SHOWCOMMITINVIEW)'), '<p>Run</p>');
		assert.strictEqual(renderAllowed('[Run](command:/gitlens.showCommitInView)'), '<p>Run</p>');
		assert.strictEqual(renderAllowed('[Run](command:gitlens%2EshowCommitInView)'), '<p>Run</p>');
	});

	test('treats an obscured command scheme as a command link', () => {
		for (const markdown of [
			'[Run](COMMAND:workbench.action.terminal.new)',
			'[Run](<\tcommand:workbench.action.terminal.new>)',
			'[Run](<com\tmand:workbench.action.terminal.new>)',
			'[Run](&#99;ommand:workbench.action.terminal.new)',
			'[Run](command&colon;workbench.action.terminal.new)',
			'[Run](&#x43;OMMAND&#58;workbench.action.terminal.new)',
		]) {
			assert.strictEqual(render(markdown), '<p>Run</p>', markdown);
			assert.strictEqual(renderAllowed(markdown), '<p>Run</p>', markdown);
		}
	});

	test('renders every other link exactly as before', () => {
		for (const markdown of [
			'[docs](https://help.gitkraken.com/x?a=1&b="2" "Docs")',
			'[docs](http://example.com/a%20b)',
			'[docs](<https://example.com/a b> "a \\"title\\"")',
			'[mail](mailto:support@gitkraken.com)',
			'[file](./relative/path.md)',
			'[anchor](#section)',
			'[ext](vscode://gitkraken.gitlens/link)',
			'[amp](https://example.com/?a=1&amp;b=2)',
			'<https://gitkraken.dev>',
			'see https://gitkraken.dev/path and www.example.com',
			'[**bold** `code`](https://example.com)',
			'[![img](https://example.com/a.png)](https://example.com)',
		]) {
			assert.strictEqual(render(markdown), renderDefault(markdown), markdown);
			assert.strictEqual(renderAllowed(markdown), renderDefault(markdown), markdown);
		}
	});

	test('untrusted rendering ignores allowed commands', () => {
		const renderUntrusted = createRender(['gitlens.showCommitInView'], true);
		assert.strictEqual(renderUntrusted('[Open](command:gitlens.showCommitInView)'), '<p>Open</p>');
		assert.strictEqual(
			renderUntrusted('[docs](https://gitkraken.dev)'),
			'<p><a href="https://gitkraken.dev/">docs</a></p>',
		);
	});
});

suite('raw HTML in trusted markdown', () => {
	test('keeps only a single styling span tag', () => {
		assert.ok(isAllowedRawHtml('<span style="color:#35b15e;">'));
		assert.ok(isAllowedRawHtml('<span class="codicon codicon-git-commit">'));
		assert.ok(isAllowedRawHtml('</span>'));
		assert.ok(isAllowedRawHtml('</ span>'));
		assert.ok(isAllowedRawHtml('<span class="x">\n'));

		for (const html of [
			'<a href="command:gitlens.foo">',
			'<span class="x">\n<a href="command:gitlens.foo">click</a>',
			'<a href="command:gitlens.foo">\nclick</a></span>',
			'<div>\n<a href="command:gitlens.foo">click</a></span>',
			'<!-- c --><a href="command:gitlens.foo">x</a></span>',
			'<span class="x"><img src=x onerror="alert(1)">',
			'<span>',
			'<spanx>',
			'<img src="x">',
		]) {
			assert.ok(!isAllowedRawHtml(html), html);
		}
	});
});

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
