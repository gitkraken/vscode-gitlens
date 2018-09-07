'use strict';
import * as _path from 'path';
import {
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    RelativePattern,
    Uri,
    workspace,
    WorkspaceFolder
} from 'vscode';
import { configuration, IRemotesConfig } from '../../configuration';
import { Container } from '../../container';
import { Functions } from '../../system';
import { GitBranch, GitDiffShortStat, GitRemote, GitStash, GitStatus, GitTag } from '../git';
import { GitUri } from '../gitUri';
import { RemoteProviderFactory, RemoteProviderMap } from '../remotes/factory';

export enum RepositoryChange {
    Config = 'config',
    Closed = 'closed',
    // FileSystem = 'file-system',
    Remotes = 'remotes',
    Repository = 'repository',
    Stashes = 'stashes',
    Tags = 'tags'
}

export class RepositoryChangeEvent {
    readonly changes: RepositoryChange[] = [];

    constructor(
        public readonly repository?: Repository
    ) {}

    changed(change: RepositoryChange, solely: boolean = false) {
        if (solely) return this.changes.length === 1 && this.changes[0] === change;

        return this.changes.includes(change);

        // const changed = this.changes.includes(change);
        // if (changed) return true;

        // if (change === RepositoryChange.Repository) {
        //     return this.changes.includes(RepositoryChange.Stashes);
        // }

        // return false;
    }
}

export interface RepositoryFileSystemChangeEvent {
    readonly repository?: Repository;
    readonly uris: Uri[];
}

export enum RepositoryStorage {
    StatusNode = 'statusNode'
}

export class Repository implements Disposable {
    private _onDidChange = new EventEmitter<RepositoryChangeEvent>();
    get onDidChange(): Event<RepositoryChangeEvent> {
        return this._onDidChange.event;
    }

    private _onDidChangeFileSystem = new EventEmitter<RepositoryFileSystemChangeEvent>();
    get onDidChangeFileSystem(): Event<RepositoryFileSystemChangeEvent> {
        return this._onDidChangeFileSystem.event;
    }

    readonly formattedName: string;
    readonly index: number;
    readonly name: string;
    readonly normalizedPath: string;
    // readonly storage: Map<string, any> = new Map();

    private _branch: Promise<GitBranch | undefined> | undefined;
    private readonly _disposable: Disposable;
    private _fireChangeDebounced: ((e: RepositoryChangeEvent) => void) | undefined = undefined;
    private _fireFileSystemChangeDebounced: ((e: RepositoryFileSystemChangeEvent) => void) | undefined = undefined;
    private _fsWatchCounter = 0;
    private _fsWatcherDisposable: Disposable | undefined;
    private _pendingChanges: { repo?: RepositoryChangeEvent; fs?: RepositoryFileSystemChangeEvent } = {};
    private _providerMap: RemoteProviderMap | undefined;
    private _remotes: Promise<GitRemote[]> | undefined;
    private _suspended: boolean;

