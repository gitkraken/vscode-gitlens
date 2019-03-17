'use strict';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { UriComparer } from '../comparers';
import { FileAnnotationType } from '../configuration';
import { isTextEditor } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, EditorCommand } from './common';

@command()
export class ClearFileAnnotationsCommand extends EditorCommand {
    constructor() {
        super([Commands.ClearFileAnnotations, Commands.ComputingFileAnnotations]);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        // Handle the case where we are focused on a non-editor editor (output, debug console)
        if (editor != null && !isTextEditor(editor)) {
            if (uri != null && !UriComparer.equals(uri, editor.document.uri)) {
                const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
                if (e !== undefined) {
                    editor = e;
                }
            }
        }

        try {
            return Container.fileAnnotations.clear(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ClearFileAnnotationsCommand');
            return Messages.showGenericErrorMessage('Unable to clear file annotations');
        }
    }
}

export interface ToggleFileBlameCommandArgs {
    on?: boolean;
    sha?: string;
    type?: FileAnnotationType;
}

@command()
export class ToggleFileBlameCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.ToggleFileBlame);
    }

    execute(editor: TextEditor, uri?: Uri, args: ToggleFileBlameCommandArgs = {}): Thenable<any> {
        // Handle the case where we are focused on a non-editor editor (output, debug console)
        if (editor != null && !isTextEditor(editor)) {
            if (uri != null && !UriComparer.equals(uri, editor.document.uri)) {
                const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
                if (e !== undefined) {
                    editor = e;
                }
            }
        }

        try {
            if (args.type === undefined) {
                args = { ...args, type: FileAnnotationType.Blame };
            }

            return Container.fileAnnotations.toggle(
                editor,
                args.type!,
                args.sha !== undefined ? args.sha : editor && editor.selection.active.line,
                args.on
            );
        }
        catch (ex) {
            Logger.error(ex, 'ToggleFileBlameCommand');
            return window.showErrorMessage(
                `Unable to toggle file ${args.type} annotations. See output channel for more details`
            );
        }
    }
}

@command()
export class ToggleFileHeatmapCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.ToggleFileHeatmap);
    }

    execute(editor: TextEditor, uri?: Uri, args: ToggleFileBlameCommandArgs = {}): Thenable<any> {
        const copyArgs: ToggleFileBlameCommandArgs = {
            ...args,
            type: FileAnnotationType.Heatmap
        };
        return commands.executeCommand(Commands.ToggleFileBlame, uri, copyArgs);
    }
}

@command()
export class ToggleFileRecentChangesCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.ToggleFileRecentChanges);
    }

    execute(editor: TextEditor, uri?: Uri, args: ToggleFileBlameCommandArgs = {}): Thenable<any> {
        const copyArgs: ToggleFileBlameCommandArgs = {
            ...args,
            type: FileAnnotationType.RecentChanges
        };
        return commands.executeCommand(Commands.ToggleFileBlame, uri, copyArgs);
    }
}

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.ToggleLineBlame);
    }

    execute(editor: TextEditor, uri?: Uri): Thenable<any> {
        try {
            return Container.lineAnnotations.toggle(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleLineBlameCommand');
            return window.showErrorMessage(
                'Unable to toggle line blame annotations. See output channel for more details'
            );
        }
    }
}
