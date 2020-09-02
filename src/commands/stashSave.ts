'use strict';
import { Uri } from 'vscode';
import { GitActions } from '../commands';
import {
	command,
	Command,
	CommandContext,
	Commands,
	isCommandViewContextWithFile,
	isCommandViewContextWithRepo,
	isCommandViewContextWithRepoPath,
} from './common';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';

const enum ResourceGroupType {
	Merge,
	Index,
	WorkingTree,
}

export interface StashSaveCommandArgs {
	message?: string;
	repoPath?: string;
	uris?: Uri[];
	keepStaged?: boolean;
}

@command()
export class StashSaveCommand extends Command {
	constructor() {
		super([Commands.StashSave, Commands.StashSaveFiles]);
	}

	protected async preExecute(context: CommandContext, args?: StashSaveCommandArgs) {
		if (isCommandViewContextWithFile(context)) {
			args = { ...args };
			args.repoPath = context.node.file.repoPath ?? context.node.repoPath;
			args.uris = [GitUri.fromFile(context.node.file, args.repoPath)];
		} else if (isCommandViewContextWithRepo(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
		} else if (isCommandViewContextWithRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
		} else if (context.type === 'scm-states') {
			args = { ...args };
			args.uris = context.scmResourceStates.map(s => s.resourceUri);
			args.repoPath = await Container.git.getRepoPath(args.uris[0].fsPath);

			const status = await Container.git.getStatusForRepo(args.repoPath);
			if (status?.computeWorkingTreeStatus().staged) {
				if (!context.scmResourceStates.some(s => (s as any).resourceGroupType === ResourceGroupType.Index)) {
					args.keepStaged = true;
				}
			}
		} else if (context.type === 'scm-groups') {
			args = { ...args };
			args.uris = context.scmResourceGroups.reduce<Uri[]>(
				(a, b) => a.concat(b.resourceStates.map(s => s.resourceUri)),
				[],
			);
			args.repoPath = await Container.git.getRepoPath(args.uris[0].fsPath);

			const status = await Container.git.getStatusForRepo(args.repoPath);
			if (status?.computeWorkingTreeStatus().staged) {
				if (!context.scmResourceGroups.some(g => g.id === 'index')) {
					args.keepStaged = true;
				}
			}
		}

		return this.execute(args);
	}

	execute(args?: StashSaveCommandArgs) {
		return GitActions.Stash.push(args?.repoPath, args?.uris, args?.message, args?.keepStaged);
	}
}
