'use strict';
import { Arrays } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri, isCommandViewContextWithRemote } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenBranchesInRemoteCommandArgs {
    remote?: string;
}

export class OpenBranchesInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenBranchesInRemote);
    }

    protected async preExecute(context: CommandContext, args: OpenBranchesInRemoteCommandArgs = {}): Promise<any> {
        if (isCommandViewContextWithRemote(context)) {
            args = { ...args };
            args.remote = context.node.remote.name;
            return this.execute(context.editor, context.uri, args);
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenBranchesInRemoteCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && await GitUri.fromUri(uri, this.git);

        const repoPath = gitUri === undefined ? this.git.repoPath : gitUri.repoPath;
        if (!repoPath) return undefined;

        try {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(repoPath), r => r.url, r => !!r.provider);

            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'branches'
                },
                remote: args.remote,
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenBranchesInRemoteCommand');
            return window.showErrorMessage(`Unable to open branches in remote provider. See output channel for more details`);
        }
    }
}