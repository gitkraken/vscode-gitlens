import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { splitBranchNameAndRemote } from '../git/models/branch';
import type { GitReference } from '../git/models/reference';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { RemotePicker } from '../quickpicks/remotePicker';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { DeepLinkType, deepLinkTypeToString, refTypeToDeepLinkType } from '../uris/deepLinks/deepLink';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasTag,
} from './base';

export interface CopyDeepLinkCommandArgs {
	ref?: GitReference;
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
				args = { ref: context.node.commit };
			} else if (isCommandContextViewNodeHasBranch(context)) {
				args = { ref: context.node.branch };
			} else if (isCommandContextViewNodeHasTag(context)) {
				args = { ref: context.node.tag };
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyDeepLinkCommandArgs) {
		let type;
		let repoPath;
		if (args?.ref == null) {
			uri = getCommandUri(uri, editor);
			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

			type = DeepLinkType.Repository;
			repoPath = (
				await RepositoryPicker.getBestRepositoryOrShow(
					gitUri,
					editor,
					`Copy Link to ${deepLinkTypeToString(type)}`,
				)
			)?.path;
		} else {
			type = refTypeToDeepLinkType(args.ref.refType);
			repoPath = args.ref.repoPath;
		}
		if (!repoPath) return;

		args = { ...args };

		if (!args.remote) {
			if (args.ref?.refType === 'branch') {
				// If the branch is remote, or has an upstream, pre-select the remote
				if (args.ref.remote || args.ref.upstream?.name != null) {
					const [branchName, remoteName] = splitBranchNameAndRemote(
						args.ref.remote ? args.ref.name : args.ref.upstream!.name,
					);

					if (branchName != null) {
						args.remote = remoteName;
						args.prePickRemote = true;
					}
				}
			}
		}

		try {
			const pick = await RemotePicker.show(
				`Copy Link to ${deepLinkTypeToString(type)}`,
				`Choose which remote to copy the link for`,
				await this.container.git.getRemotes(repoPath, { sort: true }),
				{
					autoPick: true,
					picked: args.remote,
					setDefault: true,
				},
			);
			if (pick == null) return;

			if (args.ref == null) {
				await this.container.deepLinks.copyDeepLinkUrl(repoPath, pick.item.url);
			} else {
				await this.container.deepLinks.copyDeepLinkUrl(args.ref, pick.item.url);
			}
		} catch (ex) {
			Logger.error(ex, 'CopyDeepLinkCommand');
			void showGenericErrorMessage('Unable to copy link');
		}
	}
}
