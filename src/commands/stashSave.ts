import type { Uri } from 'vscode';
import { window } from 'vscode';
import type { ScmResource } from '../@types/vscode.git.resources.d.js';
import { ScmResourceGroupType, ScmStatus } from '../@types/vscode.git.resources.enums.js';
import type { Container } from '../container.js';
import { push } from '../git/actions/stash.js';
import { GitUri } from '../git/gitUri.js';
import type { Repository } from '../git/models/repository.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext, CommandScmGroupsContext, CommandScmStatesContext } from './commandContext.js';
import {
	isCommandContextViewNodeHasFile,
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
} from './commandContext.utils.js';

export interface StashSaveCommandArgs {
	message?: string;
	repoPath?: string;
	uris?: Uri[];
	includeUntracked?: boolean;
	keepStaged?: boolean;
	onlyStaged?: boolean;
	onlyStagedUris?: Uri[];
	reducedConfirm?: boolean;
}

@command()
export class StashSaveCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([
			'gitlens.stashSave',
			'gitlens.stashSave:scm',
			'gitlens.stashSave:views',
			'gitlens.stashSave.staged:scm',
			'gitlens.stashSave.unstaged:scm',
			'gitlens.stashSave.files:scm',
			'gitlens.stashSave.files:views',
		]);
	}

	protected override async preExecute(context: CommandContext, args?: StashSaveCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasFile(context)) {
			args = { ...args };
			args.repoPath = context.node.file.repoPath ?? context.node.repoPath;
			args.uris = [GitUri.fromFile(context.node.file, args.repoPath)];
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
		} else if (context.type === 'scm') {
			if (context.scm.rootUri != null) {
				const repo = this.container.git.getRepository(context.scm.rootUri);
				if (repo != null) {
					args = { ...args };
					args.repoPath = repo.path;

					const status = await repo.git.status.getStatus();
					for (const file of status?.files ?? []) {
						if (file.status === '?') {
							args.includeUntracked = true;
							break;
						}
					}
				}
			}
		} else if (context.type === 'scm-states') {
			args = await getStashSaveArgsForScmStates(this.container, context, args);
			if (args == null) return;
		} else if (context.type === 'scm-groups') {
			args = await getStashSaveArgsForScmGroups(this.container, context, args);
			if (args == null) return;
		} else if (context.command === 'gitlens.stashSave.unstaged:scm') {
			const repo = this.container.git.getBestRepository();
			if (repo != null) {
				args = await getStashSaveArgsForUnstagedScmGroup(repo, { ...args, repoPath: repo.path });
			}

			if (args == null) return;
		}

		return this.execute(args);
	}

	execute(args?: StashSaveCommandArgs): Promise<void> {
		return push(
			args?.repoPath,
			args?.uris,
			args?.message,
			args?.includeUntracked,
			args?.keepStaged,
			args?.onlyStaged,
			args?.onlyStagedUris,
			args?.reducedConfirm,
		);
	}
}

async function getStashSaveArgsForScmStates(
	container: Container,
	context: CommandScmStatesContext,
	args: StashSaveCommandArgs | undefined,
): Promise<StashSaveCommandArgs | undefined> {
	args = { ...args };

	let selectedStaged = 0;
	let selectedWorking = 0;
	let selectedUntracked = 0;

	const uris: Uri[] = [];

	for (const resource of context.scmResourceStates as ScmResource[]) {
		uris.push(resource.resourceUri);
		if (resource.type === ScmStatus.UNTRACKED) {
			selectedUntracked++;
		}

		if (resource.resourceGroupType === ScmResourceGroupType.Index) {
			selectedStaged++;
		} else if (resource.resourceGroupType === ScmResourceGroupType.WorkingTree) {
			selectedWorking++;
		}
	}

	const repo = await container.git.getOrOpenRepository(uris[0]);
	args.repoPath = repo?.path;

	if (!(await repo?.git?.supports('git:stash:push:pathspecs'))) {
		const confirm = { title: 'Stash All' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			"Your Git version doesn't support stashing individual files. Stash all changes instead?",
			{ modal: true },
			confirm,
			cancel,
		);
		if (result !== confirm) return undefined;

		return args;
	}

	let hasStaged = 0;
	let hasWorking = false;
	let hasUntracked = false;

	const status = await repo?.git.status.getStatus();
	for (const file of status?.files ?? []) {
		if (file.indexStatus) {
			hasStaged++;
		}
		if (file.workingTreeStatus) {
			hasWorking = true;
		}
		if (file.status === '?') {
			hasUntracked = true;
		}
	}

	if (!selectedWorking && !selectedUntracked && (hasWorking || hasUntracked)) {
		if (!(await repo?.git?.supports('git:stash:push:staged'))) {
			const confirm = { title: 'Stash All' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				"Your Git version doesn't support stashing only staged changes. Stash all changes instead?",
				{ modal: true },
				confirm,
				cancel,
			);
			if (result !== confirm) return args;
		} else {
			args.onlyStaged = true;
		}
	}

	if (args.keepStaged == null && hasStaged !== selectedStaged) {
		args.keepStaged = true;
	}
	args.includeUntracked = Boolean(selectedUntracked);

	args.uris = uris;
	return args;
}

