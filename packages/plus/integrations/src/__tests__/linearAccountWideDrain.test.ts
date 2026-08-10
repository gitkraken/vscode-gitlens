import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession } from './issueSortHelpers.js';

/**
 * How Linear's account-wide drain ENDS, which is the part a caller cannot see for itself.
 *
 * The read returns a plain list, so "these are all your issues" and "these are the first N of your issues" look
 * identical downstream. `truncated` is the only thing that separates them, and every branch that sets it is a
 * branch nothing else in the suite covers: the SDK read is stubbed here rather than the integration method, so
 * the loop under test is the real one.
 */

interface StubPage {
	values: unknown[];
	paging?: { cursor?: string; more?: boolean };
}

async function linearWithPages(
	manager: ReturnType<typeof createIntegrationManager>,
	pages: StubPage[] | (() => StubPage),
): Promise<{ integration: Record<string, unknown>; cursors: (string | undefined)[] }> {
	const integration = (await manager.get(IssuesCloudHostIntegrationId.Linear)) as unknown as Record<string, unknown>;
	assert.ok(integration != null);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = primarySession(
		't',
		'linear.app',
	);

	const cursors: (string | undefined)[] = [];
	let index = 0;
	integration.getProvidersApi = () =>
		Promise.resolve({
			getIssuesForCurrentUser: (_token: unknown, options: { cursor?: string }) => {
				cursors.push(options.cursor);
				return Promise.resolve(
					typeof pages === 'function' ? pages() : pages[Math.min(index++, pages.length - 1)],
				);
			},
		});

	return { integration: integration, cursors: cursors };
}

// Enough of a provider issue for `toIssueShape` to keep it: it drops anything without `updatedDate` or `url`,
// and reads `labels` without a null guard. A row it silently discards would make a drain test count zero
// however well the drain itself worked.
const page = (n: number, cursor?: string, more = false): StubPage => ({
	values: Array.from({ length: n }, (_, i) => ({
		id: `${cursor ?? 'p0'}-${i}`,
		number: `${cursor ?? 'p0'}-${i}`,
		title: `issue ${i}`,
		createdDate: new Date('2026-01-01T00:00:00Z'),
		updatedDate: new Date('2026-01-01T00:00:00Z'),
		url: `https://linear.app/issue/${cursor ?? 'p0'}-${i}`,
		labels: [],
		assignees: [],
	})),
	paging: { cursor: cursor, more: more },
});

/** Calls the override under test, which the integration type does not expose as a public method. */
function drain(integration: Record<string, unknown>): Promise<{ values: unknown[]; truncated: boolean }> {
	return (
		integration.searchProviderMyIssuesWithTruncation as (
			session: unknown,
		) => Promise<{ values: unknown[]; truncated: boolean }>
	)(primarySession('t', 'linear.app'));
}

suite('Linear account-wide drain', () => {
	test('reports a complete drain as not truncated', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { integration, cursors } = await linearWithPages(manager, [
				page(2, 'c1', true),
				page(1, undefined, false),
			]);

			const result = await drain(integration);

			assert.equal(result.truncated, false);
			assert.deepEqual(cursors, [undefined, 'c1'], 'follows the cursor it was handed');
		} finally {
			manager.dispose();
		}
	});

	test('flags truncation when the backstop stops a drain with pages still to come', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			// Every page claims another and hands back a fresh cursor, so only the backstop can end this.
			let n = 0;
			const { integration } = await linearWithPages(manager, () => page(1, `c${n++}`, true));

			const result = await drain(integration);

			assert.equal(result.truncated, true, 'a capped account must not read as a whole one');
			assert.equal(result.values.length, 50, 'kept every page it did fetch');
		} finally {
			manager.dispose();
		}
	});

	test('keeps the page it already paid for when the cursor stops advancing', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			// `more: true` with a repeated cursor. The request is already spent, so its rows must be kept even
			// though the drain cannot continue past them.
			const { integration } = await linearWithPages(manager, [page(3, 'stuck', true), page(3, 'stuck', true)]);

			const result = await drain(integration);

			assert.equal(result.values.length, 6, 'both fetched pages kept, none discarded');
			assert.equal(result.truncated, true, 'the rest of the account is unreachable, not absent');
		} finally {
			manager.dispose();
		}
	});
});
