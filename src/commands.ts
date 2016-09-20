'use strict'
import {commands, DecorationOptions, Disposable, OverviewRulerLane, Position, Range, TextEditor, TextEditorEdit, TextEditorDecorationType, Uri, window} from 'vscode';
import {BuiltInCommands, Commands} from './constants';
import GitProvider from './gitProvider';
import GitBlameController from './gitBlameController';
import * as moment from 'moment';
import * as path from 'path';

abstract class Command extends Disposable {
    private _subscriptions: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._subscriptions = commands.registerCommand(command, this.execute, this);
    }

    dispose() {
        this._subscriptions && this._subscriptions.dispose();
    }

    abstract execute(...args): any;
}

abstract class EditorCommand extends Disposable {
    private _subscriptions: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._subscriptions = commands.registerTextEditorCommand(command, this.execute, this);
    }

    dispose() {
        this._subscriptions && this._subscriptions.dispose();
    }

    abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args): any;
}

const UncommitedRegex = /^[0]+$/;

export class DiffWithPreviousCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithPrevious);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, repoPath?: string, sha?: string, shaUri?: Uri, compareWithSha?: string, compareWithUri?: Uri, line?: number) {
        line = line || editor.selection.active.line;
        if (!sha) {
            return this.git.getBlameForLine(uri.fsPath, line)
                .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', 'getBlameForLine', ex))
                .then(blame => {
                    if (!blame) return;

                    if (UncommitedRegex.test(blame.commit.sha)) {
                        return commands.executeCommand(Commands.DiffWithWorking, uri, blame.commit.repoPath, blame.commit.previousSha, blame.commit.previousUri, line);
                    }
                    return commands.executeCommand(Commands.DiffWithPrevious, uri, blame.commit.repoPath, blame.commit.sha, blame.commit.uri, blame.commit.previousSha, blame.commit.previousUri, line);
                });
        }

        if (!compareWithSha) {
            return window.showInformationMessage(`Commit ${sha} has no previous commit`);
        }

        return Promise.all([this.git.getVersionedFile(shaUri.fsPath, repoPath, sha), this.git.getVersionedFile(compareWithUri.fsPath, repoPath, compareWithSha)])
            .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', 'getVersionedFile', ex))
            .then(values => commands.executeCommand(BuiltInCommands.Diff, Uri.file(values[1]), Uri.file(values[0]), `${path.basename(compareWithUri.fsPath)} (${compareWithSha}) ↔ ${path.basename(shaUri.fsPath)} (${sha})`)
                .then(() => commands.executeCommand(BuiltInCommands.RevealLine, {lineNumber: line, at: 'center'})));
    }
}

export class DiffWithWorkingCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithWorking);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, repoPath?: string, sha?: string, shaUri?: Uri, line?: number) {
        line = line || editor.selection.active.line;
        if (!sha) {
            return this.git.getBlameForLine(uri.fsPath, line)
                .catch(ex => console.error('[GitLens.DiffWithWorkingCommand]', 'getBlameForLine', ex))
                .then(blame => {
                    if (!blame) return;

                    if (UncommitedRegex.test(blame.commit.sha)) {
                        return commands.executeCommand(Commands.DiffWithWorking, uri, blame.commit.repoPath, blame.commit.previousSha, blame.commit.previousUri, line);
                    }
                    return commands.executeCommand(Commands.DiffWithWorking, uri, blame.commit.repoPath, blame.commit.sha, blame.commit.uri, line)
                });
        };

        return this.git.getVersionedFile(shaUri.fsPath, repoPath, sha)
            .catch(ex => console.error('[GitLens.DiffWithWorkingCommand]', 'getVersionedFile', ex))
            .then(compare => commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), uri, `${path.basename(shaUri.fsPath)} (${sha}) ↔ ${path.basename(uri.fsPath)} (index)`)
                .then(() => commands.executeCommand(BuiltInCommands.RevealLine, {lineNumber: line, at: 'center'})));
    }
}

export class ShowBlameCommand extends EditorCommand {
    constructor(private git: GitProvider, private blameController: GitBlameController) {
        super(Commands.ShowBlame);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (sha) {
            return this.blameController.toggleBlame(editor, sha);
        }

        const activeLine = editor.selection.active.line;
        return this.git.getBlameForLine(editor.document.fileName, activeLine)
            .catch(ex => console.error('[GitLens.ShowBlameCommand]', 'getBlameForLine', ex))
            .then(blame => this.blameController.showBlame(editor, blame && blame.commit.sha));
    }
}

export class ShowBlameHistoryCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ShowBlameHistory);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, range?: Range, position?: Position) {
        // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
        if (!uri) {
            const doc = editor.document;
            if (doc) {
                uri = doc.uri;
                range = doc.validateRange(new Range(0, 0, 1000000, 1000000));
                position = doc.validateRange(new Range(0, 0, 0, 1000000)).start;
            }

            if (!uri) return;
        }

        return this.git.getBlameLocations(uri.fsPath, range)
            .catch(ex => console.error('[GitLens.ShowBlameHistoryCommand]', 'getBlameLocations', ex))
            .then(locations => {
                return commands.executeCommand(BuiltInCommands.ShowReferences, uri, position, locations);
            });
    }
}

export class ToggleBlameCommand extends EditorCommand {
    constructor(private git: GitProvider, private blameController: GitBlameController) {
        super(Commands.ToggleBlame);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (sha) {
            return this.blameController.toggleBlame(editor, sha);
        }

        const activeLine = editor.selection.active.line;
        return this.git.getBlameForLine(editor.document.fileName, activeLine)
            .catch(ex => console.error('[GitLens.ToggleBlameCommand]', 'getBlameForLine', ex))
            .then(blame => this.blameController.toggleBlame(editor, blame && blame.commit.sha));
    }
}

export class ToggleCodeLensCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ToggleCodeLens);
    }

    execute(editor: TextEditor, edit: TextEditorEdit) {
        return this.git.toggleCodeLens(editor);
    }
}