import type { TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitRevision } from '../git/models/reference';
import { RemoteResourceType } from '../git/models/remoteResource';
import { Logger } from '../logger';
import { showFileNotUnderSourceControlWarningMessage } from '../messages';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/command';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	getCommandUri,
	isCommandContextGitTimelineItem,
	isCommandContextViewNodeHasCommit,
} from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenCommitOnRemoteCommandArgs {
	clipboard?: boolean;
	sha?: string;
}

@command()
export class OpenCommitOnRemoteCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(sha: string): string;
	static getMarkdownCommandArgs(args: OpenCommitOnRemoteCommandArgs): string;
	static getMarkdownCommandArgs(argsOrSha: OpenCommitOnRemoteCommandArgs | string): string {
		const args: OpenCommitOnRemoteCommandArgs = typeof argsOrSha === 'string' ? { sha: argsOrSha } : argsOrSha;
		return super.getMarkdownCommandArgsCore<OpenCommitOnRemoteCommandArgs>(Commands.OpenCommitOnRemote, args);
	}

	constructor(private readonly container: Container) {
		super([Commands.OpenCommitOnRemote, Commands.Deprecated_OpenCommitInRemote, Commands.CopyRemoteCommitUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenCommitOnRemoteCommandArgs) {
		let uri = context.uri;

		if (isCommandContextViewNodeHasCommit(context)) {
			if (context.node.commit.isUncommitted) return Promise.resolve(undefined);

			args = { ...args, sha: context.node.commit.sha };
			uri = context.node.uri;
		}

		if (isCommandContextGitTimelineItem(context)) {
			args = { sha: context.item.ref };
			uri = context.uri;
		}

		if (context.command === Commands.CopyRemoteCommitUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenCommitOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		let gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await RepositoryPicker.getBestRepositoryOrShow(
				gitUri,
				editor,
				args?.clipboard ? 'Copy Remote Commit Url' : 'Open Commit On Remote',
			)
		)?.path;
		if (!repoPath) return;

		if (gitUri == null) {
			gitUri = GitUri.fromRepoPath(repoPath);
		}

		args = { ...args };

		try {
			if (args.sha == null) {
				const blameline = editor == null ? 0 : editor.selection.active.line;
				if (blameline < 0) return;

				const blame = await this.container.git.getBlameForLine(gitUri, blameline, editor?.document);
				if (blame == null) {
					void showFileNotUnderSourceControlWarningMessage('Unable to open commit on remote provider');

					return;
				}

				// If the line is uncommitted, use previous commit
				args.sha = blame.commit.isUncommitted
					? (await blame.commit.getPreviousSha()) ?? GitRevision.deletedOrMissing
					: blame.commit.sha;
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Commit,
					sha: args.sha,
				},
				repoPath: repoPath,
				clipboard: args.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenCommitOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open commit on remote provider. See output channel for more details',
			);
		}
	}
}
