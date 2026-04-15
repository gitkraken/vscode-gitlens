import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Uri } from 'vscode';
import { window } from 'vscode';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { ScmResource } from '../../@types/vscode.git.resources.d.js';
import { ScmResourceGroupType, ScmStatus } from '../../@types/vscode.git.resources.enums.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import type { CommandScmGroupsContext, CommandScmStatesContext } from '../commandContext.js';
import {
	getStashSaveArgsForScmGroups,
	getStashSaveArgsForScmStates,
	getStashSaveArgsForStagedScmGroup,
	getStashSaveArgsForUnstagedScmGroup,
} from '../stashSave.js';

// --- Mock Helpers ---

function createMockStatusFile(opts: {
	indexStatus?: string;
	workingTreeStatus?: string;
	status?: string;
}): GitStatusFile {
	return {
		indexStatus: opts.indexStatus,
		workingTreeStatus: opts.workingTreeStatus,
		get status() {
			return opts.status ?? opts.indexStatus ?? opts.workingTreeStatus;
		},
	} as unknown as GitStatusFile;
}

function createStagedFile(): GitStatusFile {
	return createMockStatusFile({ indexStatus: 'M' });
}

function createWorkingFile(): GitStatusFile {
	return createMockStatusFile({ workingTreeStatus: 'M' });
}

function createUntrackedFile(): GitStatusFile {
	return createMockStatusFile({ workingTreeStatus: '?', status: '?' });
}

function createMockRepo(opts: {
	path?: string;
	files?: GitStatusFile[];
	supportsStaged?: boolean;
	supportsPathspecs?: boolean;
}): GlRepository {
	return {
		path: opts.path ?? '/mock/repo',
		git: {
			status: {
				getStatus: sinon.stub().resolves(opts.files != null ? { files: opts.files } : { files: [] }),
			},
			supports: sinon.stub().callsFake((feature: string) => {
				if (feature === 'git:stash:push:staged') return Promise.resolve(opts.supportsStaged ?? true);
				if (feature === 'git:stash:push:pathspecs') return Promise.resolve(opts.supportsPathspecs ?? true);
				return Promise.resolve(true);
			}),
		},
	} as unknown as GlRepository;
}

function createMockContainer(repo: GlRepository | undefined): Container {
	return {
		git: {
			getOrOpenRepository: sinon.stub().resolves(repo),
		},
	} as unknown as Container;
}

function createMockUri(path: string = '/mock/file'): Uri {
	return { fsPath: path, scheme: 'file' } as unknown as Uri;
}

function createMockScmResource(
	opts: {
		uri?: Uri;
		type?: ScmStatus;
		resourceGroupType?: ScmResourceGroupType;
	} = {},
): ScmResource {
	return {
		resourceUri: opts.uri ?? createMockUri(),
		type: opts.type,
		resourceGroupType: opts.resourceGroupType,
	} as unknown as ScmResource;
}

function createMockScmStatesContext(command: string, resources: ScmResource[]): CommandScmStatesContext {
	return {
		command: command,
		type: 'scm-states' as const,
		scmResourceStates: resources,
		args: [],
	} as unknown as CommandScmStatesContext;
}

function createMockScmGroupsContext(command: string, resources: ScmResource[]): CommandScmGroupsContext {
	return {
		command: command,
		type: 'scm-groups' as const,
		scmResourceGroups: [
			{
				resourceStates: resources,
			},
		],
		args: [],
	} as unknown as CommandScmGroupsContext;
}

// --- Tests ---

