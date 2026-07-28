import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import { fromGitLabMergeRequestREST } from '../providers/gitlab/models.js';
import type { ProviderAccount, ProviderIssue } from '../providers/models.js';
import { fromProviderAccount, toIssueShape } from '../providers/models.js';

/**
 * A member the provider exposes no display name for maps to an ABSENT `name`, never to a placeholder.
 *
 * `'unknown'`/`'Unknown'`/`''` were display fallbacks invented in the provider layer, and no consumer could tell
 * them apart from a member genuinely named that — so they couldn't be undone downstream, where a name-shaped
 * placeholder is wrong: an AI prompt built from the issue reads `Assignees: unknown` as a real assignee, and a
 * tooltip renders `by @unknown` instead of dropping the attribution. `undefined` lets each consumer choose.
 *
 * The mappers also used to disagree with each other — `fromProviderAccount` emitted `'unknown'`, `toIssueShape`
 * emitted `''`, and the GitLab PR mappers emitted `'Unknown'` — even though the first two both feed
 * `listIssuesPage` (the repo-scoped path through `toIssueShape`, Azure's account-wide path through
 * `fromProviderIssue`). Same facade method, three fallbacks.
 */

const provider = { id: 'gitlab', name: 'GitLab', domain: 'gitlab.com', icon: 'gitlab' } as unknown as Provider;

function providerIssue(overrides: Partial<ProviderIssue>): ProviderIssue {
	return {
		id: '1',
		number: '1',
		title: 'Issue 1',
		url: 'https://github.com/o/r/issues/1',
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [],
		labels: [],
		...overrides,
	} as unknown as ProviderIssue;
}

suite('absent member names', () => {
	suite('fromProviderAccount', () => {
		test('a null account has no name', () => {
			const member = fromProviderAccount(null);

			assert.equal(member.name, undefined);
			assert.equal(member.id, '');
			assert.equal(member.avatarUrl, undefined);
			assert.equal(member.url, undefined);
		});

		test('an account with no name has no name', () => {
			const member = fromProviderAccount({
				id: 'a1',
				name: null,
				avatarUrl: null,
				url: null,
				email: null,
				username: null,
			} satisfies ProviderAccount);

			assert.equal(member.name, undefined);
			assert.equal(member.id, 'a1');
		});

		test('a real name is preserved verbatim', () => {
			const member = fromProviderAccount({ id: 'a1', name: 'Ada Lovelace' } as unknown as ProviderAccount);

			assert.equal(member.name, 'Ada Lovelace');
		});
	});

	suite('toIssueShape', () => {
		test('an authorless issue has no author name — and is still surfaced', () => {
			const shape = toIssueShape(providerIssue({ author: null }), provider);

			assert.ok(shape != null, 'an issue with no author is mapped, not dropped');
			assert.equal(shape.author.name, undefined);
			assert.equal(shape.author.id, '');
		});

		test('a nameless assignee has no name', () => {
			const shape = toIssueShape(
				providerIssue({
					assignees: [{ id: 'u1', name: null, avatarUrl: null, url: null }],
				} as unknown as Partial<ProviderIssue>),
				provider,
			);

			assert.equal(shape?.assignees.length, 1);
			assert.equal(shape?.assignees[0].name, undefined);
			assert.equal(shape?.assignees[0].id, 'u1');
		});

		test('matches fromProviderAccount for the same absent author', () => {
			// Both mappers feed `listIssuesPage`, so an absent name must look identical on either path.
			const shape = toIssueShape(providerIssue({ author: null }), provider);

			assert.equal(shape?.author.name, fromProviderAccount(null).name);
		});
	});

	suite('fromGitLabMergeRequestREST', () => {
		test('an authorless merge request has no author name, url, or avatar', () => {
			const pr = fromGitLabMergeRequestREST(
				{
					id: 1,
					iid: 2,
					author: null,
					title: 'MR',
					description: '',
					state: 'opened',
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-02T00:00:00Z',
					closed_at: null,
					merged_at: null,
					source_branch: 'feature',
					target_branch: 'main',
					web_url: 'https://gitlab.com/o/r/-/merge_requests/2',
				} as unknown as Parameters<typeof fromGitLabMergeRequestREST>[0],
				provider,
				{ owner: 'o', repo: 'r' },
			);

			assert.equal(pr.author.name, undefined, 'no invented `Unknown` name');
			// `''` passed a `!= null` presence check and rendered as a link to nowhere.
			assert.equal(pr.author.url, undefined);
			assert.equal(pr.author.avatarUrl, undefined);
		});
	});
});
