import type { TextEditor, Uri } from 'vscode';
import type { LineRange } from '@gitlens/git/models/lineRange.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import { isSha } from '@gitlens/git/utils/revision.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import { pad, splitSingle } from '@gitlens/utils/string.js';
import { areUrisEqual } from '@gitlens/utils/uri.js';
import { GlyphChars } from '../constants.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import { showGenericErrorMessage } from '../messages.js';
import { showReferencePicker } from '../quickpicks/referencePicker.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { StatusFileNode } from '../views/nodes/statusFileNode.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasBranch, isCommandContextViewNodeHasCommit } from './commandContext.utils.js';
import type { OpenOnRemoteCommandArgs } from './openOnRemote.js';

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
		super(
			[
				'gitlens.openFileOnRemote',
				'gitlens.copyRemoteFileUrlToClipboard',
				'gitlens.copyRemoteFileUrlWithoutRange',
				'gitlens.openFileOnRemoteFrom',
				'gitlens.copyRemoteFileUrlFrom',
			],
			['gitlens.openFileInRemote'],
		);
	}

	protected override async preExecute(context: CommandContext, args?: OpenFileOnRemoteCommandArgs): Promise<void> {
		let uri = context.uri;

		if (context.type === 'editorLine') {
			args = { ...args, line: context.line, range: true };
		}

		if (context.command === 'gitlens.copyRemoteFileUrlWithoutRange') {
			args = { ...args, range: false };
		}

		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args, range: false };

			if (
				context.command === 'gitlens.copyRemoteFileUrlToClipboard' ||
				context.command === 'gitlens.copyRemoteFileUrlWithoutRange' ||
				context.command === 'gitlens.copyRemoteFileUrlFrom'
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
			context.command === 'gitlens.copyRemoteFileUrlToClipboard' ||
			context.command === 'gitlens.copyRemoteFileUrlWithoutRange' ||
			context.command === 'gitlens.copyRemoteFileUrlFrom'
		) {
			args = { ...args, clipboard: true };
			if (args.sha == null) {
				const uri = getCommandUri(context.uri, context.editor);
				if (uri != null) {
					const gitUri = await GitUri.fromUri(uri);
					if (gitUri.repoPath) {
						if (gitUri.sha == null) {
							const commit = await this.container.git
								.getRepositoryService(gitUri.repoPath)
								.commits.getCommitForFile(gitUri, undefined, { firstIfNotFound: true });
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

		if (context.command === 'gitlens.openFileOnRemoteFrom' || context.command === 'gitlens.copyRemoteFileUrlFrom') {
			args = { ...args, pickBranchOrTag: true, range: false }; // Override range since it can be wrong at a different commit
		}

		return this.execute(context.editor, uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenFileOnRemoteCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) return;

		args = { range: true, ...args };

		const svc = this.container.git.getRepositoryService(gitUri.repoPath);

		try {
			let remotes = await svc.remotes.getRemotesWithProviders({ sort: true });

			let range: LineRange | undefined;
			if (args.range) {
				if (editor != null && areUrisEqual(editor.document.uri, uri)) {
					range = {
						startLine: editor.selection.start.line + 1,
						startCharacter: editor.selection.start.character + 1,
						endLine: editor.selection.end.line + (editor.selection.end.character === 0 ? 0 : 1),
						endCharacter: editor.selection.end.character === 0 ? 1 : editor.selection.end.character + 1,
					};
				} else if (args.line != null) {
					range = { startLine: args.line + 1, startCharacter: 1, endLine: args.line + 1, endCharacter: 1 };
				}
			}

			let sha = args.sha ?? gitUri.sha;

			if (args.branchOrTag == null && sha != null && !isSha(sha) && remotes.length !== 0) {
				const [remoteName, branchName] = splitSingle(sha, '/');
				if (branchName != null) {
					const remote = remotes.find((r: GitRemote) => r.name === remoteName);
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
					branch = await svc.branches.getBranch();
				}

				if (branch?.upstream == null) {
					const pick = await showReferencePicker(
						gitUri.repoPath,
						args.clipboard
							? `Copy Remote File URL From${pad(GlyphChars.Dot, 2, 2)}${gitUri.relativePath}`
							: `Open File on Remote From${pad(GlyphChars.Dot, 2, 2)}${gitUri.relativePath}`,
						`Choose a branch or tag to ${args.clipboard ? 'copy' : 'open'} the file revision from`,
						{
							allowedAdditionalInput: { rev: true },
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
						const remote = remotes.find((r: GitRemote) => r.name === remoteName);
						if (remote != null) {
							remotes = [remote];
						}
					} else {
						args.branchOrTag = branch.name;
					}
				}
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
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
