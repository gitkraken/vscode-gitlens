'use strict';
import { TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri, openEditor } from './common';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface OpenChangedFilesCommandArgs {
    uris?: Uri[];
}

export class OpenChangedFilesCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenChangedFiles);
    }

    async run(context: CommandContext, args: OpenChangedFilesCommandArgs = {}): Promise<any> {
        // Since we can change the args and they could be cached -- make a copy
        switch (context.type) {
            case 'uri':
                return this.execute(context.editor, context.uri, { ...args });
            case 'scm-states':
                return undefined;
            case 'scm-groups':
                // const group = context.scmResourceGroups[0];
                // args.uris = group.resourceStates.map(_ => _.resourceUri);
                return this.execute(undefined, undefined, { ...args });
            default:
                return this.execute(context.editor, undefined, { ...args });
        }
    }

    async execute(editor: TextEditor | undefined, uri?: Uri, args: OpenChangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                const repoPath = await this.git.getRepoPathFromUri(uri);
                if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open changed files`);

                const status = await this.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to open changed files`);

                args.uris = status.files.filter(_ => _.status !== 'D').map(_ => _.Uri);
            }

            for (const uri of args.uris) {
                await openEditor(uri, { preserveFocus: true, preview: false } as TextDocumentShowOptions);
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'OpenChangedFilesCommand');
            return window.showErrorMessage(`Unable to open changed files. See output channel for more details`);
        }
    }
}