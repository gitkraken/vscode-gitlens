'use strict';
import { env, SourceControlResourceState, Uri, window } from 'vscode';
import {
	command,
	Command,
	CommandContext,
	Commands,
	getRepoPathOrPrompt,
	isCommandContextViewNodeHasFileCommit,
	isCommandContextViewNodeHasFileRefs,
} from './common';
import { Container } from '../container';
import { GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Arrays } from '../system';

enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,

	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,

	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED,
}

enum ResourceGroupType {
	Merge,
	Index,
	WorkingTree,
}

interface Resource extends SourceControlResourceState {
	readonly resourceGroupType: ResourceGroupType;
	readonly type: Status;
}

interface ExternalDiffFile {
	uri: Uri;
	staged: boolean;
	ref1?: string;
	ref2?: string;
}

export interface ExternalDiffCommandArgs {
	files?: ExternalDiffFile[];
}

@command()
export class ExternalDiffCommand extends Command {
	constructor() {
		super([Commands.ExternalDiff, Commands.ExternalDiffAll]);
	}

	protected async preExecute(context: CommandContext, args?: ExternalDiffCommandArgs) {
		args = { ...args };

		if (isCommandContextViewNodeHasFileCommit(context)) {
			const ref1 = GitRevision.isUncommitted(context.node.commit.previousFileSha)
				? ''
				: context.node.commit.previousFileSha;
			const ref2 = context.node.commit.isUncommitted ? '' : context.node.commit.sha;

			args.files = [
				{
					uri: GitUri.fromFile(context.node.file, context.node.file.repoPath ?? context.node.repoPath),
					staged: context.node.commit.isUncommittedStaged || context.node.file.indexStatus != null,
					ref1: ref1,
					ref2: ref2,
				},
			];

			return this.execute(args);
		}

		if (isCommandContextViewNodeHasFileRefs(context)) {
			args.files = [
				{
					uri: GitUri.fromFile(context.node.file, context.node.file.repoPath ?? context.node.repoPath),
					staged: context.node.file.indexStatus != null,
					ref1: context.node.ref1,
					ref2: context.node.ref2,
				},
			];

			return this.execute(args);
		}

		if (args.files == null) {
			if (context.type === 'scm-states') {
				args.files = context.scmResourceStates.map(r => ({
					uri: r.resourceUri,
					staged: (r as Resource).resourceGroupType === ResourceGroupType.Index,
				}));
			} else if (context.type === 'scm-groups') {
				args.files = Arrays.filterMap(context.scmResourceGroups[0].resourceStates, r =>
					this.isModified(r)
						? {
								uri: r.resourceUri,
								staged: (r as Resource).resourceGroupType === ResourceGroupType.Index,
						  }
						: undefined,
				);
			}
		}

		if (context.command === Commands.ExternalDiffAll) {
			if (args.files == null) {
				const repoPath = await getRepoPathOrPrompt('Open All Changes (difftool)');
				if (!repoPath) return undefined;

				const status = await Container.git.getStatusForRepo(repoPath);
				if (status == null) {
					return window.showInformationMessage("The repository doesn't have any changes");
				}

				args.files = [];

				for (const file of status.files) {
					if (file.indexStatus === 'M') {
						args.files.push({ uri: file.uri, staged: true });
					}

					if (file.workingTreeStatus === 'M') {
						args.files.push({ uri: file.uri, staged: false });
					}
				}
			}
		}

		return this.execute(args);
	}

	private isModified(resource: SourceControlResourceState) {
		const status = (resource as Resource).type;
		return status === Status.BOTH_MODIFIED || status === Status.INDEX_MODIFIED || status === Status.MODIFIED;
	}

	async execute(args?: ExternalDiffCommandArgs) {
		args = { ...args };

		try {
			let repoPath;
			if (args.files == null) {
				const editor = window.activeTextEditor;
				if (editor == null) return;

				repoPath = await Container.git.getRepoPathOrActive(undefined, editor);
				if (!repoPath) return;

				const uri = editor.document.uri;
				const status = await Container.git.getStatusForFile(repoPath, uri.fsPath);
				if (status == null) {
					void window.showInformationMessage("The current file doesn't have any changes");

					return;
				}

				args.files = [];
				if (status.indexStatus === 'M') {
					args.files.push({ uri: status.uri, staged: true });
				}

				if (status.workingTreeStatus === 'M') {
					args.files.push({ uri: status.uri, staged: false });
				}
			} else {
				repoPath = await Container.git.getRepoPath(args.files[0].uri.fsPath);
				if (!repoPath) return;
			}

			const tool = await Container.git.getDiffTool(repoPath);
			if (tool == null) {
				const result = await window.showWarningMessage(
					'Unable to open changes in diff tool. No Git diff tool is configured',
					'View Git Docs',
				);
				if (!result) return;

				void env.openExternal(
					Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
				);

				return;
			}

			for (const file of args.files) {
				void Container.git.openDiffTool(repoPath, file.uri, {
					ref1: file.ref1,
					ref2: file.ref2,
					staged: file.staged,
					tool: tool,
				});
			}
		} catch (ex) {
			Logger.error(ex, 'ExternalDiffCommand');
			void Messages.showGenericErrorMessage('Unable to open changes in diff tool');
		}
	}
}
