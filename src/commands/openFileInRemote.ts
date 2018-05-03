'use strict';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri, isCommandViewContextWithBranch, isCommandViewContextWithCommit } from './common';
import { Container } from '../container';
import { GitUri } from '../gitService';
import { Logger } from '../logger';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenFileInRemoteCommandArgs {
    branch?: string;
    range?: boolean;
}

export class OpenFileInRemoteCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.OpenFileInRemote);
    }

    protected async preExecute(context: CommandContext, args: OpenFileInRemoteCommandArgs = { range: true }): Promise<any> {
        if (isCommandViewContextWithCommit(context)) {
            args = { ...args };
            args.range = false;
            if (isCommandViewContextWithBranch(context)) {
                args.branch = context.node.branch !== undefined ? context.node.branch.name : undefined;
            }
            return this.execute(context.editor, context.node.commit.uri, args);
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenFileInRemoteCommandArgs = { range: true }) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri);
        if (!gitUri.repoPath) return undefined;

        if (args.branch === undefined) {
            const branch = await Container.git.getBranch(gitUri.repoPath);
            if (branch !== undefined) {
                args.branch = branch.name;
            }
        }

        try {
            const remotes = await Container.git.getRemotes(gitUri.repoPath);
            const range = (args.range && editor !== undefined)
                ? new Range(editor.selection.start.with({ line: editor.selection.start.line + 1 }), editor.selection.end.with({ line: editor.selection.end.line + 1 }))
                : undefined;

            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: gitUri.sha === undefined ? 'file' : 'revision',
                    branch: args.branch,
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