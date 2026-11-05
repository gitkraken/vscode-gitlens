/**
 * Start Work on a signed-in worker (#5682): the wizard a person walks from the command palette, which an unattended
 * run could only see disconnected before — the issue picker filled from the test account's connected GitHub
 * integration, the route step, and the branch creation it hands the issue to. The MCP spec
 * (`mcpGitlensWritePathSignedIn.test.ts`) covers the unattended path, which skips every one of these steps.
 *
 * Which issue: Start Work lists the connected GitHub account's own issues (assigned to, authored by or mentioning it)
 * in the open repositories only, so the worker opens a fresh clone of the test repository and follows one known
 * issue there, `E2E_GITHUB_ISSUE_URL` (the same issue the MCP Start Work spec uses). The picker can hold the account's
 * other issues too, which change on their own: nothing here asserts counts, order or other issues.
 *
 * What is asserted is what git holds afterwards: the branch, where it starts, that the editor's repository switched to
 * it, and the issue association GitLens writes to `.git/gk/config`. Nothing is pushed — the remote is never changed.
 *
 * Plan: Start Work is Pro, and the account's own plan changes over time, so the tests run under a simulated Pro
 * subscription (`gitlens.plus.simulate.subscription`, present in `bundle:e2e`). The route step relies on the default
 * `gitlens.ai.openInAgent` (`ask`) of a fresh profile.
 *
 * Inputs: `E2E_GITHUB_REPO_URL` and `E2E_GITHUB_ISSUE_URL` (and `GK_E2E_GITHUB_TOKEN` for a private repository, see
 * `fixtures/testRepository.ts`). Skips without them or without `GK_E2E_ACCESS_TOKEN_COOKIE` (fails instead under
 * `E2E_REQUIRE_SIGNIN`). No traces, videos or screenshots, and no retries (see `signIn.test.ts`). Assertion messages
 * carry only the public issue reference and fixed words — but the `error-context.md` of a failed test can snapshot the
 * open picker, with other issues' titles, and the GitLens log lines printed on failure can name the account's issues,
 * so keep signed-in results unshared.
 */
import * as process from 'node:process';
import slug from 'slug';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, canSignIn, createTmpDir, expect } from '../baseTest.js';
import {
	git,
	gitlensLogDiagnosis,
	localBranches,
	TestRepositoryClone,
	testRepositoryUrl,
} from '../fixtures/testRepository.js';

const issueUrl = process.env.E2E_GITHUB_ISSUE_URL;
// `https://github.com/<owner>/<repo>/issues/<n>` → owner/repo and number, as the picker shows them (`owner/repo#n`)
const issue = (() => {
	const match = issueUrl == null ? null : /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(issueUrl);
	return match == null ? undefined : { repo: match[1], number: match[2], ref: `${match[1]}#${match[2]}` };
})();
// The reference where the picker puts it, in the row's description between the title and the detail
// (`<title>, owner/repo#n, <detail>`): so `#2` doesn't match `#20`, nor `owner/repo` match `other-owner/repo`, nor
// another issue that only mentions this one in its title or body
const issueRefPattern = issue == null ? undefined : new RegExp(`, ${escapeRegExp(issue.ref)},`);

const missingInputs = !testRepositoryUrl || issue == null;
if (missingInputs && process.env.E2E_REQUIRE_SIGNIN) {
	throw new Error(
		'E2E_GITHUB_REPO_URL / E2E_GITHUB_ISSUE_URL are required (E2E_REQUIRE_SIGNIN) but not both set to GitHub URLs',
	);
}

const clone = new TestRepositoryClone('[5682]');

const test = base.extend<object, { cloneCleanup: void }>({
	// Removes the clone once the worker's editor is gone: set up before `vscode`, so torn down after it
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
			setup: async () => clone.create(await createTmpDir()),
		},
		{ scope: 'worker' },
	],
});

test.skip(!canSignIn(), 'GK_E2E_ACCESS_TOKEN_COOKIE is not set');
test.skip(missingInputs, 'E2E_GITHUB_REPO_URL / E2E_GITHUB_ISSUE_URL are not set to GitHub URLs');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const quickPickRows = '.quick-input-widget .monaco-list-row';
// The issues arrive once every connected integration has answered (~2 s measured on staging; Launchpad allows 90 s)
const itemsTimeout = 90_000;

