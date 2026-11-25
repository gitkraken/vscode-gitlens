// Initialize the command registry through the same entry path as the extension.
import '../../container.js';
import * as assert from 'node:assert/strict';
import { marked } from 'marked';
import type {
	AutolinkReference,
	CacheableAutolinkReference,
	DynamicAutolinkReference,
} from '@gitlens/git/models/autolink.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { IssuesCloudHostIntegrationId } from '@gitlens/integrations/constants.js';
import { defer } from '@gitlens/utils/promise.js';
import { encodeHtmlWeak } from '@gitlens/utils/string.js';
import type { Container } from '../../container.js';
import { AutolinksProvider } from '../autolinksProvider.js';
import type { Autolink, EnrichedAutolink, MaybeEnrichedAutolink } from '../models/autolinks.js';

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

function jiraProjectRefs(key: string): AutolinkReference[] {
	const descriptor = { id: 'site', key: 'site', name: 'Site', url: 'https://site.atlassian.net' };
	return [
		{
			prefix: `${key}-`,
			url: `https://site.atlassian.net/browse/${key}-<num>`,
			alphanumeric: false,
			ignoreCase: false,
			title: `Open Issue ${key}-<num> on Site`,
			type: 'issue',
			description: `Site Issue ${key}-<num>`,
			descriptor: descriptor,
		},
	];
}

/**
 * Stands in for a core issue tracker whose `autolinks()` serves its own cache: what it returns changes when core drops
 * that cache (#6170), evicts a missing project (#6176) or rebuilds an expired set (#5907), none of which fires an
 * integration event the host listens to.
 */
function createIntegrationProvider(): {
	provider: AutolinksProvider;
	jira: { autolinks: () => AutolinkReference[] | Promise<AutolinkReference[]> };
} {
	const jira = {
		id: IssuesCloudHostIntegrationId.Jira,
		name: 'Jira',
		domain: 'atlassian.net',
		maybeConnected: true,
		autolinks: (): AutolinkReference[] | Promise<AutolinkReference[]> => [],
		access: () => Promise.resolve(false),
	};
	const container = {
		integrations: {
			onDidChange: () => ({ dispose: () => {} }),
			onDidChangeConnectionState: () => ({ dispose: () => {} }),
			get: (id: string) => Promise.resolve(id === IssuesCloudHostIntegrationId.Jira ? jira : undefined),
		},
	} as unknown as Container;
	return { provider: new AutolinksProvider(container), jira: jira };
}

function urls(autolinks: Map<string, Autolink>): string[] {
	return Array.from(autolinks.values(), a => a.url).sort();
}

function enrichedUrls(enriched: Map<string, EnrichedAutolink> | undefined): string[] {
	return Array.from(enriched?.values() ?? [], ([, a]) => a.url).sort();
}

function enrichedPrefixes(enriched: Map<string, EnrichedAutolink> | undefined): string[] {
	return Array.from(enriched?.values() ?? [], ([, a]) => a.prefix).sort();
}

const proj1 = 'https://site.atlassian.net/browse/PROJ-1';
const new2 = 'https://site.atlassian.net/browse/NEW-2';

