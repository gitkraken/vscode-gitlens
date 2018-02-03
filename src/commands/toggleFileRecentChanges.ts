'use strict';
import { commands, TextEditor, TextEditorEdit, Uri } from 'vscode';
import { ToggleFileBlameCommandArgs } from '../commands';
import { Commands, EditorCommand } from './common';
import { FileAnnotationType } from '../configuration';

export class ToggleFileRecentChangesCommand extends EditorCommand {

    constructor() {
        super(Commands.ToggleFileRecentChanges);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        commands.executeCommand(Commands.ToggleFileBlame, uri, { type: FileAnnotationType.RecentChanges } as ToggleFileBlameCommandArgs);
    }
}