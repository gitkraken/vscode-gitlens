'use strict';
import { Iterables } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri, isCommandViewContextWithCommit } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { copy } from 'copy-paste';

export interface CopyMessageToClipboardCommandArgs {
    message?: string;
    sha?: string;
}

export class CopyMessageToClipboardCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.CopyMessageToClipboard);
    }

    protected async preExecute(context: CommandContext, args: CopyMessageToClipboardCommandArgs = {}): Promise<any> {
        if (isCommandViewContextWithCommit(context)) {
            args = { ...args };
            args.sha = context.node.commit.sha;
            return this.execute(context.editor, context.node.commit.uri, args);
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: CopyMessageToClipboardCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);

        try {
            args = { ...args };

            // If we don't have an editor then get the message of the last commit to the branch
            if (uri === undefined) {
                const repoPath = await this.git.getActiveRepoPath(editor);
                if (!repoPath) return undefined;

                const log = await this.git.getLogForRepo(repoPath, { maxCount: 1 });
                if (!log) return undefined;

                args.message = Iterables.first(log.commits.values()).message;
                copy(args.message);
                return undefined;
            }

            const gitUri = await GitUri.fromUri(uri, this.git);

            if (args.message === undefined) {
                if (args.sha === undefined) {
                    const blameline = (editor && editor.selection.active.line) || 0;
                    if (blameline < 0) return undefined;

                    try {
                        const blame = editor && editor.document && editor.document.isDirty
                            ? await this.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
                            : await this.git.getBlameForLine(gitUri, blameline);
                        if (!blame) return undefined;

                        if (blame.commit.isUncommitted) return undefined;

                        args.sha = blame.commit.sha;
                        if (!gitUri.repoPath) {
                            gitUri.repoPath = blame.commit.repoPath;
                        }
                    }
                    catch (ex) {
                        Logger.error(ex, 'CopyMessageToClipboardCommand', `getBlameForLine(${blameline})`);
                        return window.showErrorMessage(`Unable to copy message. See output channel for more details`);
                    }
                }

                // Get the full commit message -- since blame only returns the summary
                const commit = await this.git.getLogCommit(gitUri.repoPath, gitUri.fsPath, args.sha);
                if (commit === undefined) return undefined;

                args.message = commit.message;
            }

            copy(args.message);
            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'CopyMessageToClipboardCommand');
            return window.showErrorMessage(`Unable to copy message. See output channel for more details`);
        }
    }
}