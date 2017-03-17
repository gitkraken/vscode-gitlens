'use strict';
import { commands, Position, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand } from './commands';
import { BuiltInCommands } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export class ShowBlameHistoryCommand extends EditorCommand {

    constructor(private git: GitService) {
        super(Commands.ShowBlameHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, range?: Range, position?: Position, sha?: string, line?: number) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        if (range == null || position == null) {
            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            range = editor.document.validateRange(new Range(0, 0, 1000000, 1000000));
            position = editor.document.validateRange(new Range(0, 0, 0, 1000000)).start;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        try {
            const locations = await this.git.getBlameLocations(gitUri.fsPath, range, gitUri.sha, gitUri.repoPath, sha, line);
            if (!locations) return window.showWarningMessage(`Unable to show blame history. File is probably not under source control`);

            return commands.executeCommand(BuiltInCommands.ShowReferences, uri, position, locations);
        }
        catch (ex) {
            Logger.error('[GitLens.ShowBlameHistoryCommand]', 'getBlameLocations', ex);
            return window.showErrorMessage(`Unable to show blame history. See output channel for more details`);
        }
    }
}