'use strict';
import { commands, TextEditor, TextEditorEdit, Uri } from 'vscode';
import { ToggleFileBlameCommandArgs } from '../commands';
import { Commands, EditorCommand } from './common';
import { FileAnnotationType } from '../configuration';

export class ToggleFileHeatmapCommand extends EditorCommand {

    constructor() {
        super(Commands.ToggleFileHeatmap);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        commands.executeCommand(Commands.ToggleFileBlame, uri, { type: FileAnnotationType.Heatmap } as ToggleFileBlameCommandArgs);
    }
}