suite('AutolinksProvider integration autolinks freshness (#6183)', () => {
	test('a render after core replaces its autolink set reflects the new set', async () => {
		const { provider, jira } = createIntegrationProvider();
		try {
			jira.autolinks = () => jiraProjectRefs('PROJ');
			assert.deepEqual(urls(await provider.getAutolinks('PROJ-1 NEW-2')), [proj1]);

			// A drop, an eviction or a TTL rebuild in core: the next `autolinks()` serves the new set
			jira.autolinks = () => [...jiraProjectRefs('PROJ'), ...jiraProjectRefs('NEW')];
			assert.deepEqual(urls(await provider.getAutolinks('PROJ-1 NEW-2')), [new2, proj1]);

			jira.autolinks = () => jiraProjectRefs('NEW');
			assert.deepEqual(urls(await provider.getAutolinks('PROJ-1 NEW-2')), [new2]);
		} finally {
			provider.dispose();
		}
	});

	test('a render after a core drop does not join a pre-drop pending set', async () => {
		const { provider, jira } = createIntegrationProvider();
		try {
			const preDrop = defer<AutolinkReference[]>();
			const reachedCore = defer<void>();
			jira.autolinks = () => {
				reachedCore.fulfill();
				return preDrop.promise;
			};
			const beforeDrop = provider.getAutolinks('PROJ-1 NEW-2');
			await reachedCore.promise;

			jira.autolinks = () => jiraProjectRefs('NEW');
			const afterDrop = provider.getAutolinks('PROJ-1 NEW-2');

			preDrop.fulfill(jiraProjectRefs('PROJ'));
			assert.deepEqual(urls(await beforeDrop), [proj1]);
			assert.deepEqual(urls(await afterDrop), [new2]);
		} finally {
			provider.dispose();
		}
	});

	test('enriched autolinks for a message follow a core autolink set change', async () => {
		const { provider, jira } = createIntegrationProvider();
		try {
			jira.autolinks = () => jiraProjectRefs('PROJ');
			assert.deepEqual(enrichedUrls(await provider.getEnrichedAutolinks('PROJ-1 NEW-2', undefined)), [proj1]);

			jira.autolinks = () => jiraProjectRefs('NEW');
			// A peek must not serve what was enriched from the previous set
			assert.deepEqual(
				enrichedUrls(await provider.getEnrichedAutolinks('PROJ-1 NEW-2', undefined, { cached: true })),
				[],
			);
			assert.deepEqual(enrichedUrls(await provider.getEnrichedAutolinks('PROJ-1 NEW-2', undefined)), [new2]);
			assert.deepEqual(
				enrichedUrls(await provider.getEnrichedAutolinks('PROJ-1 NEW-2', undefined, { cached: true })),
				[new2],
			);
		} finally {
			provider.dispose();
		}
	});

	test('enriched autolinks for resolved autolinks are not served from another set with the same ids', async () => {
		const { provider } = createIntegrationProvider();
		try {
			const link = (key: string): Autolink => ({
				...jiraProjectRefs(key)[0],
				id: '2',
				url: `https://site.atlassian.net/browse/${key}-2`,
			});
			// Same id, as two projects' issue 2 parse to: only the link tells them apart
			const before = new Map([['2', link('PROJ')]]);
			const after = new Map([['2', link('NEW')]]);

			assert.deepEqual(enrichedUrls(await provider.getEnrichedAutolinks(before, undefined)), [
				'https://site.atlassian.net/browse/PROJ-2',
			]);
			assert.deepEqual(enrichedUrls(await provider.getEnrichedAutolinks(after, undefined)), [new2]);
		} finally {
			provider.dispose();
		}
	});

	test('enriched autolinks for a message are not served for another prefix linking the same url', async () => {
		const { provider, jira } = createIntegrationProvider();
		try {
			// Like GitHub's `#12` and `gh-12`: two prefixes, one url
			const [ref] = jiraProjectRefs('PROJ');
			const refs = [ref, { ...ref, prefix: 'ISSUE-', ignoreCase: true }];
			jira.autolinks = () => refs;
			assert.deepEqual(enrichedPrefixes(await provider.getEnrichedAutolinks('Fixes PROJ-1', undefined)), [
				'PROJ-',
			]);

			const enriched = await provider.getEnrichedAutolinks('Fixes ISSUE-1', undefined);
			assert.deepEqual(enrichedPrefixes(enriched), ['ISSUE-']);
			const rendered = provider.linkify(
				'Fixes ISSUE-1',
				'html',
				undefined,
				new Map(Array.from(enriched ?? [], ([id, [, link]]) => [id, [undefined, link] as const])),
			);
			assert.ok(rendered.includes(`href="${proj1}"`), rendered);
		} finally {
			provider.dispose();
		}
	});
});
