import type { TextEditor, Uri } from 'vscode';
import type { StoredNamedRef } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getBranchNameAndRemote } from '../git/models/branch';
import type { GitReference } from '../git/models/reference';
import { showGenericErrorMessage } from '../messages';
import { showRemotePicker } from '../quickpicks/remotePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { DeepLinkType, deepLinkTypeToString, refTypeToDeepLinkType } from '../uris/deepLinks/deepLink';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasComparison,
	isCommandContextViewNodeHasRemote,
	isCommandContextViewNodeHasTag,
	isCommandContextViewNodeHasWorkspace,
} from './base';

export interface CopyDeepLinkCommandArgs {
	refOrRepoPath?: GitReference | string;
	compareRef?: StoredNamedRef;
	compareWithRef?: StoredNamedRef;
	remote?: string;
	prePickRemote?: boolean;
	workspaceId?: string;
}

@command()
export class CopyDeepLinkCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.CopyDeepLinkToBranch,
			Commands.CopyDeepLinkToCommit,
			Commands.CopyDeepLinkToRepo,
			Commands.CopyDeepLinkToTag,
			Commands.CopyDeepLinkToComparison,
			Commands.CopyDeepLinkToWorkspace,
		]);
	}

	protected override preExecute(context: CommandContext, args?: CopyDeepLinkCommandArgs) {
		if (args == null) {
			if (isCommandContextViewNodeHasCommit(context)) {
				args = { refOrRepoPath: context.node.commit };
			} else if (isCommandContextViewNodeHasBranch(context)) {
				if (context.command === Commands.CopyDeepLinkToRepo) {
					args = {
						refOrRepoPath: context.node.branch.repoPath,
						remote: context.node.branch.getRemoteName(),
					};
				} else {
					args = { refOrRepoPath: context.node.branch };
				}
			} else if (isCommandContextViewNodeHasTag(context)) {
				args = { refOrRepoPath: context.node.tag };
			} else if (isCommandContextViewNodeHasRemote(context)) {
				args = { refOrRepoPath: context.node.remote.repoPath, remote: context.node.remote.name };
			} else if (isCommandContextViewNodeHasComparison(context)) {
				args = {
					refOrRepoPath: context.node.uri.fsPath,
					compareRef: context.node.compareRef,
					compareWithRef: context.node.compareWithRef,
				};
			} else if (isCommandContextViewNodeHasWorkspace(context)) {
				args = { workspaceId: context.node.workspace.id };
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyDeepLinkCommandArgs) {
		args = { ...args };

		if (args.workspaceId != null) {
			try {
				await this.container.deepLinks.copyDeepLinkUrl(args.workspaceId);
			} catch (ex) {
				Logger.error(ex, 'CopyDeepLinkCommand');
				void showGenericErrorMessage('Unable to copy link');
			}
			return;
		}

		let type;
		let repoPath;
		if (args?.refOrRepoPath == null) {
			uri = getCommandUri(uri, editor);
			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

			type = DeepLinkType.Repository;
			repoPath = (
				await getBestRepositoryOrShowPicker(gitUri, editor, `Copy Link to ${deepLinkTypeToString(type)}`)
			)?.path;
		} else if (typeof args.refOrRepoPath === 'string') {
			type = args.compareRef == null ? DeepLinkType.Repository : DeepLinkType.Comparison;
			repoPath = args.refOrRepoPath;
			args.refOrRepoPath = undefined;
		} else {
			type = refTypeToDeepLinkType(args.refOrRepoPath.refType);
			repoPath = args.refOrRepoPath.repoPath;
		}
		if (!repoPath) return;

		if (!args.remote) {
			if (args.refOrRepoPath?.refType === 'branch') {
				// If the branch is remote, or has an upstream, pre-select the remote
				if (args.refOrRepoPath.remote || args.refOrRepoPath.upstream?.name != null) {
					const [branchName, remoteName] = getBranchNameAndRemote(args.refOrRepoPath);
					if (branchName != null && remoteName != null) {
						args.remote = remoteName;
						args.prePickRemote = true;
					}
				}
			}
		}

		try {
			let chosenRemote;
			const remotes = await this.container.git.getRemotes(repoPath, { sort: true });
			const defaultRemote = remotes.find(r => r.default);
			if (args.remote && !args.prePickRemote) {
				chosenRemote = remotes.find(r => r.name === args?.remote);
			} else if (defaultRemote != null) {
				chosenRemote = defaultRemote;
			} else {
				const pick = await showRemotePicker(
					`Copy Link to ${deepLinkTypeToString(type)}`,
					`Choose which remote to copy the link for`,
					remotes,
					{
						autoPick: true,
						picked: args.remote,
						setDefault: true,
					},
				);
				if (pick == null) return;
				chosenRemote = pick.item;
			}

			if (chosenRemote == null) return;

			if (args.refOrRepoPath == null) {
				await this.container.deepLinks.copyDeepLinkUrl(
					repoPath,
					chosenRemote.url,
					args.compareRef,
					args.compareWithRef,
				);
			} else {
				await this.container.deepLinks.copyDeepLinkUrl(args.refOrRepoPath, chosenRemote.url);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyDeepLinkCommand');
			void showGenericErrorMessage('Unable to copy link');
		}
	}
}
