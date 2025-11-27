import type { TextEditor, Uri } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { deletedOrMissing } from '../git/models/revision';
import { isUncommitted } from '../git/utils/revision.utils';
import {
	showCommitNotFoundWarningMessage,
	showFileNotUnderSourceControlWarningMessage,
	showGenericErrorMessage,
} from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextGitTimelineItem, isCommandContextViewNodeHasCommit } from './commandContext.utils';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenCommitOnRemoteCommandArgs {
	clipboard?: boolean;
	line?: number;
	sha?: string;
	source?: Source;
}

@command()
export class OpenCommitOnRemoteCommand extends ActiveEditorCommand {
	static createMarkdownCommandLink(sha: string, source: Source): string;
	static createMarkdownCommandLink(args: OpenCommitOnRemoteCommandArgs): string;
	static createMarkdownCommandLink(argsOrSha: OpenCommitOnRemoteCommandArgs | string, source?: Source): string {
		const args: OpenCommitOnRemoteCommandArgs =
			typeof argsOrSha === 'string' ? { sha: argsOrSha, source: source } : argsOrSha;
		return createMarkdownCommandLink<OpenCommitOnRemoteCommandArgs>('gitlens.openCommitOnRemote', args);
	}

	constructor(private readonly container: Container) {
		super(['gitlens.openCommitOnRemote', 'gitlens.copyRemoteCommitUrl'], ['gitlens.openCommitInRemote']);
	}

	protected override preExecute(context: CommandContext, args?: OpenCommitOnRemoteCommandArgs): Promise<void> {
		let uri = context.uri;

		if (context.type === 'editorLine') {
			args = { ...args, line: context.line };
		}

		if (isCommandContextViewNodeHasCommit(context)) {
			if (context.node.commit.isUncommitted) return Promise.resolve(undefined);

			args = { ...args, sha: context.node.commit.sha };
			uri = context.node.uri;
		}

		if (isCommandContextGitTimelineItem(context)) {
			args = { sha: context.item.ref };
			uri = context.uri;
		}

		if (context.command === 'gitlens.copyRemoteCommitUrl') {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenCommitOnRemoteCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);

		let gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await getBestRepositoryOrShowPicker(
				this.container,
				gitUri,
				editor,
				args?.clipboard ? 'Copy Remote Commit URL' : 'Open Commit On Remote',
			)
		)?.path;
		if (!repoPath) return;

		if (gitUri == null) {
			gitUri = GitUri.fromRepoPath(repoPath);
		}

		args = { ...args };

		try {
			if (args.sha == null) {
				const blameLine = args.line ?? editor?.selection.active.line;
				if (blameLine == null) return;

				const blame = await this.container.git.getBlameForLine(gitUri, blameLine, editor?.document);
				if (blame == null) {
					void showFileNotUnderSourceControlWarningMessage(
						args?.clipboard
							? 'Unable to copy the commit SHA'
							: 'Unable to open the commit on the remote provider',
					);

					return;
				}

				// If the line is uncommitted, use previous commit
				args.sha = blame.commit.isUncommitted
					? ((await blame.commit.getPreviousSha()) ?? deletedOrMissing)
					: blame.commit.sha;
			}

			if (args.sha == null || args.sha === deletedOrMissing || isUncommitted(args.sha)) {
				void showCommitNotFoundWarningMessage(
					args?.clipboard
						? 'Unable to copy the commit SHA'
						: 'Unable to open the commit on the remote provider',
				);

				return;
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				resource: {
					type: RemoteResourceType.Commit,
					sha: args.sha,
				},
				repoPath: repoPath,
				clipboard: args.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenCommitOnRemoteCommand');
			void showGenericErrorMessage('Unable to open commit on remote provider');
		}
	}
}
