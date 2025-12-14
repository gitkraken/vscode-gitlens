import type { SourceControlResourceState } from 'vscode';
import { env, Uri, window } from 'vscode';
import type { ScmResource } from '../@types/vscode.git.resources';
import { ScmResourceGroupType, ScmStatus } from '../@types/vscode.git.resources.enums';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { isUncommitted, isUncommittedStaged } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { filterMap } from '../system/array';
import { Logger } from '../system/logger';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import {
	isCommandContextViewNodeHasFileCommit,
	isCommandContextViewNodeHasFileRefs,
	isCommandContextViewNodeHasRefFile,
} from './commandContext.utils';

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
		super(['gitlens.externalDiff', 'gitlens.externalDiffAll']);
	}

	protected override async preExecute(context: CommandContext, args?: ExternalDiffCommandArgs): Promise<void> {
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

		if (isCommandContextViewNodeHasRefFile(context)) {
			const rev = context.node.ref.ref;
			args.files = [
				{
					uri: GitUri.fromFile(context.node.file, context.node.file.repoPath ?? context.node.repoPath),
					staged: isUncommittedStaged(rev) || context.node.file.indexStatus != null,
					ref1: isUncommitted(rev) ? '' : `${rev}^`,
					ref2: isUncommitted(rev) ? '' : rev,
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

		if (context.command === 'gitlens.externalDiffAll') {
			if (args.files == null) {
				const repository = await getRepositoryOrShowPicker(this.container, 'Open All Changes (difftool)');
				if (repository == null) return;

				const status = await this.container.git.getRepositoryService(repository.uri).status.getStatus();
				if (status == null) {
					return void window.showInformationMessage("The repository doesn't have any changes");
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

	async execute(args?: ExternalDiffCommandArgs): Promise<void> {
		args = { ...args };

		try {
			let repo;
			if (args.files == null) {
				const editor = window.activeTextEditor;
				if (editor == null) return;

				repo = this.container.git.getBestRepository(editor);
				if (repo == null) return;

				const uri = editor.document.uri;
				const status = await repo.git.status.getStatusForFile?.(uri);
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
				repo = await this.container.git.getOrOpenRepository(args.files[0].uri);
				if (repo == null) return;
			}

			const tool = configuration.get('advanced.externalDiffTool') || (await repo.git.diff.getDiffTool?.());
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
				void repo.git.diff.openDiffTool?.(file.uri, {
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
