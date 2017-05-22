'use strict';
import { Arrays } from '../system';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { OpenInRemoteCommandArgs } from './openInRemote';

export class OpenRepoInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenRepoInRemote);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && await GitUri.fromUri(uri, this.git);

        const repoPath = gitUri === undefined ? this.git.repoPath : gitUri.repoPath;
        if (!repoPath) return undefined;

        try {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(repoPath), _ => _.url, _ => !!_.provider);
            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'repo'
                },
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenRepoInRemoteCommand');
            return window.showErrorMessage(`Unable to open repository in remote provider. See output channel for more details`);
        }
    }
}