import * as assert from 'assert';
import { Marked } from 'marked';
import { defuseMarkdownLinks } from '../markdown.js';
import { encodeHtmlWeak } from '../string.js';

const zwsp = '\u200b';
const hrefRegex = /<a [^>]*href="([^"]*)"/g;

const marked = new Marked({ gfm: true, breaks: false });

/** Encodes and defuses `raw` the way commit messages are prepared, then renders it */
function render(raw: string): string {
	return marked.parse(defuseMarkdownLinks(encodeHtmlWeak(raw)), { async: false });
}

function getHrefs(html: string): string[] {
	return Array.from(html.matchAll(hrefRegex), m => m[1]);
}

function assertOnlyWebOrMailLinks(raw: string): void {
	const html = render(raw);
	for (const href of getHrefs(html)) {
		assert.match(href, /^(?:https?:\/\/|mailto:)/i, `Unexpected link destination '${href}' in: ${html}`);
	}
}

function assertNoLinks(raw: string): void {
	const html = render(raw);
	assert.ok(!html.includes('<a '), `Unexpected link in: ${html}`);
}

suite('Markdown Test Suite', () => {
	suite('defuseMarkdownLinks', () => {
		suite('inline links', () => {
			test('defuses a command: link', () => {
				assert.strictEqual(
					defuseMarkdownLinks('[x](command:workbench.action.files.newUntitledFile)'),
					`[x]${zwsp}(command:workbench.action.files.newUntitledFile)`,
				);
				assertNoLinks('[x](command:workbench.action.files.newUntitledFile)');
			});

			test('defuses other schemes and relative destinations', () => {
				for (const dest of [
					'vscode:extension/foo',
					'file:///etc/passwd',
					'javascript:alert(1)',
					'relative/path',
					'#anchor',
					'//host/path',
				]) {
					assert.strictEqual(defuseMarkdownLinks(`[x](${dest})`), `[x]${zwsp}(${dest})`, dest);
					assertNoLinks(`[x](${dest})`);
				}
			});

			test('defuses mixed case schemes', () => {
				assert.strictEqual(defuseMarkdownLinks('[x](COMMAND:foo)'), `[x]${zwsp}(COMMAND:foo)`);
				assert.strictEqual(defuseMarkdownLinks('[x](CoMmAnD:foo)'), `[x]${zwsp}(CoMmAnD:foo)`);
				assertNoLinks('[x](COMMAND:foo)');
			});

			test('defuses destinations preceded by whitespace or a newline', () => {
				for (const raw of [
					'[x]( command:foo)',
					'[x](\tcommand:foo)',
					'[x](\ncommand:foo)',
					'[x](  \n  command:foo)',
					'[x](\u00a0command:foo)',
				]) {
					assert.ok(defuseMarkdownLinks(raw).startsWith(`[x]${zwsp}(`), JSON.stringify(raw));
					assertNoLinks(raw);
				}
			});

			test('defuses entity-encoded schemes', () => {
				// What a commit message containing `com&#97;nd:` looks like after `encodeHtmlWeak`
				assert.strictEqual(
					defuseMarkdownLinks(encodeHtmlWeak('[x](com&#97;nd:foo)')),
					`[x]${zwsp}(com&amp;#97;nd:foo)`,
				);
				assertNoLinks('[x](com&#97;nd:foo)');

				// Raw entity form (in case un-encoded text ever reaches this)
				assert.strictEqual(defuseMarkdownLinks('[x](com&#97;nd:foo)'), `[x]${zwsp}(com&#97;nd:foo)`);
				assert.ok(!marked.parse(defuseMarkdownLinks('[x](com&#97;nd:foo)'), { async: false }).includes('<a '));

				// An entity-encoded allowed scheme fails closed
				assert.strictEqual(
					defuseMarkdownLinks('[x](htt&#112;s://example.com)'),
					`[x]${zwsp}(htt&#112;s://example.com)`,
				);
			});

			test('defuses escaped destinations', () => {
				assert.strictEqual(defuseMarkdownLinks('[x](\\command:foo)'), `[x]${zwsp}(\\command:foo)`);
				assertNoLinks('[x](\\command:foo)');
			});

			test('defuses angle-bracket destinations (in their encoded form)', () => {
				assert.strictEqual(
					defuseMarkdownLinks(encodeHtmlWeak('[x](<command:foo>)')),
					`[x]${zwsp}(&lt;command:foo&gt;)`,
				);
				assertNoLinks('[x](<command:foo>)');

				// Even an allowed destination in angle brackets fails closed, since after encoding it is not one
				assert.strictEqual(
					defuseMarkdownLinks(encodeHtmlWeak('[x](<https://example.com>)')),
					`[x]${zwsp}(&lt;https://example.com&gt;)`,
				);
				assertOnlyWebOrMailLinks('[x](<https://example.com>)');
			});

			test('defuses links with titles', () => {
				assert.strictEqual(defuseMarkdownLinks('[x](command:foo "title")'), `[x]${zwsp}(command:foo "title")`);
				assertNoLinks('[x](command:foo "title")');
				assertNoLinks("[x](command:foo 'title')");
				assertNoLinks('[x](command:foo (title))');
			});

			test('defuses images with disallowed sources', () => {
				assert.strictEqual(defuseMarkdownLinks('![x](command:foo)'), `![x]${zwsp}(command:foo)`);
				assertNoLinks('[![x](command:foo)](command:bar)');
				assert.ok(!render('![x](command:foo)').includes('<img'));
			});

			test('defuses nested links', () => {
				assertNoLinks('[[x](command:foo)](command:bar)');
				assertOnlyWebOrMailLinks('[[x](https://example.com)](command:bar)');
				assertOnlyWebOrMailLinks('[[x](command:foo)](https://example.com)');
			});
		});

		suite('reference links', () => {
			test('defuses full, collapsed and shortcut references', () => {
				assert.strictEqual(
					defuseMarkdownLinks('[x][ref]\n\n[ref]: command:foo'),
					`[x][ref]\n\n[ref]${zwsp}: command:foo`,
				);
				assertNoLinks('[x][ref]\n\n[ref]: command:foo');
				assertNoLinks('[x] [ref]\n\n[ref]: command:foo');
				assertNoLinks('[ref][]\n\n[ref]: command:foo');
				assertNoLinks('[ref]\n\n[ref]: command:foo');
				assertNoLinks('[ref]\n\n[ref]: command:foo "title"');
			});

			test('defuses definitions with destinations on the next line', () => {
				assertNoLinks('[ref]\n\n[ref]:\n  command:foo');
				assertNoLinks('[ref]\n\n[ref]:\tcommand:foo');
			});

			test('defuses definitions with mixed case, encoded or angle-bracket destinations', () => {
				assertNoLinks('[ref]\n\n[ref]: COMMAND:foo');
				assertNoLinks('[ref]\n\n[ref]: com&#97;nd:foo');
				assertNoLinks('[ref]\n\n[ref]: <command:foo>');
			});

			test('defuses definitions inside blockquotes, lists and indentation', () => {
				for (const raw of [
					'> [ref]: command:foo\n\n[ref]',
					'> > [ref]: command:foo\n\n[ref]',
					'- [ref]: command:foo\n\n[ref]',
					'1. [ref]: command:foo\n\n[ref]',
					'   [ref]: command:foo\n\n[ref]',
					'    [ref]: command:foo\n\n[ref]',
				]) {
					assert.ok(defuseMarkdownLinks(raw).includes(`[ref]${zwsp}:`), JSON.stringify(raw));
					assertNoLinks(raw);
				}
			});

			test('leaves allowed definitions intact', () => {
				const s = '[x][ref]\n\n[ref]: https://example.com';
				assert.strictEqual(defuseMarkdownLinks(s), s);
				assert.deepStrictEqual(getHrefs(render(s)), ['https://example.com']);
			});
		});

		suite('bare URLs', () => {
			test('leaves web and mail autolinks intact', () => {
				const s = 'see https://example.com, www.example.com and a@example.com';
				assert.strictEqual(defuseMarkdownLinks(s), s);
				assert.deepStrictEqual(getHrefs(render(s)), [
					'https://example.com',
					'http://www.example.com',
					'mailto:a@example.com',
				]);
			});

			test('neutralizes <scheme:...> autolinks via the HTML encoding', () => {
				assertNoLinks('<command:foo>');
				assertNoLinks('<vscode:extension/foo>');
			});
		});

		suite('allowed links', () => {
			test('leaves http, https and mailto links byte-identical', () => {
				for (const s of [
					'[ok](https://example.com)',
					'[ok](http://example.com/path?q=1#h)',
					'[m](mailto:a@b.c)',
					'[ok](HTTPS://example.com)',
					'[ok](MailTo:a@b.c)',
					'[ok]( https://example.com)',
					'[ok](\nhttps://example.com)',
					'[ok](https://example.com "title")',
				]) {
					assert.strictEqual(defuseMarkdownLinks(s), s, s);
					assert.strictEqual(getHrefs(render(s)).length, 1, s);
					assertOnlyWebOrMailLinks(s);
				}
			});

			test('handles multiple links on one line with mixed allowed and blocked destinations', () => {
				const s = '[a](https://a.com) [b](command:foo) [c](mailto:c@d.e) [d](vscode:x) [e](http://e.com)';
				assert.strictEqual(
					defuseMarkdownLinks(s),
					`[a](https://a.com) [b]${zwsp}(command:foo) [c](mailto:c@d.e) [d]${zwsp}(vscode:x) [e](http://e.com)`,
				);
				assert.deepStrictEqual(getHrefs(render(s)), ['https://a.com', 'mailto:c@d.e', 'http://e.com']);
			});
		});

		suite('general', () => {
			test('returns the same string when there are no brackets or URLs', () => {
				const s = 'Fixes a bug (in the parser): handles [ correctly';
				assert.strictEqual(defuseMarkdownLinks(s), s);
				assert.strictEqual(defuseMarkdownLinks(''), '');
			});

			test('leaves brackets that are not links byte-identical', () => {
				const s = '[WIP] Fixes array[0] (see #123)';
				assert.strictEqual(defuseMarkdownLinks(s), s);
			});

			test('is idempotent', () => {
				for (const s of [
					'[x](command:foo) [y](https://ok) [r]: vscode:x',
					'[x][ref]\n\n> [ref]: command:foo',
					'[ok](https://example.com)',
				]) {
					const once = defuseMarkdownLinks(s);
					assert.strictEqual(defuseMarkdownLinks(once), once, s);
				}
			});

			test('does not visibly alter text inside code spans', () => {
				assert.strictEqual(render('`[x](command:foo)`'), `<p><code>[x]${zwsp}(command:foo)</code></p>\n`);
			});

			test('runs in linear time on adversarial input', () => {
				const s = `${'](\t \n'.repeat(20000)}${']:'.repeat(20000)}${' '.repeat(20000)}`;
				const start = Date.now();
				defuseMarkdownLinks(s);
				assert.ok(Date.now() - start < 1000);
			});
		});
	});
});
