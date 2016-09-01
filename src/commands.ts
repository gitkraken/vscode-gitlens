'use strict'
import {commands, Disposable, Position, Range, Uri, window} from 'vscode';
import {Commands, VsCodeCommands} from './constants';
import GitProvider from './gitProvider';
import {basename} from 'path';

abstract class Command extends Disposable {
    private _subscriptions: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._subscriptions = commands.registerCommand(command, this.execute.bind(this));
    }

    dispose() {
        this._subscriptions && this._subscriptions.dispose();
        super.dispose();
    }

    abstract execute(...args): any;
}

export class BlameCommand extends Command {
    constructor(private git: GitProvider) {
        super(Commands.ShowBlameHistory);
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
                return commands.executeCommand(VsCodeCommands.Diff, Uri.file(source), Uri.file(compare), `${fileName} (${sha}) ↔ ${fileName} (${compareWithSha})`);
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
            return commands.executeCommand(VsCodeCommands.Diff, uri, Uri.file(compare), `${fileName} (index) ↔ ${fileName} (${sha})`);
        });
    }
}