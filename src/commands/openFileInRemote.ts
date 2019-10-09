'use strict';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitService, GitUri, RemoteResourceType } from '../git/gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, ReferencesQuickPick, ReferencesQuickPickIncludes } from '../quickpicks';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithBranch,
	isCommandViewContextWithCommit
} from './common';
import { OpenInRemoteCommandArgs } from './openInRemote';
import { Strings } from '../system';
import { UriComparer } from '../comparers';

export interface OpenFileInRemoteCommandArgs {
	branch?: string;
	clipboard?: boolean;
	range?: boolean;
	sha?: string;
}

@command()
export class OpenFileInRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenFileInRemote);
	}

	protected preExecute(context: CommandContext, args?: OpenFileInRemoteCommandArgs) {
		if (isCommandViewContextWithCommit(context)) {
			args = { ...args, range: false };
			if (isCommandViewContextWithBranch(context)) {
				args.branch = context.node.branch !== undefined ? context.node.branch.name : undefined;
			}

			return this.execute(
				context.editor,
				context.node.commit.isFile ? context.node.commit.uri : context.node.uri,
				args
			);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenFileInRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) return undefined;

		args = { range: true, ...args };

		try {
			const remotes = await Container.git.getRemotes(gitUri.repoPath);
			const range =
				args.range && editor != null && UriComparer.equals(editor.document.uri, uri)
					? new Range(
							editor.selection.start.with({ line: editor.selection.start.line + 1 }),
							editor.selection.end.with({ line: editor.selection.end.line + 1 })
					  )
					: undefined;
			let sha = args.sha || gitUri.sha;

			if (args.branch === undefined && sha !== undefined && !GitService.isSha(sha) && remotes.length !== 0) {
				const [remotePart, branchPart] = Strings.splitSingle(sha, '/');
				if (branchPart !== undefined) {
					if (remotes.some(r => r.name === remotePart)) {
						args.branch = branchPart;
						sha = undefined;
					}
				}
			}

			if (args.branch === undefined && args.sha === undefined) {
				const branch = await Container.git.getBranch(gitUri.repoPath);
				if (branch === undefined || branch.tracking === undefined) {
					const pick = await new ReferencesQuickPick(gitUri.repoPath).show(
						args.clipboard
							? `Copy url for ${gitUri.relativePath} to clipboard for which branch${GlyphChars.Ellipsis}`
							: `Open ${gitUri.relativePath} on remote for which branch${GlyphChars.Ellipsis}`,
						{
							autoPick: true,
							checkmarks: false,
							filterBranches: b => b.tracking !== undefined,
							include: ReferencesQuickPickIncludes.Branches
						}
					);
					if (pick === undefined || pick instanceof CommandQuickPickItem) return undefined;

					args.branch = pick.ref;
				} else {
					args.branch = branch.name;
				}
			}

			const commandArgs: OpenInRemoteCommandArgs = {
				resource:
					sha === undefined
						? {
								type: RemoteResourceType.File,
								branch: args.branch || 'HEAD',
								fileName: gitUri.relativePath,
								range: range
						  }
						: {
								type: RemoteResourceType.Revision,
								branch: args.branch || 'HEAD',
								fileName: gitUri.relativePath,
								range: range,
								sha: sha
						  },
				remotes: remotes,
				clipboard: args.clipboard
			};
			return commands.executeCommand(Commands.OpenInRemote, uri, commandArgs);
		} catch (ex) {
			Logger.error(ex, 'OpenFileInRemoteCommand');
			return window.showErrorMessage(
				'Unable to open file on remote provider. See output channel for more details'
			);
		}
	}
}