async function getStashSaveArgsForScmGroups(
	container: Container,
	context: CommandScmGroupsContext,
	args: StashSaveCommandArgs | undefined,
): Promise<StashSaveCommandArgs | undefined> {
	args = { ...args };

	let repo;
	const uri = context.scmResourceGroups[0]?.resourceStates[0]?.resourceUri;
	if (uri != null) {
		repo = await container.git.getOrOpenRepository(uri);
		args.repoPath = repo?.path;
	}
	if (repo == null) return args;

	if (context.command === 'gitlens.stashSave.staged:scm') {
		return getStashSaveArgsForStagedScmGroup(repo, args);
	}

	if (context.command === 'gitlens.stashSave.unstaged:scm') {
		return getStashSaveArgsForUnstagedScmGroup(repo, args);
	}

	return args;
}

async function getStashSaveArgsForStagedScmGroup(
	repo: Repository,
	args: StashSaveCommandArgs,
): Promise<StashSaveCommandArgs | undefined> {
	let hasStaged = false;
	let hasWorking = false;
	let hasUntracked = false;

	const status = await repo.git.status.getStatus();
	for (const file of status?.files ?? []) {
		if (file.indexStatus) {
			hasStaged = true;
		}
		if (file.workingTreeStatus) {
			hasWorking = true;
		}
		if (file.status === '?') {
			hasUntracked = true;
		}
	}

	if (!hasStaged) {
		const confirm = { title: 'Stash All' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			'There are no staged changes to stash. Stash all changes instead?',
			{ modal: true },
			confirm,
			cancel,
		);
		if (result !== confirm) return undefined;

		return args;
	}

	args.onlyStaged = false;
	if (hasWorking || hasUntracked) {
		if (await repo?.git?.supports('git:stash:push:staged')) {
			args.onlyStaged = true;
		} else {
			const confirm = { title: 'Stash All' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				"Your Git version doesn't support stashing only staged changes. Stash all changes instead?",
				{ modal: true },
				confirm,
				cancel,
			);
			if (result !== confirm) return;
		}
	}

	args.keepStaged = false;
	args.includeUntracked = false;

	return args;
}

async function getStashSaveArgsForUnstagedScmGroup(
	repo: Repository,
	args: StashSaveCommandArgs,
): Promise<StashSaveCommandArgs | undefined> {
	let hasStaged = false;
	let hasWorking = false;
	let hasUntracked = false;

	const status = await repo?.git.status.getStatus();
	for (const file of status?.files ?? []) {
		if (file.indexStatus) {
			hasStaged = true;
		}
		if (file.workingTreeStatus) {
			hasWorking = true;
		}
		if (file.status === '?') {
			hasUntracked = true;
		}
	}

	if (!hasWorking && !hasUntracked) {
		const confirm = { title: 'Stash All' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			'There are no unstaged changes to stash. Stash all changes instead?',
			{ modal: true },
			confirm,
			cancel,
		);
		if (result !== confirm) return undefined;

		return args;
	}

	if (args.keepStaged == null && hasStaged) {
		args.keepStaged = true;
	}
	args.includeUntracked = hasUntracked;
	args.reducedConfirm = true;

	return args;
}
