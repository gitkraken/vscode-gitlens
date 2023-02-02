import type { TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getRemoteNameFromBranchName } from '../git/models/branch';
import type { GitReference } from '../git/models/reference';
import type { RemoteResource } from '../git/models/remoteResource';
import { RemoteResourceType } from '../git/models/remoteResource';
import { Logger } from '../logger';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/command';
import { splitSingle } from '../system/string';
import { DeepLinkType } from '../uris/deepLinks/deepLink';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasTag,
} from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface CopyDeepLinkCommandArgs {
	targetType?: DeepLinkType;
	targetId?: string;
	remote?: string;
	preSelectRemote?: boolean;
}

@command()
export class CopyDeepLinkCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.CopyDeepLinkToBranch,
			Commands.CopyDeepLinkToCommit,
			Commands.CopyDeepLinkToRepo,
			Commands.CopyDeepLinkToTag,
		]);
	}

	getCopyLabelFromTargetType(targetType: DeepLinkType): string {
		let copyLabel = 'Copy Link to ';
		switch (targetType) {
			case DeepLinkType.Branch:
				copyLabel += 'Branch';
				break;
			case DeepLinkType.Commit:
				copyLabel += 'Commit';
				break;
			case DeepLinkType.Repository:
				copyLabel += 'Repository';
				break;
			case DeepLinkType.Tag:
				copyLabel += 'Tag';
				break;
			default:
				copyLabel += 'Unknown';
		}

		return copyLabel;
	}

	getCopyDeepLinkCommandArgs(context: CommandContext, ref?: GitReference): CopyDeepLinkCommandArgs | undefined {
		if (ref == null) return undefined;

		let args: CopyDeepLinkCommandArgs | undefined;
		if (context.command === Commands.CopyDeepLinkToBranch && ref.refType === 'branch') {
			args = {
				targetId: ref.name,
				targetType: DeepLinkType.Branch,
			};

			// If the branch is remote, or has an upstream, pre-select the remote
			if (ref.remote || ref.upstream?.name != null) {
				const [remoteName, branchName] = splitSingle(ref.remote ? ref.name : ref.upstream!.name, '/');
				if (branchName != null) {
					args.remote = remoteName;
					args.preSelectRemote = true;
				}
			}
		} else if (context.command === Commands.CopyDeepLinkToCommit && ref.refType === 'revision') {
			args = {
				targetId: ref.ref,
				targetType: DeepLinkType.Commit,
			};
		} else if (context.command === Commands.CopyDeepLinkToRepo && ref.refType === 'branch' && ref.remote) {
			args = {
				remote: getRemoteNameFromBranchName(ref.name),
				targetType: DeepLinkType.Repository,
			};
		} else if (context.command === Commands.CopyDeepLinkToTag && ref.refType === 'tag') {
			args = {
				targetId: ref.name,
				targetType: DeepLinkType.Tag,
			};
		}

		return args;
	}

	getRemoteResourceFromTarget(repoId: string, targetType: DeepLinkType, targetId?: string): RemoteResource {
		switch (targetType) {
			case DeepLinkType.Branch:
				return {
					type: RemoteResourceType.Branch,
					repoId: repoId,
					branch: targetId!,
				};
			case DeepLinkType.Commit:
				return {
					type: RemoteResourceType.Commit,
					repoId: repoId,
					sha: targetId!,
				};
			case DeepLinkType.Tag:
				return {
					type: RemoteResourceType.Tag,
					repoId: repoId,
					tag: targetId!,
				};
			default:
				return {
					type: RemoteResourceType.Repo,
					repoId: repoId,
				};
		}
	}

	protected override preExecute(context: CommandContext, args?: GitReference) {
		let targetRef: GitReference | undefined = args;

		if (targetRef == null) {
			if (isCommandContextViewNodeHasCommit(context)) {
				targetRef = context.node.commit;
			} else if (isCommandContextViewNodeHasBranch(context)) {
				targetRef = context.node.branch;
			} else if (isCommandContextViewNodeHasTag(context)) {
				targetRef = context.node.tag;
			}
		}

		const deepLinkArgs: CopyDeepLinkCommandArgs | undefined = this.getCopyDeepLinkCommandArgs(context, targetRef);

		return this.execute(context.editor, context.uri, deepLinkArgs);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyDeepLinkCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await RepositoryPicker.getBestRepositoryOrShow(
				gitUri,
				editor,
				this.getCopyLabelFromTargetType(args?.targetType ?? DeepLinkType.Repository),
			)
		)?.path;
		if (!repoPath) return;

		args = { ...args };

		const repoId: string | undefined =
			(await this.container.git.getFirstCommitSha(repoPath)) ??
			this.container.git.getRepository(repoPath)?.id?.replace(/\//g, '_');

		if (repoId == null) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: this.getRemoteResourceFromTarget(
					repoId,
					args.targetType ?? DeepLinkType.Repository,
					args.targetId,
				),
				repoPath: repoPath,
				remote: args.remote,
				preSelectRemote: args.preSelectRemote,
				clipboard: true,
				deepLink: true,
			}));
		} catch (ex) {
			Logger.error(ex, 'CopyDeepLinkCommand');
			void window.showErrorMessage('Unable to copy deep link. See output channel for more details');
		}
	}
}