    constructor(
        public readonly folder: WorkspaceFolder,
        public readonly path: string,
        public readonly root: boolean,
        private readonly onAnyRepositoryChanged: (repo: Repository, reason: RepositoryChange) => void,
        suspended: boolean,
        closed: boolean = false
    ) {
        if (root) {
            this.formattedName = folder.name;
        }
        else {
            const relativePath = _path.relative(folder.uri.fsPath, path);
            this.formattedName = relativePath ? `${folder.name} (${relativePath})` : folder.name;
        }
        this.index = folder.index;
        this.name = folder.name;

        this.normalizedPath = (this.path.endsWith('/') ? this.path : `${this.path}/`).toLowerCase();

        this._suspended = suspended;
        this._closed = closed;

        // TODO: createFileSystemWatcher doesn't work unless the folder is part of the workspaceFolders
        const watcher = workspace.createFileSystemWatcher(
            new RelativePattern(
                folder,
                '{\
**/.git/config,\
**/.git/index,\
**/.git/HEAD,\
**/.git/refs/stash,\
**/.git/refs/heads/**,\
**/.git/refs/remotes/**,\
**/.git/refs/tags/**,\
**/.gitignore\
}'
            )
        );
        this._disposable = Disposable.from(
            watcher,
            watcher.onDidChange(this.onRepositoryChanged, this),
            watcher.onDidCreate(this.onRepositoryChanged, this),
            watcher.onDidDelete(this.onRepositoryChanged, this),
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this.stopWatchingFileSystem();

        // // Clean up any disposables in storage
        // for (const item of this.storage.values()) {
        //     if (item != null && typeof item.dispose === 'function') {
        //         item.dispose();
        //     }
        // }

        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const section = configuration.name('remotes').value;
        if (initializing || configuration.changed(e, section, this.folder.uri)) {
            this._providerMap = RemoteProviderFactory.createMap(
                configuration.get<IRemotesConfig[] | null | undefined>(section, this.folder.uri)
            );

            if (!initializing) {
                this._remotes = undefined;
                this.fireChange(RepositoryChange.Remotes);
            }
        }
    }

    private onFileSystemChanged(uri: Uri) {
        // Ignore .git changes
        if (/\.git(?:\/|\\|$)/.test(uri.fsPath)) return;

        this.fireFileSystemChange(uri);
    }

    private onRepositoryChanged(uri: Uri) {
        if (uri !== undefined && uri.path.endsWith('refs/stash')) {
            this.fireChange(RepositoryChange.Stashes);

            return;
        }

        this._branch = undefined;

        if (uri !== undefined && uri.path.endsWith('refs/remotes')) {
            this._remotes = undefined;
            this.fireChange(RepositoryChange.Remotes);

            return;
        }

        if (uri !== undefined && uri.path.endsWith('refs/tags')) {
            this.fireChange(RepositoryChange.Tags);

            return;
        }

        if (uri !== undefined && uri.path.endsWith('config')) {
            this._remotes = undefined;
            this.fireChange(RepositoryChange.Config, RepositoryChange.Remotes);

            return;
        }

        this.onAnyRepositoryChanged(this, RepositoryChange.Repository);
        this.fireChange(RepositoryChange.Repository);
    }

    private _closed: boolean = false;
    get closed(): boolean {
        return this._closed;
    }
    set closed(value: boolean) {
        const changed = this._closed !== value;
        this._closed = value;
        if (changed) {
            this.onAnyRepositoryChanged(this, RepositoryChange.Closed);
            this.fireChange(RepositoryChange.Closed);
        }
    }

    // containsUri(uri: Uri) {
    //     if (uri instanceof GitUri) {
    //         uri = uri.repoPath !== undefined ? Uri.file(uri.repoPath) : uri.documentUri();
    //     }

    //     return this.folder === workspace.getWorkspaceFolder(uri);
    // }

    getBranch(): Promise<GitBranch | undefined> {
        if (this._branch === undefined) {
            this._branch = Container.git.getBranch(this.path);
        }
        return this._branch;
    }

    getBranches(): Promise<GitBranch[]> {
        return Container.git.getBranches(this.path);
    }

    getChangedFilesCount(sha?: string): Promise<GitDiffShortStat | undefined> {
        return Container.git.getChangedFilesCount(this.path, sha);
    }

    getRemotes(): Promise<GitRemote[]> {
        if (this._remotes === undefined) {
            if (this._providerMap === undefined) {
                const remotesCfg = configuration.get<IRemotesConfig[] | null | undefined>(
                    configuration.name('remotes').value,
                    this.folder.uri
                );
                this._providerMap = RemoteProviderFactory.createMap(remotesCfg);
            }

            this._remotes = Container.git.getRemotesCore(this.path, this._providerMap);
        }

        return this._remotes;
    }

    getStashList(): Promise<GitStash | undefined> {
        return Container.git.getStashList(this.path);
    }

    getStatus(): Promise<GitStatus | undefined> {
        return Container.git.getStatusForRepo(this.path);
    }

    getTags(): Promise<GitTag[]> {
        return Container.git.getTags(this.path);
    }

    async hasRemotes(): Promise<boolean> {
        const remotes = await this.getRemotes();
        return remotes !== undefined && remotes.length > 0;
    }

    async hasTrackingBranch(): Promise<boolean> {
        const branch = await this.getBranch();
        return branch !== undefined && branch.tracking !== undefined;
    }

    resume() {
        if (!this._suspended) return;

        this._suspended = false;

        // If we've come back into focus and we are dirty, fire the change events

        if (this._pendingChanges.repo !== undefined) {
            this._fireChangeDebounced!(this._pendingChanges.repo);
        }

        if (this._pendingChanges.fs !== undefined) {
            this._fireFileSystemChangeDebounced!(this._pendingChanges.fs);
        }
    }

    startWatchingFileSystem() {
        this._fsWatchCounter++;
        if (this._fsWatcherDisposable !== undefined) return;

        // TODO: createFileSystemWatcher doesn't work unless the folder is part of the workspaceFolders
        const watcher = workspace.createFileSystemWatcher(new RelativePattern(this.folder, `**`));
        this._fsWatcherDisposable = Disposable.from(
            watcher,
            watcher.onDidChange(this.onFileSystemChanged, this),
            watcher.onDidCreate(this.onFileSystemChanged, this),
            watcher.onDidDelete(this.onFileSystemChanged, this)
        );
    }

    stopWatchingFileSystem() {
        if (this._fsWatcherDisposable === undefined) return;
        if (--this._fsWatchCounter > 0) return;

        this._fsWatcherDisposable.dispose();
        this._fsWatcherDisposable = undefined;
    }

    suspend() {
        this._suspended = true;
    }

    private fireChange(...reasons: RepositoryChange[]) {
        if (this._fireChangeDebounced === undefined) {
            this._fireChangeDebounced = Functions.debounce(this.fireChangeCore, 250);
        }

        if (this._pendingChanges.repo === undefined) {
            this._pendingChanges.repo = new RepositoryChangeEvent(this);
        }

        const e = this._pendingChanges.repo;

        for (const reason of reasons) {
            if (!e.changes.includes(reason)) {
                e.changes.push(reason);
            }
        }

        if (this._suspended) return;

        this._fireChangeDebounced(e);
    }

    private fireChangeCore(e: RepositoryChangeEvent) {
        this._pendingChanges.repo = undefined;

        this._onDidChange.fire(e);
    }

    private fireFileSystemChange(uri: Uri) {
        if (this._fireFileSystemChangeDebounced === undefined) {
            this._fireFileSystemChangeDebounced = Functions.debounce(this.fireFileSystemChangeCore, 2500);
        }

        if (this._pendingChanges.fs === undefined) {
            this._pendingChanges.fs = { repository: this, uris: [] };
        }

        const e = this._pendingChanges.fs;
        e.uris.push(uri);

        if (this._suspended) return;

        this._fireFileSystemChangeDebounced(e);
    }

    private fireFileSystemChangeCore(e: RepositoryFileSystemChangeEvent) {
        this._pendingChanges.fs = undefined;

        this._onDidChangeFileSystem.fire(e);
    }
}
