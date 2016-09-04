'use strict'
import {commands, DecorationOptions, Disposable, OverviewRulerLane, Position, Range, TextEditorDecorationType, Uri, window} from 'vscode';
import {Commands, VsCodeCommands} from './constants';
import GitProvider from './gitProvider';
import GitBlameController from './gitBlameController';
import {basename} from 'path';
import * as moment from 'moment';

abstract class Command extends Disposable {
    private _subscriptions: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._subscriptions = commands.registerCommand(command, this.execute.bind(this));
    }

    dispose() {
        this._subscriptions && this._subscriptions.dispose();
    }

    abstract execute(...args): any;
}

export class BlameCommand extends Command {
    constructor(private git: GitProvider, private blameController: GitBlameController) {
        super(Commands.ShowBlame);
    }

    execute(uri?: Uri, range?: Range, sha?: string) {
        const editor = window.activeTextEditor;
        if (!editor) return;

        if (!range) {
            range = editor.document.validateRange(new Range(0, 0, 1000000, 1000000));
        }

        if (sha) {
            return this.blameController.toggleBlame(editor, sha);
        }

        const activeLine = editor.selection.active.line;
        return this.git.getBlameForLine(editor.document.fileName, activeLine)
            .then(blame => this.blameController.toggleBlame(editor, blame.commit.sha));
    }
}

export class HistoryCommand extends Command {
    constructor(private git: GitProvider) {
        super(Commands.ShowHistory);
    }

    execute(uri?: Uri, range?: Range, position?: Position) {
        // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
        if (!uri) {
            const doc = window.activeTextEditor && window.activeTextEditor.document;
            if (doc) {
                uri = doc.uri;
                range = doc.validateRange(new Range(0, 0, 1000000, 1000000));
                position = doc.validateRange(new Range(0, 0, 0, 1000000)).start;
            }

            if (!uri) return;
        }

        return this.git.getBlameLocations(uri.path, range).then(locations => {
            return commands.executeCommand(VsCodeCommands.ShowReferences, uri, position, locations);
        });
    }
}

export class DiffWithPreviousCommand extends Command {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithPrevious);
    }

    execute(uri?: Uri, sha?: string, compareWithSha?: string) {
        // TODO: Execute these in parallel rather than series
        return this.git.getVersionedFile(uri.path, sha).then(source => {
            this.git.getVersionedFile(uri.path, compareWithSha).then(compare => {
                const fileName = basename(uri.path);
                return commands.executeCommand(VsCodeCommands.Diff, Uri.file(compare), Uri.file(source), `${fileName} (${compareWithSha}) ↔ ${fileName} (${sha})`);
            })
        });
    }
}

export class DiffWithWorkingCommand extends Command {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithWorking);
    }

    execute(uri?: Uri, sha?: string) {
        return this.git.getVersionedFile(uri.path, sha).then(compare => {
            const fileName = basename(uri.path);
            return commands.executeCommand(VsCodeCommands.Diff, Uri.file(compare), uri, `${fileName} (${sha}) ↔ ${fileName} (index)`);
        });
    }
}