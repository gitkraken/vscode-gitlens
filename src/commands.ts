'use strict'
import {commands, DecorationOptions, Disposable, OverviewRulerLane, Position, Range, TextEditor, TextEditorEdit, TextEditorDecorationType, Uri, window} from 'vscode';
import {BuiltInCommands, Commands} from './constants';
import GitProvider from './gitProvider';
import BlameAnnotationController from './blameAnnotationController';
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

export class DiffWithPreviousCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithPrevious);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, repoPath?: string, sha?: string, shaUri?: Uri, compareWithSha?: string, compareWithUri?: Uri, line?: number) {
        line = line || editor.selection.active.line + 1;
        if (!sha || GitProvider.isUncommitted(sha)) {
            if (!(uri instanceof Uri)) {
                if (!editor.document) return;
                uri = editor.document.uri;
            }

            return this.git.getBlameForLine(uri.fsPath, line)
                .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', `getBlameForLine(${line})`, ex))
                .then(blame => {
                    if (!blame) return;

                    // If the line is uncommitted, find the previous commit
                    const commit = blame.commit;
                    if (commit.isUncommitted) {
                        return this.git.getBlameForLine(commit.previousUri.fsPath, blame.line.originalLine + 1, commit.previousSha, commit.repoPath)
                            .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', `getBlameForLine(${blame.line.originalLine}, ${commit.previousSha})`, ex))
                            .then(prevBlame => {
                                if (!prevBlame) return;

                                const prevCommit = prevBlame.commit;
                                return commands.executeCommand(Commands.DiffWithPrevious, commit.previousUri, commit.repoPath, commit.previousSha, commit.previousUri, prevCommit.sha, prevCommit.uri, blame.line.originalLine);
                            });
                    }
                    return commands.executeCommand(Commands.DiffWithPrevious, commit.uri, commit.repoPath, commit.sha, commit.uri, commit.previousSha, commit.previousUri, line);
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
        line = line || editor.selection.active.line + 1;
        if (!sha || GitProvider.isUncommitted(sha)) {
            if (!(uri instanceof Uri)) {
                if (!editor.document) return;
                uri = editor.document.uri;
            }

            return this.git.getBlameForLine(uri.fsPath, line)
                .catch(ex => console.error('[GitLens.DiffWithWorkingCommand]', `getBlameForLine(${line})`, ex))
                .then(blame => {
                    if (!blame) return;

                    const commit = blame.commit;
                    // If the line is uncommitted, find the previous commit
                    if (commit.isUncommitted) {
                        return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit.repoPath, commit.previousSha, commit.previousUri, blame.line.line + 1);
                    }
                    return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit.repoPath, commit.sha, commit.uri, line)
                });
        };

        return this.git.getVersionedFile(shaUri.fsPath, repoPath, sha)
            .catch(ex => console.error('[GitLens.DiffWithWorkingCommand]', 'getVersionedFile', ex))
            .then(compare => commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), uri, `${path.basename(shaUri.fsPath)} (${sha}) ↔ ${path.basename(uri.fsPath)}`)
                .then(() => commands.executeCommand(BuiltInCommands.RevealLine, {lineNumber: line, at: 'center'})));
    }
}

export class ShowBlameCommand extends EditorCommand {
    constructor(private git: GitProvider, private annotationController: BlameAnnotationController) {
        super(Commands.ShowBlame);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (sha) {
            return this.annotationController.toggleBlameAnnotation(editor, sha);
        }

        if (!(uri instanceof Uri)) {
            if (!editor.document) return;
            uri = editor.document.uri;
        }

        return this.git.getBlameForLine(uri.fsPath, editor.selection.active.line)
            .catch(ex => console.error('[GitLens.ShowBlameCommand]', `getBlameForLine(${editor.selection.active.line})`, ex))
            .then(blame => this.annotationController.showBlameAnnotation(editor, blame && blame.commit.sha));
    }
}

export class ShowBlameHistoryCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ShowBlameHistory);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, range?: Range, position?: Position) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return;
            uri = editor.document.uri;

            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            range = editor.document.validateRange(new Range(0, 0, 1000000, 1000000));
            position = editor.document.validateRange(new Range(0, 0, 0, 1000000)).start;
        }

        return this.git.getBlameLocations(uri.fsPath, range)
            .catch(ex => console.error('[GitLens.ShowBlameHistoryCommand]', 'getBlameLocations', ex))
            .then(locations => commands.executeCommand(BuiltInCommands.ShowReferences, uri, position, locations));
    }
}

export class ToggleBlameCommand extends EditorCommand {
    constructor(private git: GitProvider, private blameController: BlameAnnotationController) {
        super(Commands.ToggleBlame);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (sha) {
            return this.blameController.toggleBlameAnnotation(editor, sha);
        }

        if (!(uri instanceof Uri)) {
            if (!editor.document) return;
            uri = editor.document.uri;
        }

        return this.git.getBlameForLine(uri.fsPath, editor.selection.active.line)
            .catch(ex => console.error('[GitLens.ToggleBlameCommand]', `getBlameForLine(${editor.selection.active.line})`, ex))
            .then(blame => this.blameController.toggleBlameAnnotation(editor, blame && blame.commit.sha));
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