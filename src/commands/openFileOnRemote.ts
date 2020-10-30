'use strict';
import { Range, TextEditor, Uri, window } from 'vscode';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeCommand,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
} from './common';
import { UriComparer } from '../comparers';
import { BranchSorting } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitRevision, RemoteResourceType } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { ReferencePicker, ReferencesQuickPickIncludes } from '../quickpicks';
import { OpenOnRemoteCommandArgs } from './openOnRemote';
import { Strings } from '../system';
import { StatusFileNode } from '../views/nodes';

export interface OpenFileOnRemoteCommandArgs {
	branch?: string;
	clipboard?: boolean;
	range?: boolean;
	sha?: string;
}

@command()
export class OpenFileOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.OpenFileOnRemote, Commands.Deprecated_OpenFileInRemote, Commands.CopyRemoteFileUrl]);
	}

	protected async preExecute(context: CommandContext, args?: OpenFileOnRemoteCommandArgs) {
		let uri = context.uri;

		if (context.type === 'uris' || context.type === 'scm-states') {
			args = { ...args, range: false };
		} else if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args, range: false };

			if (context.command === Commands.CopyRemoteFileUrl) {
				// If it is a StatusFileNode then don't include the sha, since it hasn't been pushed yet
				args.sha = context.node instanceof StatusFileNode ? undefined : context.node.commit.sha;
			} else if (isCommandContextViewNodeHasBranch(context)) {
				args.branch = context.node.branch?.name;
			}

			uri = context.node.uri;
		} else if (context.type === 'viewItem') {
			args = { ...args, range: false };

			uri = context.node.uri ?? context.uri;
		}

		if (context.command === Commands.CopyRemoteFileUrl) {
			args = { ...args, clipboard: true };
			if (args.sha == null) {
				const uri = getCommandUri(context.uri, context.editor);
				if (uri != null) {
					const gitUri = await GitUri.fromUri(uri);
					if (gitUri.repoPath) {
						if (gitUri.sha == null) {
							const commit = await Container.git.getCommitForFile(gitUri.repoPath, gitUri.fsPath, {
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

		return this.execute(context.editor, uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenFileOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) return;

		args = { range: true, ...args };

		try {
			const remotes = await Container.git.getRemotes(gitUri.repoPath);
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

			if (args.branch == null && sha != null && !GitRevision.isSha(sha) && remotes.length !== 0) {
				const [remoteName, branchName] = Strings.splitSingle(sha, '/');
				if (branchName != null && remotes.some(r => r.name === remoteName)) {
					args.branch = branchName;
					sha = undefined;
				}
			}

			if (args.branch == null && args.sha == null) {
				const branch = await Container.git.getBranch(gitUri.repoPath);
				if (branch == null || branch.tracking == null) {
					const pick = await ReferencePicker.show(
						gitUri.repoPath,
						args.clipboard
							? `Copy Remote File Url From${Strings.pad(GlyphChars.Dot, 2, 2)}${gitUri.relativePath}`
							: `Open File on Remote From${Strings.pad(GlyphChars.Dot, 2, 2)}${gitUri.relativePath}`,
						`Choose a branch to ${args.clipboard ? 'copy' : 'open'} the file revision from`,
						{
							autoPick: true,
							// checkmarks: false,
							filter: { branches: b => b.tracking != null },
							include: ReferencesQuickPickIncludes.Branches,
							sort: {
								branches: { current: true, orderBy: BranchSorting.DateDesc },
							},
						},
					);
					if (pick == null) return;

					args.branch = pick.ref;
				} else {
					args.branch = branch.name;
				}
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: sha == null ? RemoteResourceType.File : RemoteResourceType.Revision,
					branch: args.branch ?? 'HEAD',
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
			void window.showErrorMessage('Unable to open file on remote provider. See output channel for more details');
		}
	}
}
