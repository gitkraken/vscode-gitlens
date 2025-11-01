import type { TextEditor, Uri } from 'vscode';
import { Range } from 'vscode';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/utils/branch.utils';
import { isSha } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { pad, splitSingle } from '../system/string';
import { areUrisEqual } from '../system/uri';
import { StatusFileNode } from '../views/nodes/statusFileNode';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasBranch, isCommandContextViewNodeHasCommit } from './commandContext.utils';
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

			let range: Range | undefined;
			if (args.range) {
				if (editor != null && areUrisEqual(editor.document.uri, uri)) {
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
						const remote = remotes.find(r => r.name === remoteName);
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
