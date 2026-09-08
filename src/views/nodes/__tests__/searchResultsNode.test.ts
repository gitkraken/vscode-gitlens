// Initialize the command registry through the same entry path as the extension.
import '../../../container.js';
import * as assert from 'node:assert';
import * as sinon from 'sinon';
import { l10n, Uri } from 'vscode';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { StoredSearch } from '../../../constants.storage.js';
import { getSearchQuery } from '../../../git/utils/-webview/search.utils.js';
import type { SearchAndCompareView } from '../../searchAndCompareView.js';
import type { ViewNode } from '../abstract/viewNode.js';
import { SearchResultsNode } from '../searchResultsNode.js';

suite('SearchResultsNode localization', () => {
	let sandbox: sinon.SinonSandbox;

	setup(async () => {
		sandbox = sinon.createSandbox();
		const { Container } = await import('../../../container.js');
		sandbox.stub(Container, 'instance').get(() => ({
			git: {
				getAbsoluteUri: (path: string) => Uri.file(path),
			},
		}));
	});

	teardown(() => {
		sandbox.restore();
	});

	test('stores the raw query and rebuilds a reorderable localized title when restored', async () => {
		const search: SearchQuery = {
			query: 'author:"Zoë"',
			matchCase: true,
			naturalLanguage: { query: 'commits by Zoë', processedQuery: 'author:"Zoë"' },
		};
		let stored: StoredSearch | undefined;
		const view = {
			type: 'searchAndCompare',
			container: { git: { repositoryCount: 1 } },
			getNodeLastKnownLimit: () => undefined,
			updateStorage: (_id: string, item: StoredSearch | undefined) => {
				stored = item;
				return Promise.resolve();
			},
		} as unknown as SearchAndCompareView;

		new SearchResultsNode(view, {} as ViewNode, '/repo', search);

		assert.ok(stored != null);
		assert.strictEqual(stored.search.pattern, search.query);
		assert.strictEqual('labels' in stored, false);

		sandbox.stub(l10n, 't').callsFake(((message: string, ...args: unknown[]) => {
			if (message === 'Search results for {0}') {
				return `⟪${String(args[0])}⟫ — search results`;
			}

			return message;
		}) as typeof l10n.t);

		const restored = new SearchResultsNode(
			view,
			{} as ViewNode,
			'/repo',
			getSearchQuery(stored.search),
			undefined,
			stored.timestamp,
		);
		const item = await restored.getTreeItem();

		assert.strictEqual(item.label, `⟪${search.query}⟫ — search results`);
	});
});
