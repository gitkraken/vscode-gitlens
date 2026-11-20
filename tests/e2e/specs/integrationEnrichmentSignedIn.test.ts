import * as process from 'node:process';
import type { FrameLocator, Locator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, canSignIn, createTmpDir, expect, GitFixture } from '../baseTest.js';
import { git, gitlensLogDiagnosis, TestRepositoryClone, testRepositoryUrl } from '../fixtures/testRepository.js';
import {
	dismissCommitHover,
	ensureGraphDetailsPanelOpenAndAdopted,
	graphDetailsRegion,
	waitForGraphRowsRendered,
	widenSideBarForGraph,
} from '../graphHelpers.js';
import type { EditorHoverContent } from '../pageObjects/vscodePage.js';

const prUrl = process.env.E2E_GITHUB_PR_URL;
const issueUrl = process.env.E2E_GITHUB_ISSUE_URL;
const prNumber = prUrl == null ? undefined : /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/.exec(prUrl)?.[1];
const issueNumber =
	issueUrl == null ? undefined : /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(issueUrl)?.[1];

const missingInputs =
	!testRepositoryUrl ||
	prNumber == null ||
	issueNumber == null ||
	!prUrl!.startsWith(`${testRepositoryUrl}/pull/`) ||
	!issueUrl!.startsWith(`${testRepositoryUrl}/issues/`);
if (missingInputs && process.env.E2E_REQUIRE_SIGNIN) {
	throw new Error(
		'E2E_GITHUB_REPO_URL / E2E_GITHUB_PR_URL / E2E_GITHUB_ISSUE_URL are required (E2E_REQUIRE_SIGNIN) but not all set to GitHub URLs of one repository',
	);
}

const localFile = 'enrichment.txt';
const localMessage = `Mentions #${issueNumber} in a local commit`;
const localAuthor = { name: 'Enrichment Local', email: 'enrichment@example.invalid' };

type PullRequestCheckout = {
	branch: string;
	headSha: string;
	file: string;
	line: number;
	baseSha: string;
	baseMessage: string;
};

const clone = new TestRepositoryClone('[enrichment]');
let checkout: PullRequestCheckout | undefined;

async function checkOutPullRequestWithLocalCommit(repo: string): Promise<PullRequestCheckout> {
	const headSha = git(repo, 'ls-remote', 'origin', `refs/pull/${prNumber}/head`).split(/\s+/)[0];
	const branches = git(
		repo,
		'for-each-ref',
		'--contains',
		headSha,
		'--format=%(refname:lstrip=3)',
		'refs/remotes/origin',
	)
		.split('\n')
		.filter(name => name && name !== 'HEAD');
	if (!headSha || branches.length !== 1) {
		throw new Error(`expected one branch of the test repository to hold the head of PR #${prNumber}`);
	}

	git(repo, 'switch', '--quiet', '--create', branches[0], '--track', `origin/${branches[0]}`);
	const file = git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', headSha).split('\n')[0];
	const lineMatch = new RegExp(`^${headSha} \\d+ (\\d+)`, 'm').exec(
		git(repo, 'blame', '--porcelain', '-l', headSha, '--', file),
	);
	if (!file || lineMatch == null) throw new Error(`the head of PR #${prNumber} adds no line to blame`);
	if (/@users\.noreply\.github\.com$|^noreply@github\.com$/i.test(git(repo, 'log', '-1', '--format=%ae', headSha))) {
		throw new Error(
			`the head of PR #${prNumber} must not have a GitHub noreply author: its avatar needs no provider`,
		);
	}

	const baseSha = git(repo, 'merge-base', headSha, 'origin/HEAD');

	const fixtureGit = new GitFixture(repo);
	await fixtureGit.config('user.name', localAuthor.name);
	await fixtureGit.config('user.email', localAuthor.email);
	// KEEP: never pushed — the fixture's own messages reference no issue, and the test repository must stay unchanged
	await fixtureGit.commit(localMessage, localFile, 'references the test issue\n');

	return {
		branch: branches[0],
		headSha: headSha,
		file: file,
		line: Number(lineMatch[1]) - 1,
		baseSha: baseSha,
		baseMessage: git(repo, 'log', '-1', '--format=%s', baseSha),
	};
}