/** The accessible labels of the quick pick rows currently rendered. */
function readQuickPickRows(vscode: VSCodeInstance): Promise<string[]> {
	return vscode.page
		.locator(quickPickRows)
		.evaluateAll(els =>
			els.map(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ')),
		);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Clicks the first row whose accessible label (what {@link readQuickPickRows} reads) matches `label`, in its top-left
 * corner to miss the row's buttons and tooltip. The row is matched when the click lands, so a list that re-renders or
 * re-filters meanwhile can't move the click to another row.
 */
async function clickRow(vscode: VSCodeInstance, label: RegExp): Promise<void> {
	await vscode.page
		.locator('.quick-input-widget')
		.getByRole('option', { name: label })
		.first()
		.click({ position: { x: 1, y: 1 }, timeout: 15_000 });
}

/** The repository's default branch, as its local name (`origin/HEAD` → `main`). */
function defaultBranch(): string {
	return git(clone.path!, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '');
}

/** Opens Start Work and narrows the issue picker to the test issue; resolves with that issue's row label. */
async function filterStartWorkToIssue(vscode: VSCodeInstance): Promise<string | undefined> {
	const quickPick = vscode.gitlens.quickPick;
	await vscode.gitlens.executeCommand('gitlens.startWork');
	await quickPick.waitForVisible(30_000);
	// Straight to the issues: a connected integration skips the "Connect an Integration" step
	await quickPick.waitForPlaceholder('Choose an issue to start working on', itemsTimeout);
	await quickPick.waitForTitle(/^Start Work/);
	// The filter matches the description too, where the picker puts `owner/repo#n`; it still keeps `#n0`… and issues that
	// mention the reference
	await quickPick.enterText(issue!.ref);

	// The list renders only the rows in view, so with enough of those ahead of it the test issue isn't rendered yet:
	// walk the active item down until it is (arrow keys only move it, nothing runs), bounded by the poll's timeout
	let row: string | undefined;
	await expect
		.poll(
			async () => {
				row = (await readQuickPickRows(vscode)).find(label => issueRefPattern!.test(label));
				if (row == null) {
					await vscode.page.keyboard.press('ArrowDown');
				}
				return row != null;
			},
			{ message: `${issue!.ref} listed in Start Work`, timeout: 30_000, intervals: [250] },
		)
		.toBe(true);
	return row;
}

/**
 * Walks from the issue picker to the branch name step: picks the test issue, continues manually on the route step and
 * bases the branch on the default branch. Resolves with the issue's title as the picker shows it and the branch name
 * the wizard suggests.
 */
async function walkToBranchName(vscode: VSCodeInstance): Promise<{ title: string; name: string }> {
	const quickPick = vscode.gitlens.quickPick;
	const row = (await filterStartWorkToIssue(vscode))!;
	// The row reads `<title>, owner/repo#n, <detail>`
	const title = row.slice(0, row.search(issueRefPattern!));
	await clickRow(vscode, issueRefPattern!);

	// The route step offers Kepler, an agent, or the manual branch creation
	await quickPick.waitForTitle('Start with Agent', 30_000);
	await expect
		// Each choice's label starts with its icon's name (`arrow-right Continue manually, …`): strip it
		.poll(async () => (await readQuickPickRows(vscode)).map(label => /^\S+ ([^,]+),/.exec(label)?.[1]), {
			message: 'route step choices',
			timeout: 10_000,
		})
		.toEqual(expect.arrayContaining(['Open in Kepler', 'Open in an agent', 'Continue manually']));
	await clickRow(vscode, /Continue manually/);

	await quickPick.waitForPlaceholder(/^Choose a base to create the new branch from/, 30_000);
	await quickPick.waitForTitle('Select Base to Create Branch From');
	const base = defaultBranch();
	// The local branch row reads `<name> check, …`; `origin/<name>` starts with the remote, and `<name>-x` goes on
	await clickRow(vscode, new RegExp(`^${escapeRegExp(base)}(?= |,)`));

	await quickPick.waitForPlaceholder('Branch name', 30_000);
	await quickPick.waitForTitle(`Create Branch from ${base}`);
	return { title: title, name: await quickPick.input.inputValue() };
}

test.describe('Start Work on a signed-in worker', { tag: '@signed-in' }, () => {
	test.describe.configure({ mode: 'serial', retries: 0 });
	// The items wait allows 90 s for the integrations to answer, past the default 60 s test budget
	test.slow();

	test.beforeAll(async ({ vscode }) => {
		const simulation = await vscode.gitlens.startSubscriptionSimulation();
		expect(simulation.success, 'Pro subscription simulated').toBe(true);
	});

	// First, and without fixtures, so it runs even when the worker failed to start or sign in (see
	// `TestRepositoryClone`): `afterAll` hooks run in the order they are declared
	test.afterAll(() => {
		clone.removeCredential();
	});

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.stopSubscriptionSimulation().catch(() => {});
	});

	test.afterEach(async ({ vscode }, testInfo) => {
		// Leave no Start Work step open for the next test
		await vscode.gitlens.quickPick.cancel();
		await vscode.gitlens.quickPick.waitForHidden(5_000);

		if (testInfo.status === testInfo.expectedStatus) return;

		const lines = gitlensLogDiagnosis(vscode.electron.args);
		console.log(`[5682] GitLens log after "${testInfo.title}":\n${lines.join('\n')}`);
	});

	test('issue picker lists the test issue', async ({ vscode }) => {
		const row = await filterStartWorkToIssue(vscode);
		expect(row, `${issue!.ref} row`).toBeDefined();
	});

	test('picking the test issue suggests a branch named after it', async ({ vscode }) => {
		const { title, name } = await walkToBranchName(vscode);
		// The picker cuts a title past 60 characters, and the name is made from the whole title
		expect(title.endsWith('...'), 'the test issue title is short enough to show whole (fixture)').toBe(false);
		// `${id}-${title}` by default (`gitlens.startWork.branchNameFormat`): the number, then the title slugged as the
		// product slugs it (the `slug` package), so the name has to come from this issue's title
		expect(name, 'suggested branch name').toBe(`${issue!.number}-${slug(title)}`);
		expect(() => git(clone.path!, 'check-ref-format', '--branch', name), 'a valid branch name').not.toThrow();
		expect(localBranches(clone.path!), 'nothing created before the confirmation').not.toContain(name);
		// Dismissed without creating anything (afterEach)
	});

	test('Create & Switch creates the issue branch and associates the issue with it', async ({ vscode }) => {
		const quickPick = vscode.gitlens.quickPick;
		const base = defaultBranch();
		const baseSha = git(clone.path!, 'rev-parse', base);

		const { name } = await walkToBranchName(vscode);
		await quickPick.input.press('Enter');
		await quickPick.waitForTitle('Confirm Create Branch', 30_000);
		await clickRow(vscode, /^Create & Switch to Branch,/);
		await quickPick.waitForHidden(30_000);

		// The wizard closes before git has finished: wait for the switch, then read the rest
		await expect
			.poll(() => git(clone.path!, 'branch', '--show-current'), {
				message: 'the workspace repository switched to the issue branch',
				timeout: 30_000,
			})
			.toBe(name);
		expect(git(clone.path!, 'rev-parse', 'HEAD'), `the issue branch starts from ${base}`).toBe(baseSha);

		// The association GitLens reads back for the branch (issue pills, hovers, Launchpad): one entry, this issue, with
		// every field its decoder requires (`isGitConfigEntityIdentifier`), or GitLens would drop it on read
		const readAssociation = (): unknown => {
			try {
				return JSON.parse(
					git(clone.path!, 'config', '-f', '.git/gk/config', '--get', `branch.${name}.gk-associated-issues`),
				);
			} catch {
				return undefined;
			}
		};
		await expect
			.poll(readAssociation, {
				message: 'the issue associated with the branch',
				timeout: 15_000,
			})
			.toEqual([
				expect.objectContaining({
					provider: 'github',
					entityType: 'issue',
					version: expect.any(String),
					entityId: expect.stringMatching(/\S/),
					metadata: expect.objectContaining({
						id: issue!.number,
						owner: expect.objectContaining({ key: issue!.repo }),
						createdDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
					}),
				}),
			]);
		// Runs last: the branch stays in this worker's clone, which goes at teardown, and nothing was pushed
	});
});
