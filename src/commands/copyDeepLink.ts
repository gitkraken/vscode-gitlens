import type { TextEditor, Uri } from 'vscode';
import type { StoredNamedRef } from '../constants.storage';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitReference } from '../git/models/reference';
import { getBranchNameAndRemote } from '../git/utils/branch.utils';
import { createReference } from '../git/utils/reference.utils';
import { showGenericErrorMessage } from '../messages';
import { showReferencePicker2 } from '../quickpicks/referencePicker';
import { showRemotePicker } from '../quickpicks/remotePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { normalizePath } from '../system/path';
import { DeepLinkType, deepLinkTypeToString, refTypeToDeepLinkType } from '../uris/deepLinks/deepLink';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import {
	isCommandContextEditorLine,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasComparison,
	isCommandContextViewNodeHasRemote,
	isCommandContextViewNodeHasTag,
	isCommandContextViewNodeHasWorkspace,
} from './commandContext.utils';

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
			'gitlens.copyDeepLinkToBranch',
			'gitlens.copyDeepLinkToCommit',
			'gitlens.copyDeepLinkToRepo',
			'gitlens.copyDeepLinkToTag',
			'gitlens.copyDeepLinkToComparison',
			'gitlens.copyDeepLinkToWorkspace',
		]);
	}

	protected override preExecute(context: CommandContext, args?: CopyDeepLinkCommandArgs): Promise<void> {
		if (args == null) {
			if (isCommandContextViewNodeHasCommit(context)) {
				args = { refOrRepoPath: context.node.commit };
			} else if (isCommandContextViewNodeHasComparison(context)) {
				args = {
					refOrRepoPath: context.node.uri.fsPath,
					compareRef: context.node.compareRef,
					compareWithRef: context.node.compareWithRef,
				};
			} else if (isCommandContextViewNodeHasBranch(context)) {
				if (context.command === 'gitlens.copyDeepLinkToRepo') {
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
			} else if (isCommandContextViewNodeHasWorkspace(context)) {
				args = { workspaceId: context.node.workspace.id };
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyDeepLinkCommandArgs): Promise<void> {
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
				await getBestRepositoryOrShowPicker(
					this.container,
					gitUri,
					editor,
					`Copy Link to ${deepLinkTypeToString(type)}`,
				)
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
			const remotes = await this.container.git.getRepositoryService(repoPath).remotes.getRemotes({ sort: true });
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

				chosenRemote = pick;
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

export interface CopyFileDeepLinkCommandArgs {
	ref?: GitReference;
	filePath?: string;
	lines?: number[];
	repoPath?: string;
	remote?: string;
	prePickRemote?: boolean;
	chooseRef?: boolean;
}

@command()
export class CopyFileDeepLinkCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.copyDeepLinkToFile', 'gitlens.copyDeepLinkToFileAtRevision', 'gitlens.copyDeepLinkToLines']);
	}

	protected override preExecute(context: CommandContext, args?: CopyFileDeepLinkCommandArgs): Promise<void> {
		if (args == null) {
			args = {};
		}

		if (args.ref == null && context.command === 'gitlens.copyDeepLinkToFileAtRevision') {
			args.chooseRef = true;
		}

		if (args.lines == null && context.command === 'gitlens.copyDeepLinkToLines') {
			let lines: number[] | undefined;
			if (isCommandContextEditorLine(context) && context.line != null) {
				lines = [context.line + 1];
			} else if (context.editor?.selection != null && !context.editor.selection.isEmpty) {
				if (context.editor.selection.isSingleLine) {
					lines = [context.editor.selection.start.line + 1];
				} else {
					lines = [context.editor.selection.start.line + 1, context.editor.selection.end.line + 1];
				}
			}

			args.lines = lines;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyFileDeepLinkCommandArgs): Promise<void> {
		args = { ...args };

		const type = DeepLinkType.File;
		let repoPath = args?.repoPath;
		let filePath = args?.filePath;
		let ref = args?.ref;
		if (repoPath == null || filePath == null || ref == null) {
			uri = getCommandUri(uri, editor);
			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;
			if (gitUri?.path == null || gitUri?.repoPath == null) return;

			if (repoPath == null) {
				repoPath = gitUri.repoPath;
			}

			if (filePath == null) {
				filePath = gitUri?.fsPath;
			}

			if (args?.chooseRef !== true && ref == null && repoPath != null && gitUri?.sha != null) {
				ref = createReference(gitUri.sha, repoPath, { refType: 'revision' });
			}

			if (repoPath == null || filePath == null) return;
			repoPath = normalizePath(repoPath);
			filePath = normalizePath(filePath);

			if (!filePath.startsWith(repoPath)) {
				Logger.error(
					`CopyFileDeepLinkCommand: File path ${filePath} is not contained in repo path ${repoPath}`,
				);

				void showGenericErrorMessage('Unable to copy file link');
			}

			filePath = filePath.substring(repoPath.length + 1);
			if (filePath.startsWith('/')) {
				filePath = filePath.substring(1);
			}
		}

		if (!repoPath || !filePath) return;

		if (args?.chooseRef) {
			const result = await showReferencePicker2(
				repoPath,
				`Copy Link to ${filePath} at Reference`,
				'Choose a reference (branch, tag, etc) to copy the file link for',
				{
					allowedAdditionalInput: { rev: true },
					include: ['branches', 'tags', 'workingTree', 'HEAD'],
				},
			);

			if (result.value == null) {
				return;
			} else if (result.value.ref === '') {
				ref = undefined;
			} else {
				ref = result.value;
			}
		}

		if (!args.remote) {
			if (args.ref?.refType === 'branch') {
				// If the branch is remote, or has an upstream, pre-select the remote
				if (args.ref.remote || args.ref.upstream?.name != null) {
					const [branchName, remoteName] = getBranchNameAndRemote(args.ref);
					if (branchName != null && remoteName != null) {
						args.remote = remoteName;
						args.prePickRemote = true;
					}
				}
			}
		}

		try {
			let chosenRemote;
			const remotes = await this.container.git.getRepositoryService(repoPath).remotes.getRemotes({ sort: true });
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

				chosenRemote = pick;
			}

			if (chosenRemote == null) return;

			await this.container.deepLinks.copyFileDeepLinkUrl(repoPath, filePath, chosenRemote.url, args.lines, ref);
		} catch (ex) {
			Logger.error(ex, 'CopyFileDeepLinkCommand');
			void showGenericErrorMessage('Unable to copy file link');
		}
	}
}