const test = base.extend<object, { cloneCleanup: void }>({
	cloneCleanup: [
		// oxlint-disable-next-line no-empty-pattern -- Playwright fixtures declare their dependencies by destructuring
		async ({}, use) => {
			await use();
			await clone.remove();
		},
		{ scope: 'worker', auto: true },
	],
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			signIn: { requiredIntegrations: ['GitHub'] },
			setup: async () => {
				const repo = clone.create(await createTmpDir());
				checkout = await checkOutPullRequestWithLocalCommit(repo);
				return repo;
			},
		},
		{ scope: 'worker' },
	],
});

test.skip(!canSignIn(), 'GK_E2E_ACCESS_TOKEN_COOKIE is not set');
test.skip(
	missingInputs,
	'E2E_GITHUB_REPO_URL / E2E_GITHUB_PR_URL / E2E_GITHUB_ISSUE_URL are not set to GitHub URLs of one repository',
);
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const dataTimeout = 45_000;
const githubAvatar = /^!\[[^\]]*\]\(https:\/\/avatars\.githubusercontent\.com\//;
const gravatar = /^!\[[^\]]*\]\(https:\/\/www\.gravatar\.com\/avatar\//;

function hoverDetails(hovers: EditorHoverContent[][]): EditorHoverContent | undefined {
	return hovers.flat().find(m => m.value.includes('$(history)'));
}

function commandArgs(value: string, command: string): Record<string, unknown> | undefined {
	const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = new RegExp(String.raw`\]\(command:${escaped}\?((?:\\.|[^)\s])+)`).exec(value);
	if (match == null) return undefined;

	try {
		return JSON.parse(decodeURIComponent(match[1].replace(/\\([()])/g, '$1'))) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function footnoteTitle(value: string, marker: RegExp): string | undefined {
	const footnotes = value.split('\n---\n')[1];
	if (footnotes == null) return undefined;

	const lines = footnotes.split('\n');
	const index = lines.findIndex(l => marker.test(l));
	return index < 1 ? undefined : /\*\*(.+?)\*\*/.exec(lines[index - 1])?.[1].replace(/\\(.)/g, '$1');
}

async function readHover(
	vscode: VSCodeInstance,
	file: string,
	line: number,
	settled: (value: string) => boolean,
): Promise<EditorHoverContent> {
	let details: EditorHoverContent | undefined;
	await expect(async () => {
		details = hoverDetails(await vscode.gitlens.moveCursorAndGetHovers(file, line, 0));
		// KEEP: assert on a boolean — the hover text holds the author's e-mail, which a failed match would print
		expect(details != null && settled(details.value), 'GitLens hover with the provider data').toBe(true);
	}).toPass({ timeout: dataTimeout, intervals: [1_000, 2_000, 5_000] });
	return details!;
}

function commitRow(graphWebview: FrameLocator, sha: string): Locator {
	return graphWebview
		.getByRole('tree', { name: 'Commit graph' })
		.getByRole('treeitem', { name: sha.slice(0, 7) })
		.filter({ visible: true })
		.first();
}

test.describe('Integration enrichment on a signed-in worker', { tag: '@signed-in' }, () => {
	test.describe.configure({ mode: 'serial', retries: 0, timeout: 240_000 });

	let graphWebview: FrameLocator | undefined;
	let prTitle: string | undefined;
	let issueTitle: string | undefined;
	let localSha: string | undefined;

	test.beforeAll(async ({ vscode }) => {
		const simulation = await vscode.gitlens.startSubscriptionSimulation();
		expect(simulation.success, 'Pro subscription simulated').toBe(true);
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', 'line');
		localSha = git(vscode.electron.workspacePath, 'rev-parse', 'HEAD');
	});

	// KEEP: first and without fixtures, so the credential goes even when the worker failed to start or sign in
	test.afterAll(() => {
		clone.removeCredential();
	});

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.updateSetting('gitlens.hovers.currentLine.over', undefined).catch(() => {});
		await vscode.gitlens.stopSubscriptionSimulation().catch(() => {});
	});

	test.afterEach(({ vscode }, testInfo) => {
		if (testInfo.status === testInfo.expectedStatus) return;

		const lines = gitlensLogDiagnosis(vscode.electron.args);
		console.log(`[enrichment] GitLens log after "${testInfo.title}":\n${lines.join('\n')}`);
	});

	async function openGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
		if (graphWebview != null) return graphWebview;

		await vscode.gitlens.showCommitGraphView();
		await widenSideBarForGraph(vscode);
		const webview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30_000);
		expect(webview, 'Commit Graph webview found').not.toBeNull();
		await waitForGraphRowsRendered(webview!);
		graphWebview = webview!;
		return graphWebview;
	}

	async function selectCommit(vscode: VSCodeInstance, sha: string): Promise<Locator> {
		const webview = await openGraph(vscode);
		const row = commitRow(webview, sha);
		await expect(row).toBeVisible({ timeout: 30_000 });
		await dismissCommitHover(webview);
		// KEEP: click the message, not the row — the row also holds the branch pills, which route to ref actions
		await row.locator('.gl-graph__message-subject').first().click();
		await dismissCommitHover(webview);
		await ensureGraphDetailsPanelOpenAndAdopted(vscode, webview, 30_000);
		await expect(graphDetailsRegion(webview, 'commit')).toBeVisible({ timeout: 30_000 });
		return webview.locator('gl-details-commit-panel').first();
	}

	async function rowHoverText(vscode: VSCodeInstance, sha: string, loaded: string): Promise<string> {
		const webview = await openGraph(vscode);
		await dismissCommitHover(webview);
		await commitRow(webview, sha).locator('.gl-graph__message-subject').first().hover();
		const hover = webview.locator('gl-graph-hover[open]').first();
		await expect(hover).toHaveCount(1, { timeout: 30_000 });
		let text = '';
		await expect
			.poll(
				async () => {
					text = await hover.evaluate(el => {
						const read = (root: Element | ShadowRoot): string =>
							Array.from(root.childNodes, n =>
								n.nodeType === Node.TEXT_NODE
									? (n.textContent ?? '')
									: n instanceof Element
										? read(n.shadowRoot ?? n) + (n.shadowRoot ? read(n) : '')
										: '',
							).join('');
						return read(el.shadowRoot ?? el);
					});
					return text.includes(loaded) ? 'loaded' : 'loading';
				},
				{ message: 'the row hover content', timeout: dataTimeout },
			)
			.toBe('loaded');
		await dismissCommitHover(webview);
		return text;
	}

	function chipModifier(chip: Locator): Promise<string | undefined> {
		return chip.evaluate(
			el =>
				[...(el.shadowRoot?.querySelector('gl-action-chip')?.classList ?? [])].find(c =>
					c.startsWith('chip--'),
				) ?? undefined,
		);
	}

	test('line hover names the PR that introduced the commit and the author avatar from GitHub', async ({ vscode }) => {
		const prMarker = new RegExp(`#${prNumber} opened`);

		const details = await readHover(
			vscode,
			checkout!.file,
			checkout!.line,
			value =>
				commandArgs(value, 'gitlens.action.openPullRequest') != null &&
				footnoteTitle(value, prMarker) != null &&
				githubAvatar.test(value),
		);

		const args = commandArgs(details.value, 'gitlens.action.openPullRequest') as {
			pullRequest?: { id?: string; url?: string };
			provider?: { id?: string };
		};
		expect(
			{ id: args.pullRequest?.id, url: args.pullRequest?.url, provider: args.provider?.id },
			'the PR link opens the test PR',
		).toEqual({ id: prNumber, url: prUrl, provider: 'github' });
		prTitle = footnoteTitle(details.value, prMarker);
		expect(prTitle?.trim(), 'the PR footnote carries its title').toMatch(/\S/);
	});

	test('line hover enriches an issue autolink in the commit message', async ({ vscode }) => {
		const issueMarker = new RegExp(`#${issueNumber} opened`);

		const details = await readHover(vscode, localFile, 0, value => footnoteTitle(value, issueMarker) != null);

		const args = commandArgs(details.value, 'gitlens.action.openIssue') as {
			issue?: { url?: string };
			provider?: { id?: string };
		};
		expect({ url: args?.issue?.url, provider: args?.provider?.id }, 'the autolink opens the test issue').toEqual({
			url: issueUrl,
			provider: 'github',
		});
		issueTitle = footnoteTitle(details.value, issueMarker);
		expect(issueTitle?.trim(), 'the issue footnote carries its title').toMatch(/\S/);
		expect(gravatar.test(details.value), 'no provider avatar for an author without a GitHub account').toBe(true);
	});

	// TODO(#6281): the graph drops its first ref-metadata request, so the pill never gets its PR badge
	test.fixme('Commit Graph branch pill carries the badge of its PR', async ({ vscode }) => {
		const webview = await openGraph(vscode);
		const badge = webview
			.locator(`.gl-graph__ref-pill-pr[data-ref-name="${checkout!.branch}"]`)
			.and(webview.getByLabel(`Pull request #${prNumber}`, { exact: true }))
			.first();
		await expect(badge, `PR #${prNumber} badge on the ${checkout!.branch} pill`).toBeAttached({
			timeout: dataTimeout,
		});
	});

	test('commit details in the Commit Graph show the PR of the commit with its state', async ({ vscode }) => {
		test.skip(prTitle == null, 'compares with the PR title read by the line hover test');

		const panel = await selectCommit(vscode, checkout!.headSha);
		const chip = panel.locator(`gl-autolink-chip[type="pr"][identifier="#${prNumber}"]`).first();
		await expect(chip, `PR #${prNumber} chip`).toBeAttached({ timeout: dataTimeout });
		await expect(chip).toHaveAttribute('url', prUrl!);
		await expect(chip).toHaveAttribute('status', 'opened');
		await expect(chip, 'the PR title the hover shows').toHaveAttribute('name', prTitle!);
		expect(await chipModifier(chip), 'the chip shows the open state').toBe('chip--pr-opened');

		await expect
			.poll(
				async () => {
					const url = await panel
						.locator('gl-commit-author')
						.first()
						.evaluate(el => (el as HTMLElement & { avatarUrl?: string }).avatarUrl ?? '');
					return url.startsWith('https://avatars.githubusercontent.com/') ? 'GitHub avatar' : 'other avatar';
				},
				{ message: 'author avatar in the commit details', timeout: dataTimeout },
			)
			.toBe('GitHub avatar');
	});

	test('commit details in the Commit Graph enrich the issue autolink of the message', async ({ vscode }) => {
		test.skip(issueTitle == null, 'compares with the issue title read by the line hover test');

		const panel = await selectCommit(vscode, localSha!);
		const chip = panel.locator(`gl-autolink-chip[type="issue"][identifier="#${issueNumber}"]`).first();
		await expect(chip, `issue #${issueNumber} chip`).toBeAttached({ timeout: dataTimeout });
		await expect(chip).toHaveAttribute('url', issueUrl!);
		await expect(chip, 'the issue title the hover shows').toHaveAttribute('name', issueTitle!);
		expect(await chipModifier(chip), 'the chip shows the open state').toBe('chip--issue-opened');
		await expect(
			panel.locator(`gl-autolink-chip[type="autolink"][identifier="#${issueNumber}"]`),
			'the plain autolink is replaced by the enriched one',
		).toHaveCount(0);
	});

	test('Commit Graph row hover names the PR of the commit', async ({ vscode }) => {
		const hover = await rowHoverText(vscode, checkout!.headSha, 'PR #');
		expect(new RegExp(`PR #${prNumber}(?!\\d)`).test(hover), `the row hover names PR #${prNumber}`).toBe(true);
	});

	test('Commit Graph row hover and commit details show no PR for the commit the PR branched from', async ({
		vscode,
	}) => {
		// KEEP: row hover before the details — it is the signal that the PR lookup of this commit finished
		const hover = await rowHoverText(vscode, checkout!.baseSha, checkout!.baseMessage);
		expect(/PR #\d/.test(hover), 'no PR in the row hover').toBe(false);

		const panel = await selectCommit(vscode, checkout!.baseSha);
		await expect(panel.locator('.bottom-section').first()).toContainText('No autolinks found', {
			timeout: dataTimeout,
		});
		// KEEP: watch a window — the panel applies its own (cached by now) PR answer after the empty label renders
		const watchUntil = Date.now() + 5_000;
		while (Date.now() < watchUntil) {
			expect(await panel.locator('gl-autolink-chip').count(), 'no PR or issue chip').toBe(0);
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	});
});
