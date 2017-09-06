'use strict';
import { Arrays } from '../system';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri, isCommandViewContextWithCommit } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenFileInRemoteCommandArgs {
    range?: boolean;
}

export class OpenFileInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenFileInRemote);
    }

    protected async preExecute(context: CommandContext, args: OpenFileInRemoteCommandArgs = { range: true }): Promise<any> {
        if (isCommandViewContextWithCommit(context)) {
            args = { ...args };
            args.range = false;
            return this.execute(context.editor, context.node.commit.uri, args);
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenFileInRemoteCommandArgs = { range: true }) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);
        if (!gitUri.repoPath) return undefined;

        const branch = await this.git.getBranch(gitUri.repoPath);

        try {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(gitUri.repoPath), _ => _.url, _ => !!_.provider);
            const range = (args.range && editor !== undefined)
                ? new Range(editor.selection.start.with({ line: editor.selection.start.line + 1 }), editor.selection.end.with({ line: editor.selection.end.line + 1 }))
                : undefined;

            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'file',
                    branch: branch === undefined ? 'Current' : branch.name,
                    fileName: gitUri.getRelativePath(),
                    range: range,
                    sha: gitUri.sha
                },
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenFileInRemoteCommand');
            return window.showErrorMessage(`Unable to open file in remote provider. See output channel for more details`);
        }
    }
}