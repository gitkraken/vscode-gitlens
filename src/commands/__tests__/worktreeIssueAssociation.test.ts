import * as assert from 'node:assert';
import '../../container.js';
import * as sinon from 'sinon';
import { commands, Uri, window } from 'vscode';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { GitConfigEntityIdentifier } from '@gitlens/integrations/providers/models.js';
import { defer } from '@gitlens/utils/promise.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import type { StartWorkChatAction } from '../../plus/chat/chatActions.js';
import { BranchCreateGitCommand } from '../git/branch/create.js';
import type { WorktreeCreateState } from '../git/worktree/create.js';
import { WorktreeCreateGitCommand } from '../git/worktree/create.js';

const repoPath = '/repo';
const branchName = 'fix/tst-52';
const reference: GitBranchReference = {
	repoPath: repoPath,
	ref: 'main',
	name: 'main',
	refType: 'branch',
	remote: false,
};
const worktree = new GitWorktree(
	false,
	'branch',
	repoPath,
	Uri.file(`/worktrees/${branchName}`),
	false,
	false,
	undefined,
	undefined,
	undefined,
	branchName,
);
const issue = {
	id: 'TST-52',
	nodeId: '10042',
	provider: { id: 'jira', name: 'Jira', domain: 'https://jira.example.com', icon: '' },
	project: { id: 'project-42', name: 'GitLens', resourceId: 'site-17', resourceName: '' },
} satisfies Partial<IssueShape> as IssueShape;

function createHarness(options?: { write?: () => Promise<void>; create?: () => Promise<GitWorktree | undefined> }): {
	container: Container;
	repo: GlRepository;
	read: () => GitConfigEntityIdentifier[];
	writes: () => number;
	creates: () => number;
} {
	let encoded: string | undefined;
	let writes = 0;
	let creates = 0;
	const repo = {
		path: repoPath,
		uri: Uri.file(repoPath),
		git: {
			branches: { getBranch: async () => undefined },
			refs: { checkIfCouldBeValidBranchOrTagName: async () => true },
			worktrees: {
				getWorktreesDefaultUri: () => Uri.file('/worktrees'),
				getWorktrees: async () => [],
				createWorktreeWithResult: async () => {
					creates++;
					return options?.create == null ? worktree : options.create();
				},
			},
		},
	} as unknown as GlRepository;
	const container = {
		git: {
			openRepositories: [repo],
			access: async () => ({ allowed: true }),
			getRepositoryService: () => ({
				config: {
					getGkConfig: async () => encoded,
					setGkConfig: async (_key: string, value: string) => {
						writes++;
						await options?.write?.();
						encoded = value;
					},
				},
			}),
		},
		views: { branches: {}, worktrees: { visible: false } },
		integrations: { getConfigured: () => [] },
		events: { fire: () => {} },
		storage: { getWorkspace: () => undefined },
	} as unknown as Container;
	return {
		container: container,
		repo: repo,
		read: () => (encoded == null ? [] : (JSON.parse(encoded) as GitConfigEntityIdentifier[])),
		writes: () => writes,
		creates: () => creates,
	};
}

async function runCreate(command: WorktreeCreateGitCommand, container: Container): Promise<void> {
	const generator = command.executeSteps({ container: container, title: 'Create Worktree' });
	const first = await generator.next();
	assert.strictEqual(first.done, true);
}

function createCommand(
	harness: ReturnType<typeof createHarness>,
	state?: Partial<WorktreeCreateState>,
): WorktreeCreateGitCommand {
	return new WorktreeCreateGitCommand(harness.container, {
		command: 'worktree-create',
		state: {
			repo: harness.repo,
			reference: reference,
			uri: Uri.file('/worktrees'),
			createBranch: branchName,
			associateWithIssue: issue,
			worktreeDefaultOpen: 'none',
			reveal: false,
			...state,
		},
	});
}

suite('Worktree issue association', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('a created branch saves the Jira project and site before resolving the result', async () => {
		const write = defer<void>();
		const writeEntered = defer<void>();
		const harness = createHarness({
			write: () => {
				writeEntered.fulfill();
				return write.promise;
			},
		});
		const result = defer<GitWorktree | undefined>();
		const dispatch = sandbox.stub(commands, 'executeCommand').resolves(undefined);
		const chatAction: StartWorkChatAction = {
			type: 'startWork',
			issue: issue,
			agent: {
				id: 'cli:codex',
				kind: 'cli',
				label: 'Codex',
				agent: {
					name: 'codex',
					displayName: 'Codex',
					detected: true,
					executable: '/usr/bin/codex',
					mcpSupported: true,
					mcpInstalled: false,
					hooksSupported: true,
					hooksInstalled: false,
				},
			},
		};
		const command = createCommand(harness, { result: result, chatAction: chatAction });
		const running = runCreate(command, harness.container);
		await writeEntered.promise;

		assert.strictEqual(harness.creates(), 1);
		assert.strictEqual(harness.writes(), 1);
		assert.strictEqual(result.pending, true);
		assert.strictEqual(dispatch.calledWith('gitlens.openChatAction'), false);
		write.fulfill();
		await running;
		assert.strictEqual(await result.promise, worktree);
		assert.strictEqual(dispatch.calledWith('gitlens.openChatAction'), true);
		assert.deepStrictEqual(
			harness.read().map(entry => ({
				provider: entry.provider,
				entityId: entry.entityId,
				resourceId: 'resourceId' in entry ? entry.resourceId : undefined,
				projectId: 'projectId' in entry ? entry.projectId : undefined,
			})),
			[{ provider: 'jira', entityId: '10042', resourceId: 'site-17', projectId: 'project-42' }],
		);
	});

	test('a failed config write warns with the issue and created branch', async () => {
		const warning = sandbox.stub(window, 'showWarningMessage').resolves(undefined);
		const harness = createHarness({ write: () => Promise.reject(new Error('config failed')) });
		await runCreate(createCommand(harness), harness.container);
		assert.strictEqual(harness.creates(), 1);
		assert.strictEqual(harness.writes(), 1);
		assert.strictEqual(harness.read().length, 0);
		assert.strictEqual(warning.callCount, 1);
		assert.match(warning.firstCall.args[0], /TST-52/);
		assert.match(warning.firstCall.args[0], /fix\/tst-52/);
	});

	test('an unresolved worktree after creation warns without inventing an association', async () => {
		const warning = sandbox.stub(window, 'showWarningMessage').resolves(undefined);
		const harness = createHarness({ create: () => Promise.resolve(undefined) });
		await runCreate(createCommand(harness), harness.container);
		assert.strictEqual(harness.creates(), 1);
		assert.strictEqual(harness.writes(), 0);
		assert.strictEqual(warning.callCount, 1);
		assert.match(warning.firstCall.args[0], /TST-52/);
		assert.match(warning.firstCall.args[0], /fix\/tst-52/);
	});

	test('Create Branch forwards its Jira issue into worktree creation', async () => {
		const harness = createHarness();
		const command = new BranchCreateGitCommand(harness.container, {
			command: 'branch-create',
			confirm: false,
			state: {
				repo: harness.repo,
				reference: reference,
				name: branchName,
				flags: ['--worktree'],
				associateWithIssue: issue,
				worktreeDefaultOpen: 'none',
			},
		});
		const generator = command.executeSteps({ container: harness.container, title: 'Create Branch' });
		const result = await generator.next();
		assert.strictEqual(result.done, true);
		assert.strictEqual(harness.creates(), 1);
		assert.strictEqual(harness.writes(), 1);
		assert.strictEqual(harness.read()[0].entityId, '10042');
	});
});
