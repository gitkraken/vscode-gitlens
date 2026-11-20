import { readFileSync } from 'node:fs';
import * as process from 'node:process';
import type { FrameLocator, Locator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, canSignIn, createTmpDir, expect, GitFixture } from '../baseTest.js';
import {
	git,
	gitlensLogDiagnosis,
	gitlensLogFiles,
	TestRepositoryClone,
	testRepositoryUrl,
} from '../fixtures/testRepository.js';
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
	!issueUrl!.startsWith(`${testRepositoryUrl}/issues/`) ||
	!process.env.GK_E2E_GITHUB_TOKEN?.trim();
if (missingInputs && process.env.E2E_REQUIRE_SIGNIN) {
	throw new Error(
		'E2E_GITHUB_REPO_URL / E2E_GITHUB_PR_URL / E2E_GITHUB_ISSUE_URL (GitHub URLs of one repository) and GK_E2E_GITHUB_TOKEN are required (E2E_REQUIRE_SIGNIN) but not all set',
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
};

const clone = new TestRepositoryClone('[enrichment]');
let checkout: PullRequestCheckout | undefined;

async function associatedPullRequestCount(sha: string): Promise<number> {
	const [owner, name] = new URL(testRepositoryUrl!).pathname.slice(1).split('/');
	const response = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: {
			Authorization: `bearer ${process.env.GK_E2E_GITHUB_TOKEN!.trim()}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			query: 'query($owner: String!, $name: String!, $sha: String!) { repository(owner: $owner, name: $name) { object(expression: $sha) { ... on Commit { associatedPullRequests { totalCount } } } } }',
			variables: { owner: owner, name: name, sha: sha },
		}),
		signal: AbortSignal.timeout(30_000),
	});
	const result = (await response.json().catch(() => undefined)) as
		| {
				data?: { repository?: { object?: { associatedPullRequests?: { totalCount?: number } } } };
				errors?: { message?: string }[];
		  }
		| undefined;
	const count = result?.data?.repository?.object?.associatedPullRequests?.totalCount;
	if (!response.ok || count == null) {
		const errors = (result?.errors ?? []).map(e => e.message ?? '').filter(Boolean);
		throw new Error(
			`could not count the pull requests GitHub associates with a fixture commit (HTTP ${response.status}${
				errors.length ? `: ${errors.join('; ')}` : ''
			})`,
		);
	}
	return count;
}

// KEEP: fixture contract — one open PR branch, a head adding a blamed line by a non-noreply author, and a base
// commit with no PR and no `#n` reference; setup fails loudly when the test repository breaks it
async function checkOutPullRequestWithLocalCommit(repo: string): Promise<PullRequestCheckout> {
	const headSha = git(repo, 'ls-remote', 'origin', `refs/pull/${prNumber}/head`).split(/\s+/)[0];
	if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error(`the test repository has no head for PR #${prNumber}`);

	try {
		git(repo, 'cat-file', '-e', `${headSha}^{commit}`);
	} catch {
		throw new Error(`the head of PR #${prNumber} is not on any branch of the test repository`);
	}

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
	if (branches.length !== 1) {
		throw new Error(`expected one branch of the test repository to hold the head of PR #${prNumber}`);
	}

	if (git(repo, 'rev-parse', `origin/${branches[0]}`) !== headSha) {
		throw new Error(
			`the branch of PR #${prNumber} must end at the PR head: commits after it would blame other lines`,
		);
	}

	git(repo, 'switch', '--quiet', '--create', branches[0], '--track', `origin/${branches[0]}`);
	const blameLine = new RegExp(`^${headSha} \\d+ (\\d+)`, 'm');
	let file: string | undefined;
	let line: number | undefined;
	for (const path of git(
		repo,
		'diff-tree',
		'--no-commit-id',
		'--name-only',
		'--diff-filter=AM',
		'-z',
		'-r',
		'--root',
		headSha,
	)
		.split('\0')
		.filter(Boolean)) {
		const match = blameLine.exec(git(repo, 'blame', '--porcelain', '-l', headSha, '--', path));
		if (match == null) continue;

		file = path;
		line = Number(match[1]) - 1;
		break;
	}
	if (file == null || line == null) throw new Error(`the head of PR #${prNumber} adds no line to blame`);
	if (/@users\.noreply\.github\.com$|^noreply@github\.com$/i.test(git(repo, 'log', '-1', '--format=%ae', headSha))) {
		throw new Error(
			`the head of PR #${prNumber} must not have a GitHub noreply author: its avatar needs no provider`,
		);
	}

	const baseSha = git(repo, 'merge-base', headSha, 'origin/HEAD');
	const baseMessage = git(repo, 'log', '-1', '--format=%B', baseSha);
	if (/#\d/.test(baseMessage) || (await associatedPullRequestCount(baseSha)) !== 0) {
		throw new Error(
			`the commit PR #${prNumber} branched from must reference no issue or PR and belong to no PR on GitHub`,
		);
	}

	const fixtureGit = new GitFixture(repo);
	await fixtureGit.config('user.name', localAuthor.name);
	await fixtureGit.config('user.email', localAuthor.email);
	// KEEP: never pushed — the fixture's own messages reference no issue, and the test repository must stay unchanged
	await fixtureGit.commit(localMessage, localFile, 'references the test issue\n');

	return { branch: branches[0], headSha: headSha, file: file, line: line, baseSha: baseSha };
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
			logLevel: 'trace',
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
	'E2E_GITHUB_REPO_URL / E2E_GITHUB_PR_URL / E2E_GITHUB_ISSUE_URL (GitHub URLs of one repository) or GK_E2E_GITHUB_TOKEN are not set',
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

	async function revealCommit(vscode: VSCodeInstance, sha: string): Promise<{ webview: FrameLocator; row: Locator }> {
		const webview = await openGraph(vscode);
		const row = commitRow(webview, sha);
		if (!(await row.isVisible())) {
			await vscode.gitlens.executeCommand('gitlens.showInCommitGraphView', {
				ref: {
					refType: 'revision',
					repoPath: vscode.electron.workspacePath,
					ref: sha,
					sha: sha,
					name: sha.slice(0, 7),
				},
				preserveFocus: true,
			});
		}
		await expect(row).toBeVisible({ timeout: 30_000 });
		return { webview: webview, row: row };
	}

	function pullRequestLookupFinished(vscode: VSCodeInstance, sha: string): 'completed' | 'failed' | 'pending' {
		const outcomes = (gitlensLogFiles(vscode.electron.args) ?? [])
			.flatMap(f => readFileSync(f, 'utf8').split('\n'))
			.filter(l => l.includes('GitHubApi.getPullRequestForCommit(') && l.includes(`rev=${sha}`))
			.map(l => (/ failed\b/.test(l) ? 'failed' : / (completed|returned)\b/.test(l) ? 'completed' : undefined))
			.filter(o => o != null);
		return outcomes.at(-1) ?? 'pending';
	}

	async function selectCommit(vscode: VSCodeInstance, sha: string): Promise<Locator> {
		const { webview, row } = await revealCommit(vscode, sha);
		await dismissCommitHover(webview);
		// KEEP: click the message, not the row — the row also holds the branch pills, which route to ref actions
		await row.locator('.gl-graph__message-subject').first().click();
		await dismissCommitHover(webview);
		await ensureGraphDetailsPanelOpenAndAdopted(vscode, webview, 30_000);
		await expect(graphDetailsRegion(webview, 'commit')).toBeVisible({ timeout: 30_000 });
		return webview.locator('gl-details-commit-panel').first();
	}

	async function rowHoverText(vscode: VSCodeInstance, sha: string, loaded: string): Promise<string> {
		const { webview, row } = await revealCommit(vscode, sha);
		await dismissCommitHover(webview);
		await row.locator('.gl-graph__message-subject').first().hover();
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
		const baseSha = checkout!.baseSha;
		await rowHoverText(vscode, baseSha, baseSha.slice(0, 7));
		// KEEP: a failed lookup also shows no PR — require GitHub's answer for this commit in the trace log first
		await expect
			.poll(() => pullRequestLookupFinished(vscode, baseSha), {
				message: 'the PR lookup of the commit finished',
				timeout: dataTimeout,
			})
			.toBe('completed');
		const hover = await rowHoverText(vscode, baseSha, baseSha.slice(0, 7));
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
