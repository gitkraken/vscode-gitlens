import type { TextEditor, Uri } from 'vscode';
import { Range } from 'vscode';
import { GlyphChars } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/models/branch.utils';
import { RemoteResourceType } from '../git/models/remoteResource';
import { isSha } from '../git/models/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { UriComparer } from '../system/comparers';
import { Logger } from '../system/logger';
import { pad, splitSingle } from '../system/string';
import { command, executeCommand } from '../system/vscode/command';
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
	line?: number;
	range?: boolean;
	sha?: string;
	pickBranchOrTag?: boolean;
}

@command()
export class OpenFileOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			GlCommand.OpenFileOnRemote,
			GlCommand.Deprecated_OpenFileInRemote,
			GlCommand.CopyRemoteFileUrl,
			GlCommand.CopyRemoteFileUrlWithoutRange,
			GlCommand.OpenFileOnRemoteFrom,
			GlCommand.CopyRemoteFileUrlFrom,
		]);
	}

	protected override async preExecute(context: CommandContext, args?: OpenFileOnRemoteCommandArgs) {
		let uri = context.uri;

		if (context.type === 'editorLine') {
			args = { ...args, line: context.line, range: true };
		}

		if (context.command === GlCommand.CopyRemoteFileUrlWithoutRange) {
			args = { ...args, range: false };
		}

		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args, range: false };

			if (
				context.command === GlCommand.CopyRemoteFileUrl ||
				context.command === GlCommand.CopyRemoteFileUrlWithoutRange ||
				context.command === GlCommand.CopyRemoteFileUrlFrom
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
			context.command === GlCommand.CopyRemoteFileUrl ||
			context.command === GlCommand.CopyRemoteFileUrlWithoutRange ||
			context.command === GlCommand.CopyRemoteFileUrlFrom
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

		if (context.command === GlCommand.OpenFileOnRemoteFrom || context.command === GlCommand.CopyRemoteFileUrlFrom) {
			args = { ...args, pickBranchOrTag: true, range: false }; // Override range since it can be wrong at a different commit
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
			let remotes = await this.container.git.getRemotesWithProviders(gitUri.repoPath, { sort: true });

			let range: Range | undefined;
			if (args.range) {
				if (editor != null && UriComparer.equals(editor.document.uri, uri)) {
					range = new Range(
						editor.selection.start.with({ line: editor.selection.start.line + 1 }),
						editor.selection.end.with({
							line: editor.selection.end.line + (editor.selection.end.character === 0 ? 0 : 1),
						}),
					);
				} else if (args.line != null) {
					range = new Range(args.line + 1, 0, args.line + 1, 0);
				}
			}

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
							allowRevisions: true,
							autoPick: true,
							filter: { branches: b => b.remote || b.upstream != null },
							picked: args.branchOrTag,
							sort: {
								branches: { current: true, orderBy: 'date:desc' },
								tags: { orderBy: 'date:desc' },
							},
						},
					);
					if (pick == null) return;

					if (pick.refType === 'branch') {
						branch = pick;
						args.branchOrTag = undefined;
						sha = undefined;
					} else if (pick.refType === 'tag') {
						args.branchOrTag = pick.ref;
						sha = undefined;
					} else {
						args.branchOrTag = undefined;
						sha = pick.ref;
					}
				}

				if (branch != null) {
					if (branch.remote || (branch.upstream != null && !branch.upstream.missing)) {
						const name = branch.remote ? branch.name : branch.upstream!.name;
						args.branchOrTag = getBranchNameWithoutRemote(name);

						const remoteName = getRemoteNameFromBranchName(name);
						const remote = remotes.find(r => r.name === remoteName);
						if (remote != null) {
							remotes = [remote];
						}
					} else {
						args.branchOrTag = branch.name;
					}
				}
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(GlCommand.OpenOnRemote, {
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