suite('StashSave Helpers', () => {
	let sandbox: sinon.SinonSandbox;
	let showWarningMessageStub: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		showWarningMessageStub = sandbox.stub(window, 'showWarningMessage');
	});

	teardown(() => {
		sandbox.restore();
	});

	// Helper: make showWarningMessage resolve to the "confirm" button (3rd positional arg)
	function stubWarningConfirm(): void {
		showWarningMessageStub.callsFake((_msg: any, _opts: any, confirm: any) => Promise.resolve(confirm));
	}

	// Helper: make showWarningMessage resolve to undefined (user dismisses / cancels)
	function stubWarningCancel(): void {
		showWarningMessageStub.resolves(undefined);
	}

	suite('getStashSaveArgsForStagedScmGroup', () => {
		test('no staged changes and user confirms stash-all returns args without onlyStaged', async () => {
			const repo = createMockRepo({ files: [createWorkingFile()] });
			stubWarningConfirm();

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, undefined);
			assert.ok(showWarningMessageStub.calledOnce);
			assert.ok((showWarningMessageStub.firstCall.args[0] as string).includes('no staged changes'));
		});

		test('no staged changes and user cancels returns undefined', async () => {
			const repo = createMockRepo({ files: [createWorkingFile()] });
			stubWarningCancel();

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.strictEqual(result, undefined);
		});

		test('staged only with git support sets onlyStaged true (regression #5138)', async () => {
			const repo = createMockRepo({ files: [createStagedFile()], supportsStaged: true });

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, true);
			assert.strictEqual(result.keepStaged, false);
			assert.strictEqual(result.includeUntracked, false);
			assert.ok(showWarningMessageStub.notCalled);
		});

		test('staged and working changes with git support sets onlyStaged true', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile()],
				supportsStaged: true,
			});

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, true);
			assert.strictEqual(result.keepStaged, false);
			assert.strictEqual(result.includeUntracked, false);
		});

		test('staged and working changes without git support and user confirms sets onlyStaged false', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile()],
				supportsStaged: false,
			});
			stubWarningConfirm();

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, false);
			assert.strictEqual(result.keepStaged, false);
			assert.strictEqual(result.includeUntracked, false);
		});

		test('staged and working changes without git support and user cancels returns undefined', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile()],
				supportsStaged: false,
			});
			stubWarningCancel();

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.strictEqual(result, undefined);
		});

		test('staged and untracked without git support and user confirms sets onlyStaged false', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createUntrackedFile()],
				supportsStaged: false,
			});
			stubWarningConfirm();

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, false);
			assert.ok(showWarningMessageStub.calledOnce);
		});

		test('staged only without git support and no working changes proceeds without warning', async () => {
			const repo = createMockRepo({ files: [createStagedFile()], supportsStaged: false });

			const result = await getStashSaveArgsForStagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, false);
			assert.strictEqual(result.keepStaged, false);
			assert.strictEqual(result.includeUntracked, false);
			assert.ok(showWarningMessageStub.notCalled);
		});
	});

	suite('getStashSaveArgsForUnstagedScmGroup', () => {
		test('no working or untracked changes and user confirms returns args', async () => {
			const repo = createMockRepo({ files: [createStagedFile()] });
			stubWarningConfirm();

			const result = await getStashSaveArgsForUnstagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.ok(showWarningMessageStub.calledOnce);
			assert.ok((showWarningMessageStub.firstCall.args[0] as string).includes('no unstaged changes'));
		});

		test('no working or untracked changes and user cancels returns undefined', async () => {
			const repo = createMockRepo({ files: [createStagedFile()] });
			stubWarningCancel();

			const result = await getStashSaveArgsForUnstagedScmGroup(repo, {});

			assert.strictEqual(result, undefined);
		});

		test('working and staged changes sets keepStaged true', async () => {
			const repo = createMockRepo({ files: [createStagedFile(), createWorkingFile()] });

			const result = await getStashSaveArgsForUnstagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.keepStaged, true);
			assert.strictEqual(result.includeUntracked, false);
			assert.strictEqual(result.reducedConfirm, true);
		});

		test('untracked and staged changes sets keepStaged and includeUntracked', async () => {
			const repo = createMockRepo({ files: [createStagedFile(), createUntrackedFile()] });

			const result = await getStashSaveArgsForUnstagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.keepStaged, true);
			assert.strictEqual(result.includeUntracked, true);
			assert.strictEqual(result.reducedConfirm, true);
		});

		test('working and untracked without staged does not set keepStaged', async () => {
			const repo = createMockRepo({ files: [createWorkingFile(), createUntrackedFile()] });

			const result = await getStashSaveArgsForUnstagedScmGroup(repo, {});

			assert.ok(result != null);
			assert.strictEqual(result.keepStaged, undefined);
			assert.strictEqual(result.includeUntracked, true);
			assert.strictEqual(result.reducedConfirm, true);
		});

		test('respects pre-existing keepStaged value', async () => {
			const repo = createMockRepo({ files: [createStagedFile(), createWorkingFile()] });

			const result = await getStashSaveArgsForUnstagedScmGroup(repo, { keepStaged: false });

			assert.ok(result != null);
			assert.strictEqual(result.keepStaged, false);
		});
	});

	suite('getStashSaveArgsForScmStates', () => {
		test('git does not support pathspecs and user confirms returns args', async () => {
			const repo = createMockRepo({
				files: [createStagedFile()],
				supportsPathspecs: false,
			});
			const container = createMockContainer(repo);
			const resource = createMockScmResource({ resourceGroupType: ScmResourceGroupType.Index });
			const context = createMockScmStatesContext('gitlens.stashSave.files:scm', [resource]);
			stubWarningConfirm();

			const result = await getStashSaveArgsForScmStates(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.repoPath, '/mock/repo');
			assert.ok(showWarningMessageStub.calledOnce);
		});

		test('git does not support pathspecs and user cancels returns undefined', async () => {
			const repo = createMockRepo({
				files: [createStagedFile()],
				supportsPathspecs: false,
			});
			const container = createMockContainer(repo);
			const resource = createMockScmResource({ resourceGroupType: ScmResourceGroupType.Index });
			const context = createMockScmStatesContext('gitlens.stashSave.files:scm', [resource]);
			stubWarningCancel();

			const result = await getStashSaveArgsForScmStates(container, context, {});

			assert.strictEqual(result, undefined);
		});

		test('selected staged only with working changes and git support sets onlyStaged', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile()],
				supportsStaged: true,
				supportsPathspecs: true,
			});
			const container = createMockContainer(repo);
			const stagedResource = createMockScmResource({
				resourceGroupType: ScmResourceGroupType.Index,
			});
			const context = createMockScmStatesContext('gitlens.stashSave.files:scm', [stagedResource]);

			const result = await getStashSaveArgsForScmStates(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, true);
			assert.strictEqual(result.uris?.length, 1);
		});

		test('selected staged only with working changes and old git and user confirms proceeds without onlyStaged', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile()],
				supportsStaged: false,
				supportsPathspecs: true,
			});
			const container = createMockContainer(repo);
			const stagedResource = createMockScmResource({
				resourceGroupType: ScmResourceGroupType.Index,
			});
			const context = createMockScmStatesContext('gitlens.stashSave.files:scm', [stagedResource]);
			stubWarningConfirm();

			const result = await getStashSaveArgsForScmStates(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, undefined);
		});

		test('selected working and untracked files sets keepStaged and includeUntracked', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile(), createUntrackedFile()],
				supportsPathspecs: true,
			});
			const container = createMockContainer(repo);
			const workingResource = createMockScmResource({
				resourceGroupType: ScmResourceGroupType.WorkingTree,
			});
			const untrackedResource = createMockScmResource({
				type: ScmStatus.UNTRACKED,
				resourceGroupType: ScmResourceGroupType.WorkingTree,
			});
			const context = createMockScmStatesContext('gitlens.stashSave.files:scm', [
				workingResource,
				untrackedResource,
			]);

			const result = await getStashSaveArgsForScmStates(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.keepStaged, true);
			assert.strictEqual(result.includeUntracked, true);
			assert.strictEqual(result.uris?.length, 2);
		});

		test('selected mixed staged and working files sets keepStaged when unselected staged files exist', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createStagedFile(), createWorkingFile()],
				supportsPathspecs: true,
			});
			const container = createMockContainer(repo);
			const stagedResource = createMockScmResource({
				resourceGroupType: ScmResourceGroupType.Index,
			});
			const workingResource = createMockScmResource({
				resourceGroupType: ScmResourceGroupType.WorkingTree,
			});
			const context = createMockScmStatesContext('gitlens.stashSave.files:scm', [
				stagedResource,
				workingResource,
			]);

			const result = await getStashSaveArgsForScmStates(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, undefined);
			assert.strictEqual(result.keepStaged, true);
			assert.strictEqual(result.includeUntracked, false);
			assert.strictEqual(result.uris?.length, 2);
		});

		test('selected all staged files does not set keepStaged', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createStagedFile()],
				supportsPathspecs: true,
			});
			const container = createMockContainer(repo);
			const staged1 = createMockScmResource({
				resourceGroupType: ScmResourceGroupType.Index,
			});
			const staged2 = createMockScmResource({
				resourceGroupType: ScmResourceGroupType.Index,
			});
			const context = createMockScmStatesContext('gitlens.stashSave.files:scm', [staged1, staged2]);

			const result = await getStashSaveArgsForScmStates(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.keepStaged, undefined);
			assert.strictEqual(result.includeUntracked, false);
		});
	});

	suite('getStashSaveArgsForScmGroups', () => {
		test('dispatches to staged handler for staged command', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile()],
				supportsStaged: true,
			});
			const container = createMockContainer(repo);
			const resource = createMockScmResource();
			const context = createMockScmGroupsContext('gitlens.stashSave.staged:scm', [resource]);

			const result = await getStashSaveArgsForScmGroups(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.onlyStaged, true);
		});

		test('dispatches to unstaged handler for unstaged command', async () => {
			const repo = createMockRepo({
				files: [createStagedFile(), createWorkingFile()],
			});
			const container = createMockContainer(repo);
			const resource = createMockScmResource();
			const context = createMockScmGroupsContext('gitlens.stashSave.unstaged:scm', [resource]);

			const result = await getStashSaveArgsForScmGroups(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.keepStaged, true);
			assert.strictEqual(result.reducedConfirm, true);
		});

		test('returns args with repoPath for generic stash command', async () => {
			const repo = createMockRepo({ files: [] });
			const container = createMockContainer(repo);
			const resource = createMockScmResource();
			const context = createMockScmGroupsContext('gitlens.stashSave:scm', [resource]);

			const result = await getStashSaveArgsForScmGroups(container, context, {});

			assert.ok(result != null);
			assert.strictEqual(result.repoPath, '/mock/repo');
			assert.strictEqual(result.onlyStaged, undefined);
			assert.strictEqual(result.keepStaged, undefined);
		});
	});
});
