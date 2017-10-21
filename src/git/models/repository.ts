'use strict';
import { Functions } from '../../system';
import { Disposable, Event, EventEmitter, RelativePattern, Uri, workspace, WorkspaceFolder } from 'vscode';

export enum RepositoryStorage {
    StatusNode = 'statusNode'
}

export class Repository extends Disposable {

    private _onDidChangeFileSystem = new EventEmitter<Uri | undefined>();
    get onDidChangeFileSystem(): Event<Uri | undefined> {
        return this._onDidChangeFileSystem.event;
    }

    readonly index: number;
    readonly name: string;
    readonly storage: Map<string, any> = new Map();

    private readonly _disposable: Disposable;
    private _fsWatcherDisposable: Disposable | undefined;
    private _pendingChanges: { repo: boolean, fs: boolean } = { repo: false, fs: false };
    private _suspended: boolean;

    constructor(
        private readonly folder: WorkspaceFolder,
        public readonly path: string,
        readonly onRepoChanged: (uri: Uri) => void,
        suspended: boolean
    ) {
        super(() => this.dispose());

        this.index = folder.index;
        this.name = folder.name;
        this._suspended = suspended;

        const watcher = workspace.createFileSystemWatcher(new RelativePattern(folder, '**/.git/{index,HEAD,refs/stash,refs/heads/**,refs/remotes/**}'));
        const subscriptions = [
            watcher,
            watcher.onDidChange(onRepoChanged),
            watcher.onDidCreate(onRepoChanged),
            watcher.onDidDelete(onRepoChanged)
        ];

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this.stopWatchingFileSystem();

        // Clean up any disposables in storage
        for (const item of this.storage.values()) {
            if (item != null && typeof item.dispose === 'function') {
                item.dispose();
            }
        }

        this._disposable && this._disposable.dispose();
    }

    resume() {
        if (!this._suspended) return;

        this._suspended = false;

        // If we've come back into focus and we are dirty, fire the change events
        if (this._pendingChanges.fs) {
            this._pendingChanges.fs = false;
            this._onDidChangeFileSystem.fire();
        }
    }

    startWatchingFileSystem() {
        if (this._fsWatcherDisposable !== undefined) return;

        const debouncedFn = Functions.debounce((uri: Uri) => this._onDidChangeFileSystem.fire(uri), 2500);
        const fn = (uri: Uri) => {
            // Ignore .git changes
            if (/\.git/.test(uri.fsPath)) return;

            if (this._suspended) {
                this._pendingChanges.fs = true;
                return;
            }

            debouncedFn(uri);
        };

        const watcher = workspace.createFileSystemWatcher(new RelativePattern(this.folder, `**`));
        this._fsWatcherDisposable = Disposable.from(
            watcher,
            watcher.onDidChange(fn),
            watcher.onDidCreate(fn),
            watcher.onDidDelete(fn)
        );
    }

    stopWatchingFileSystem() {
        this._fsWatcherDisposable && this._fsWatcherDisposable.dispose();
        this._fsWatcherDisposable = undefined;
    }

    suspend() {
        this._suspended = true;
    }
}
