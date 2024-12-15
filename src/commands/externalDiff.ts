import type { SourceControlResourceState } from 'vscode';
import { env, Uri, window } from 'vscode';
import type { ScmResource } from '../@types/vscode.git.resources';
import { ScmResourceGroupType, ScmStatus } from '../@types/vscode.git.resources.enums';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { isUncommitted } from '../git/models/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { filterMap } from '../system/array';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import type { CommandContext } from './base';
import { GlCommandBase, isCommandContextViewNodeHasFileCommit, isCommandContextViewNodeHasFileRefs } from './base';

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
export class ExternalDiffCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([GlCommand.ExternalDiff, GlCommand.ExternalDiffAll]);
	}

	protected override async preExecute(context: CommandContext, args?: ExternalDiffCommandArgs) {
		args = { ...args };

		if (isCommandContextViewNodeHasFileCommit(context)) {
			const previousSha = await context.node.commit.getPreviousSha();
			const ref1 = isUncommitted(previousSha) ? '' : previousSha;
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
					staged: (r as ScmResource).resourceGroupType === ScmResourceGroupType.Index,
				}));
			} else if (context.type === 'scm-groups') {
				args.files = filterMap(context.scmResourceGroups[0].resourceStates, r =>
					this.isModified(r)
						? {
								uri: r.resourceUri,
								staged: (r as ScmResource).resourceGroupType === ScmResourceGroupType.Index,
						  }
						: undefined,
				);
			}
		}

		if (context.command === GlCommand.ExternalDiffAll) {
			if (args.files == null) {
				const repository = await getRepositoryOrShowPicker('Open All Changes (difftool)');
				if (repository == null) return undefined;

				const status = await this.container.git.getStatus(repository.uri);
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
		const status = (resource as ScmResource).type;
		return (
			status === ScmStatus.BOTH_MODIFIED || status === ScmStatus.INDEX_MODIFIED || status === ScmStatus.MODIFIED
		);
	}

	async execute(args?: ExternalDiffCommandArgs) {
		args = { ...args };

		try {
			let repoPath;
			if (args.files == null) {
				const editor = window.activeTextEditor;
				if (editor == null) return;

				repoPath = this.container.git.getBestRepository(editor)?.path;
				if (!repoPath) return;

				const uri = editor.document.uri;
				const status = await this.container.git.getStatusForFile(repoPath, uri);
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
				repoPath = (await this.container.git.getOrOpenRepository(args.files[0].uri))?.path;
				if (!repoPath) return;
			}

			const tool =
				configuration.get('advanced.externalDiffTool') || (await this.container.git.getDiffTool(repoPath));
			if (!tool) {
				const viewDocs = 'View Git Docs';
				const result = await window.showWarningMessage(
					'Unable to open changes because no Git diff tool is configured',
					viewDocs,
				);
				if (result === viewDocs) {
					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}

				return;
			}

			for (const file of args.files) {
				void this.container.git.openDiffTool(repoPath, file.uri, {
					ref1: file.ref1,
					ref2: file.ref2,
					staged: file.staged,
					tool: tool,
				});
			}
		} catch (ex) {
			Logger.error(ex, 'ExternalDiffCommand');
			void showGenericErrorMessage('Unable to open changes in diff tool');
		}
	}
}
