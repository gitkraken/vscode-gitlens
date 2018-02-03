'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { Container } from '../container';
import { Logger } from '../logger';

export class ShowLineBlameCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.ShowLineBlame);
    }

    async execute(editor?: TextEditor, uri?: Uri): Promise<any> {
        try {
            return Container.lineAnnotations.showAnnotations(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ShowLineBlameCommand');
            return window.showErrorMessage(`Unable to show line blame annotations. See output channel for more details`);
        }
    }
}