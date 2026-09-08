// Initialize the command registry through the same entry path as the extension.
import '../../container.js';
import * as assert from 'node:assert/strict';
import { marked } from 'marked';
import type { CacheableAutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { encodeHtmlWeak } from '@gitlens/utils/string.js';
import { AutolinksProvider } from '../autolinksProvider.js';
import type { MaybeEnrichedAutolink } from '../models/autolinks.js';

function createProvider(references: CacheableAutolinkReference[] = []): AutolinksProvider {
	const provider = Object.create(AutolinksProvider.prototype) as AutolinksProvider;
	Reflect.set(
		provider,
		'_references',
		references.map(ref => ({ ...ref })),
	);
	return provider;
}

const hostileTitle = 'Open "quoted" \\ title\n\n[extra](https://unwanted.invalid) <img src=x onerror="bad()">';
const reference = {
	prefix: '#',
	url: 'https://example.com/issues/<num>',
	title: hostileTitle,
	description: '[injected](https://unwanted.invalid) <img>',
	alphanumeric: false,
	ignoreCase: false,
} satisfies CacheableAutolinkReference;

suite('Autolink presentation escaping', () => {
	test('keeps cacheable titles and footnote labels inert in HTML and Markdown', () => {
		const provider = createProvider([reference]);
		const htmlNotes = new Map<number, string>();
		assert.equal(
			provider.linkify('#23', 'html', undefined, undefined, undefined, htmlNotes),
			`<a href="https://example.com/issues/23" title="${encodeHtmlWeak(hostileTitle)}">#23</a>`,
		);
		assert.ok(htmlNotes.get(1)?.includes(`title="${encodeHtmlWeak(hostileTitle)}">`));
		assert.ok(htmlNotes.get(1)?.includes(encodeHtmlWeak(reference.description)));

		const markdownNotes = new Map<number, string>();
		const markdown = provider.linkify('#23', 'markdown', undefined, undefined, undefined, markdownNotes);
		for (const source of [markdown, markdownNotes.get(1)!]) {
			const rendered = marked.parseInline(source, { async: false });
			assert.equal((rendered.match(/<a /g) ?? []).length, 1, rendered);
			assert.equal(rendered.includes('<img'), false, rendered);
			assert.ok(rendered.includes('href="command:gitlens.action.openIssue?'), rendered);
		}
	});

	test('keeps dynamic titles inert and preserves the destination and displayed reference', () => {
		const dynamic = {
			parse: () => {},
			descriptors: [
				{
					regex: /(repo)#(\d+)/g,
					url: (_repo: string, num: string) => `https://example.com/issues/${num}`,
					title: () => hostileTitle,
					label: () => reference.description,
				},
			],
		} satisfies DynamicAutolinkReference;
		const remotes = [{ provider: { autolinks: [dynamic] } }] as unknown as GitRemote[];
		const provider = createProvider();
		assert.equal(
			provider.linkify('repo#23', 'html', remotes),
			`<a href="https://example.com/issues/23" title="${encodeHtmlWeak(hostileTitle)}">repo#23</a>`,
		);
		const footnotes = new Map<number, string>();
		const markdown = provider.linkify('repo#23', 'markdown', remotes, undefined, undefined, footnotes);
		for (const source of [markdown, footnotes.get(1)!]) {
			const rendered = marked.parseInline(source, { async: false });
			assert.equal((rendered.match(/<a /g) ?? []).length, 1, rendered);
			assert.equal(rendered.includes('<img'), false, rendered);
			assert.ok(rendered.includes('href="https://example.com/issues/23"'), rendered);
		}
	});

	test('preserves encoded reference text in enriched HTML footnotes', () => {
		const issue: IssueOrPullRequest = {
			type: 'issue',
			provider: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
			id: '23',
			nodeId: undefined,
			title: 'Raw issue title',
			url: 'https://example.com/issues/23',
			createdDate: new Date(),
			updatedDate: new Date(),
			closed: false,
			state: 'opened',
		};
		const enriched = new Map<string, MaybeEnrichedAutolink>([
			[
				'23',
				[
					{ paused: false, value: issue },
					{ ...reference, prefix: '&', id: '23' },
				],
			],
		]);
		const footnotes = new Map<number, string>();
		createProvider().linkify('&amp;23', 'html', undefined, enriched, undefined, footnotes);
		assert.ok(footnotes.get(1)?.includes('&amp;23 opened '), footnotes.get(1));
		assert.equal(footnotes.get(1)?.includes('&amp;amp;23'), false);
	});

	test('omits absent HTML titles instead of creating an unclosed attribute', () => {
		const provider = createProvider([{ ...reference, title: undefined }]);
		assert.equal(provider.linkify('#23', 'html'), '<a href="https://example.com/issues/23">#23</a>');
	});
});
