'use strict';
import { Arrays } from '../system';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { OpenInRemoteCommandArgs } from './openInRemote';

export class OpenFileInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenFileInRemote);
    }

    async run(context: CommandContext): Promise<any> {
        switch (context.type) {
            case 'uri':
                return this.execute(context.editor, context.uri);
            case 'scm-states':
                const resource = context.scmResourceStates[0];
                return this.execute(undefined, resource.resourceUri);
            case 'scm-groups':
                return undefined;
            default:
                return this.execute(context.editor, undefined);
        }
    }

    async execute(editor: TextEditor | undefined, uri?: Uri) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);
        if (!gitUri.repoPath) return undefined;

        const branch = await this.git.getBranch(gitUri.repoPath);

        try {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(gitUri.repoPath), _ => _.url, _ => !!_.provider);
            const range = editor === undefined ? undefined : new Range(editor.selection.start.with({ line: editor.selection.start.line + 1 }), editor.selection.end.with({ line: editor.selection.end.line + 1 }));

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