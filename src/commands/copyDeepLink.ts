import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { splitBranchNameAndRemote } from '../git/models/branch';
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
	isCommandContextViewNodeHasRemote,
	isCommandContextViewNodeHasTag,
} from './base';

export interface CopyDeepLinkCommandArgs {
	refOrRepoPath?: GitReference | string;
	remote?: string;
	prePickRemote?: boolean;
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

	protected override preExecute(context: CommandContext, args?: CopyDeepLinkCommandArgs) {
		if (args == null) {
			if (isCommandContextViewNodeHasCommit(context)) {
				args = { refOrRepoPath: context.node.commit };
			} else if (isCommandContextViewNodeHasBranch(context)) {
				args = { refOrRepoPath: context.node.branch };
			} else if (isCommandContextViewNodeHasTag(context)) {
				args = { refOrRepoPath: context.node.tag };
			} else if (isCommandContextViewNodeHasRemote(context)) {
				args = { refOrRepoPath: context.node.remote.repoPath, remote: context.node.remote.name };
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyDeepLinkCommandArgs) {
		args = { ...args };

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
			type = DeepLinkType.Repository;
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
					const [branchName, remoteName] = splitBranchNameAndRemote(
						args.refOrRepoPath.remote ? args.refOrRepoPath.name : args.refOrRepoPath.upstream!.name,
					);

					if (branchName != null) {
						args.remote = remoteName;
						args.prePickRemote = true;
					}
				}
			}
		}

		try {
			let chosenRemote;
			const remotes = await this.container.git.getRemotes(repoPath, { sort: true });
			if (args.remote && !args.prePickRemote) {
				chosenRemote = remotes.find(r => r.name === args?.remote);
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
				await this.container.deepLinks.copyDeepLinkUrl(repoPath, chosenRemote.url);
			} else {
				await this.container.deepLinks.copyDeepLinkUrl(args.refOrRepoPath, chosenRemote.url);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyDeepLinkCommand');
			void showGenericErrorMessage('Unable to copy link');
		}
	}
}
