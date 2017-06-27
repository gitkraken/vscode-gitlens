'use strict';
import { Arrays } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GitBlameCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { OpenInRemoteCommandArgs } from './openInRemote';

export class OpenCommitInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenCommitInRemote);
    }

    async execute(editor?: TextEditor, uri?: Uri) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;
        if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);
        if (!gitUri.repoPath) return undefined;

        const line = editor === undefined ? gitUri.offset : editor.selection.active.line;

        try {
            const blameline = line - gitUri.offset;
            if (blameline < 0) return undefined;

            const blame = await this.git.getBlameForLine(gitUri, blameline);
            if (blame === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open commit in remote provider');

            let commit = blame.commit;
            // If the line is uncommitted, find the previous commit
            if (commit.isUncommitted) {
                commit = new GitBlameCommit(commit.repoPath, commit.previousSha!, commit.previousFileName!, commit.author, commit.date, commit.message, []);
            }

            const remotes = Arrays.uniqueBy(await this.git.getRemotes(gitUri.repoPath), _ => _.url, _ => !!_.provider);
            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'commit',
                    sha: commit.sha
                },
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenCommitInRemoteCommand');
            return window.showErrorMessage(`Unable to open commit in remote provider. See output channel for more details`);
        }
    }
}