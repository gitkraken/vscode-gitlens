import type { TextEditor, Uri } from 'vscode';
import { Range } from 'vscode';
import { BranchSorting, TagSorting } from '../config';
import { Commands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/models/branch';
import { isSha } from '../git/models/reference';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { command, executeCommand } from '../system/command';
import { UriComparer } from '../system/comparers';
import { Logger } from '../system/logger';
import { pad, splitSingle } from '../system/string';
import { StatusFileNode } from '../views/nodes/statusFileNode';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
} from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenFileOnRemoteCommandArgs {
	branchOrTag?: string;
	clipboard?: boolean;
	range?: boolean;
	sha?: string;
	pickBranchOrTag?: boolean;
}

@command()
export class OpenFileOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.OpenFileOnRemote,
			Commands.Deprecated_OpenFileInRemote,
			Commands.CopyRemoteFileUrl,
			Commands.CopyRemoteFileUrlWithoutRange,
			Commands.OpenFileOnRemoteFrom,
			Commands.CopyRemoteFileUrlFrom,
		]);
	}

	protected override async preExecute(context: CommandContext, args?: OpenFileOnRemoteCommandArgs) {
		let uri = context.uri;

		if (context.command === Commands.CopyRemoteFileUrlWithoutRange) {
			args = { ...args, range: false };
		}

		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args, range: false };

			if (
				context.command === Commands.CopyRemoteFileUrl ||
				context.command === Commands.CopyRemoteFileUrlWithoutRange ||
				context.command === Commands.CopyRemoteFileUrlFrom
			) {
				// If it is a StatusFileNode then don't include the sha, since it hasn't been pushed yet
				args.sha = context.node instanceof StatusFileNode ? undefined : context.node.commit.sha;
			} else if (isCommandContextViewNodeHasBranch(context)) {
				args.branchOrTag = context.node.branch?.name;
			}

			uri = context.node.uri;
		} else if (context.type === 'viewItem') {
			args = { ...args, range: false };

			uri = context.node.uri ?? context.uri;
		}

		if (
			context.command === Commands.CopyRemoteFileUrl ||
			context.command === Commands.CopyRemoteFileUrlWithoutRange ||
			context.command === Commands.CopyRemoteFileUrlFrom
		) {
			args = { ...args, clipboard: true };
			if (args.sha == null) {
				const uri = getCommandUri(context.uri, context.editor);
				if (uri != null) {
					const gitUri = await GitUri.fromUri(uri);
					if (gitUri.repoPath) {
						if (gitUri.sha == null) {
							const commit = await this.container.git.getCommitForFile(gitUri.repoPath, gitUri, {
								firstIfNotFound: true,
							});

							if (commit != null) {
								args.sha = commit.sha;
							}
						} else {
							args.sha = gitUri.sha;
						}
					}
				}
			}
		}

		if (context.command === Commands.OpenFileOnRemoteFrom || context.command === Commands.CopyRemoteFileUrlFrom) {
			args = { ...args, pickBranchOrTag: true, range: false };
		}

		return this.execute(context.editor, uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenFileOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) return;

		args = { range: true, ...args };

		try {
			let remotes = await this.container.git.getRemotesWithProviders(gitUri.repoPath);
			const range =
				args.range && editor != null && UriComparer.equals(editor.document.uri, uri)
					? new Range(
							editor.selection.start.with({ line: editor.selection.start.line + 1 }),
							editor.selection.end.with({
								line: editor.selection.end.line + (editor.selection.end.character === 0 ? 0 : 1),
							}),
					  )
					: undefined;
			let sha = args.sha ?? gitUri.sha;

			if (args.branchOrTag == null && sha != null && !isSha(sha) && remotes.length !== 0) {
				const [remoteName, branchName] = splitSingle(sha, '/');
				if (branchName != null) {
					const remote = remotes.find(r => r.name === remoteName);
					if (remote != null) {
						args.branchOrTag = branchName;
						sha = undefined;

						remotes = [remote];
					}
				}
			}

			if ((args.sha == null && args.branchOrTag == null) || args.pickBranchOrTag) {
				let branch;
				if (!args.pickBranchOrTag) {
					branch = await this.container.git.getBranch(gitUri.repoPath);
				}

				if (branch?.upstream == null) {
					const pick = await showReferencePicker(
						gitUri.repoPath,
						args.clipboard
							? `Copy Remote File URL From${pad(GlyphChars.Dot, 2, 2)}${gitUri.relativePath}`
							: `Open File on Remote From${pad(GlyphChars.Dot, 2, 2)}${gitUri.relativePath}`,
						`Choose a branch or tag to ${args.clipboard ? 'copy' : 'open'} the file revision from`,
						{
							allowEnteringRefs: true,
							autoPick: true,
							// checkmarks: false,
							filter: { branches: b => b.remote || b.upstream != null },
							picked: args.branchOrTag,
							sort: {
								branches: { current: true, orderBy: BranchSorting.DateDesc },
								tags: { orderBy: TagSorting.DateDesc },
							},
						},
					);
					if (pick == null) return;

					if (pick.refType === 'branch') {
						if (pick.remote) {
							args.branchOrTag = getBranchNameWithoutRemote(pick.name);

							const remoteName = getRemoteNameFromBranchName(pick.name);
							const remote = remotes.find(r => r.name === remoteName);
							if (remote != null) {
								remotes = [remote];
							}
						} else {
							args.branchOrTag = pick.name;
						}
						sha = undefined;
					} else if (pick.refType === 'tag') {
						args.branchOrTag = pick.ref;
						sha = undefined;
					} else {
						args.branchOrTag = undefined;
						sha = pick.ref;
					}
				} else {
					args.branchOrTag = branch.name;
				}
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: sha == null ? RemoteResourceType.File : RemoteResourceType.Revision,
					branchOrTag: args.branchOrTag ?? 'HEAD',
					fileName: gitUri.relativePath,
					range: range,
					sha: sha ?? undefined,
				},
				repoPath: gitUri.repoPath,
				remotes: remotes,
				clipboard: args.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenFileOnRemoteCommand');
			void showGenericErrorMessage('Unable to open file on remote provider');
		}
	}
}
