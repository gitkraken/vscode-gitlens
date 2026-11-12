// Initialize the command registry through the same entry path as the extension.
import '../../../container.js';
import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { MarkdownString } from 'vscode';
import { Uri } from 'vscode';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestMember } from '@gitlens/git/models/pullRequest.js';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import type { Autolink } from '../../../autolinks/models/autolinks.js';
import { trustedMarkdownCommands } from '../../../constants.markdown.js';
import type { ViewsWithCommits } from '../../viewBase.js';
import type { ViewNode } from '../abstract/viewNode.js';
import { AutolinkedItemNode } from '../autolinkedItemNode.js';
import { getPullRequestTooltip } from '../pullRequestNode.js';

const commandLinkText = '[x](command:workbench.action.files.newUntitledFile)';
const escapedCommandLinkText = '\\[x\\]\\(command:workbench\\.action\\.files\\.newUntitledFile\\)';
/** A `](command:` that isn't preceded by an escaping backslash, i.e. a link Markdown would render */
const unescapedCommandLinkRegex = /(?<!\\)\]\(command:/;
/** A link title (`"..."` before a link's closing paren), whose text Markdown shows as-is rather than parsing */
const linkTitleRegex = / "(?:[^"\\]|\\.)*"\)/g;

/** Whether `value` has a command link Markdown would render, ignoring text inside link titles */
function hasCommandLink(value: string): boolean {
	return unescapedCommandLinkRegex.test(value.replace(linkTitleRegex, ')'));
}

const provider: ProviderReference = { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' };

function createPullRequest(overrides?: { title?: string; url?: string; author?: PullRequestMember }): PullRequest {
	return new PullRequest(
		provider,
		overrides?.author ?? { id: 'author', name: 'author', username: 'author', url: 'https://github.com/author' },
		'1',
		'PR_node1',
		overrides?.title ?? 'A pull request',
		overrides?.url ?? 'https://github.com/owner/repo/pull/1',
		{ owner: 'owner', repo: 'repo' },
		'opened',
		new Date(0),
		new Date(0),
	);
}

function getTooltipValue(tooltip: string | MarkdownString | undefined): string {
	assert.ok(tooltip != null && typeof tooltip !== 'string', 'Expected a MarkdownString tooltip');
	return tooltip.value;
}

suite('Markdown tooltip hardening', () => {
	suite('trustedMarkdownCommands', () => {
		test('only allows GitLens commands', () => {
			assert.ok(trustedMarkdownCommands.length > 0);
			for (const command of trustedMarkdownCommands) {
				assert.ok(command.startsWith('gitlens.'), `Unexpected non-GitLens command: ${command}`);
			}
		});

		test('cannot be changed by a consumer', () => {
			assert.ok(Object.isFrozen(trustedMarkdownCommands));
		});
	});

	suite('getPullRequestTooltip', () => {
		test('escapes a title that is shaped like a command link', () => {
			const tooltip = getPullRequestTooltip(createPullRequest({ title: commandLinkText }));

			assert.ok(!hasCommandLink(tooltip.value), tooltip.value);
			assert.ok(tooltip.value.includes(escapedCommandLinkText), tooltip.value);
		});

		test('escapes an author name that is shaped like a command link', () => {
			const tooltip = getPullRequestTooltip(
				createPullRequest({
					author: { id: 'author', name: commandLinkText, url: 'https://github.com/author' },
				}),
			);

			assert.ok(!hasCommandLink(tooltip.value), tooltip.value);
			assert.ok(
				tooltip.value.includes(`[@${escapedCommandLinkText}](https://github.com/author "`),
				tooltip.value,
			);
		});

		test('is not trusted to run commands', () => {
			const tooltip = getPullRequestTooltip(createPullRequest());

			assert.notStrictEqual(tooltip.isTrusted, true);
			assert.strictEqual(tooltip.isTrusted, undefined);
		});

		test('links web URLs', () => {
			const tooltip = getPullRequestTooltip(createPullRequest());

			assert.ok(tooltip.value.includes('](https://github.com/owner/repo/pull/1 "'), tooltip.value);
			assert.ok(tooltip.value.includes('](https://github.com/author "'), tooltip.value);
		});

		test('does not link URLs that are not web URLs', () => {
			const tooltip = getPullRequestTooltip(
				createPullRequest({
					url: 'command:workbench.action.files.newUntitledFile',
					author: { id: 'author', name: 'author', url: 'command:workbench.action.files.newUntitledFile' },
				}),
			);

			assert.ok(!tooltip.value.includes('](command:'), tooltip.value);
		});

		test('keeps a web URL from closing its link early', () => {
			const tooltip = getPullRequestTooltip(
				createPullRequest({ url: `https://github.com/owner/repo/pull/1) ${commandLinkText}` }),
			);

			assert.ok(!tooltip.value.includes('](command:'), tooltip.value);
			assert.ok(tooltip.value.includes('](https://github.com/owner/repo/pull/1%29%20'), tooltip.value);
		});
	});

	suite('AutolinkedItemNode tooltip', () => {
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

		const view = { type: 'commits' } as unknown as ViewsWithCommits;

		function createAutolink(overrides?: Partial<Autolink>): Autolink {
			return {
				prefix: '#',
				id: '1',
				url: 'https://github.com/owner/repo/issues/1',
				alphanumeric: false,
				ignoreCase: false,
				title: 'Open Issue #1',
				...overrides,
			};
		}

		test('escapes an enriched title that is shaped like a command link, and is not trusted', () => {
			const enriched: IssueOrPullRequest = {
				type: 'issue',
				provider: provider,
				id: '1',
				nodeId: undefined,
				title: commandLinkText,
				url: 'https://github.com/owner/repo/issues/1',
				createdDate: new Date(0),
				updatedDate: new Date(0),
				closed: false,
				state: 'opened',
			};

			const node = new AutolinkedItemNode(view, {} as ViewNode, '/repo', createAutolink(), enriched);
			const item = node.getTreeItem();
			const value = getTooltipValue(item.tooltip);

			assert.ok(!hasCommandLink(value), value);
			assert.ok(value.includes(escapedCommandLinkText), value);
			assert.strictEqual((item.tooltip as MarkdownString).isTrusted, undefined);
		});

		test('does not link a URL that is not a web URL, and escapes its title', () => {
			const node = new AutolinkedItemNode(
				view,
				{} as ViewNode,
				'/repo',
				createAutolink({
					url: 'command:workbench.action.files.newUntitledFile',
					title: `"${commandLinkText}`,
					description: commandLinkText,
				}),
				undefined,
			);
			const value = getTooltipValue(node.getTreeItem().tooltip);

			assert.ok(!hasCommandLink(value), value);
			assert.ok(!value.includes('](command:'), value);
		});

		test('escapes the link title of a web URL', () => {
			const node = new AutolinkedItemNode(
				view,
				{} as ViewNode,
				'/repo',
				createAutolink({ title: `" ${commandLinkText} "` }),
				undefined,
			);
			const value = getTooltipValue(node.getTreeItem().tooltip);

			assert.ok(!hasCommandLink(value), value);
			assert.ok(value.includes(`](https://github.com/owner/repo/issues/1 "\\" ${commandLinkText} \\"")`), value);
		});
	});
});
