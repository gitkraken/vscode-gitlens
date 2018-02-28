'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri, isCommandViewContextWithRemote } from './common';
import { Container } from '../container';
import { GitUri } from '../gitService';
import { Logger } from '../logger';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenRepoInRemoteCommandArgs {
    remote?: string;
}

export class OpenRepoInRemoteCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.OpenRepoInRemote);
    }

    protected async preExecute(context: CommandContext, args: OpenRepoInRemoteCommandArgs = {}): Promise<any> {
        if (isCommandViewContextWithRemote(context)) {
            args = { ...args };
            args.remote = context.node.remote.name;
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenRepoInRemoteCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && await GitUri.fromUri(uri);

        const repoPath = gitUri === undefined ? Container.git.getHighlanderRepoPath() : gitUri.repoPath;
        if (!repoPath) return undefined;

        try {
            const remotes = await Container.git.getRemotes(repoPath);

            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'repo'
                },
                remote: args.remote,
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenRepoInRemoteCommand');
            return window.showErrorMessage(`Unable to open repository in remote provider. See output channel for more details`);
        }
    }
}