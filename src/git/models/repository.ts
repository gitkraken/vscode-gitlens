'use strict';
import * as fs from 'fs';
import * as paths from 'path';
import {
    commands,
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    ProgressLocation,
    RelativePattern,
    Uri,
    window,
    workspace,
    WorkspaceFolder
} from 'vscode';
import { configuration, RemotesConfig } from '../../configuration';
import { StarredRepositories, WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { Functions, gate, log } from '../../system';
import { GitBranch, GitContributor, GitDiffShortStat, GitRemote, GitStash, GitStatus, GitTag } from '../git';
import { GitUri } from '../gitUri';
import { RemoteProviderFactory, RemoteProviders } from '../remotes/factory';

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

    constructor(public readonly repository?: Repository) {}

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
    readonly id: string;
    readonly index: number;
    readonly name: string;
    readonly normalizedPath: string;
    readonly supportsChangeEvents: boolean = true;

    private _branch: Promise<GitBranch | undefined> | undefined;
    private readonly _disposable: Disposable;
    private _fireChangeDebounced: ((e: RepositoryChangeEvent) => void) | undefined = undefined;
    private _fireFileSystemChangeDebounced: ((e: RepositoryFileSystemChangeEvent) => void) | undefined = undefined;
    private _fsWatchCounter = 0;
    private _fsWatcherDisposable: Disposable | undefined;
    private _pendingChanges: { repo?: RepositoryChangeEvent; fs?: RepositoryFileSystemChangeEvent } = {};
    private _providers: RemoteProviders | undefined;
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
        const relativePath = paths.relative(folder.uri.fsPath, path);
        if (root) {
            // Check if the repository is not contained by a workspace folder
            const repoFolder = workspace.getWorkspaceFolder(GitUri.fromRepoPath(path));
            if (repoFolder === undefined) {
                // If it isn't within a workspace folder we can't get change events, see: https://github.com/Microsoft/vscode/issues/3025
                this.supportsChangeEvents = false;
                this.formattedName = this.name = paths.basename(path);
            }
            else {
                this.formattedName = this.name = folder.name;
            }
        }
        else {
            this.formattedName = relativePath ? `${folder.name} (${relativePath})` : folder.name;
            this.name = folder.name;
        }
        this.index = folder.index;

        this.normalizedPath = (path.endsWith('/') ? path : `${path}/`).toLowerCase();
        this.id = this.normalizedPath;

        this._suspended = suspended;
        this._closed = closed;

        // TODO: createFileSystemWatcher doesn't work unless the folder is part of the workspaceFolders
        // https://github.com/Microsoft/vscode/issues/3025
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
        const section = configuration.name('remotes').value;
        if (configuration.changed(e, section, this.folder.uri)) {
            this._providers = RemoteProviderFactory.loadProviders(
                configuration.get<RemotesConfig[] | null | undefined>(section, this.folder.uri)
            );

            if (!configuration.initializing(e)) {
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

    containsUri(uri: Uri) {
        if (GitUri.is(uri)) {
            uri = uri.repoPath !== undefined ? GitUri.file(uri.repoPath) : uri.documentUri();
        }

        return this.folder === workspace.getWorkspaceFolder(uri);
    }

    @gate()
    @log()
    async fetch(options: { progress?: boolean; remote?: string } = {}) {
        const { progress, ...opts } = { progress: true, ...options };
        if (!progress) return this.fetchCore(opts);

        return void (await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Fetching ${opts.remote ? `${opts.remote} of ` : ''}${this.formattedName}...`
            },
            () => this.fetchCore(opts)
        ));
    }

    private async fetchCore(options: { remote?: string } = {}) {
        void (await Container.git.fetch(this.path, options.remote));

        this.fireChange(RepositoryChange.Repository);
    }

    getBranch(): Promise<GitBranch | undefined> {
        if (this._branch === undefined || !this.supportsChangeEvents) {
            this._branch = Container.git.getBranch(this.path);
        }
        return this._branch;
    }

    getBranches(options: { filter?: (b: GitBranch) => boolean; sort?: boolean } = {}): Promise<GitBranch[]> {
        return Container.git.getBranches(this.path, options);
    }

    getChangedFilesCount(sha?: string): Promise<GitDiffShortStat | undefined> {
        return Container.git.getChangedFilesCount(this.path, sha);
    }

    getContributors(): Promise<GitContributor[]> {
        return Container.git.getContributors(this.path);
    }

    async getLastFetched(): Promise<number> {
        const hasRemotes = await this.hasRemotes();
        if (!hasRemotes || Container.vsls.isMaybeGuest) return 0;

        return new Promise<number>((resolve, reject) =>
            fs.stat(paths.join(this.path, '.git/FETCH_HEAD'), (err, stat) => resolve(err ? 0 : stat.mtime.getTime()))
        );
    }

    getRemotes(options: { sort?: boolean } = {}): Promise<GitRemote[]> {
        if (this._remotes === undefined || !this.supportsChangeEvents) {
            if (this._providers === undefined) {
                const remotesCfg = configuration.get<RemotesConfig[] | null | undefined>(
                    configuration.name('remotes').value,
                    this.folder.uri
                );
                this._providers = RemoteProviderFactory.loadProviders(remotesCfg);
            }

            // Since we are caching the results, always sort
            this._remotes = Container.git.getRemotesCore(this.path, this._providers, { sort: true });
        }

        return this._remotes;
    }

    getStashList(): Promise<GitStash | undefined> {
        return Container.git.getStashList(this.path);
    }

    getStatus(): Promise<GitStatus | undefined> {
        return Container.git.getStatusForRepo(this.path);
    }

    getTags(options?: { filter?: (t: GitTag) => boolean; includeRefs?: boolean; sort?: boolean }): Promise<GitTag[]> {
        return Container.git.getTags(this.path, options);
    }

    async hasRemotes(): Promise<boolean> {
        const remotes = await this.getRemotes();
        return remotes !== undefined && remotes.length > 0;
    }

    async hasTrackingBranch(): Promise<boolean> {
        const branch = await this.getBranch();
        return branch !== undefined && branch.tracking !== undefined;
    }

    @gate()
    @log()
    async pull(options: { progress?: boolean } = {}) {
        const { progress } = { progress: true, ...options };
        if (!progress) return this.pullCore();

        return void (await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Pulling ${this.formattedName}...`
            },
            () => this.pullCore()
        ));
    }

    private async pullCore() {
        const tracking = await this.hasTrackingBranch();
        if (tracking) {
            void (await commands.executeCommand('git.pull', this.path));
        }
        else if (configuration.getAny<boolean>('git.fetchOnPull', Uri.file(this.path))) {
            void (await Container.git.fetch(this.path));
        }

        this.fireChange(RepositoryChange.Repository);
    }

    @gate()
    @log()
    async push(options: { force?: boolean; progress?: boolean } = {}) {
        const { force, progress } = { progress: true, ...options };
        if (!progress) return this.pushCore(force);

        return void (await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Pushing ${this.formattedName}...`
            },
            () => this.pushCore(force)
        ));
    }

    private async pushCore(force: boolean = false) {
        void (await commands.executeCommand(force ? 'git.pushForce' : 'git.push', this.path));

        this.fireChange(RepositoryChange.Repository);
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

    get starred() {
        const starred = Container.context.workspaceState.get<StarredRepositories>(WorkspaceState.StarredRepositories);
        return starred !== undefined && starred[this.id] === true;
    }

    star() {
        return this.updateStarred(true);
    }

    unstar() {
        return this.updateStarred(false);
    }

    private async updateStarred(star: boolean) {
        let starred = Container.context.workspaceState.get<StarredRepositories>(WorkspaceState.StarredRepositories);
        if (starred === undefined) {
            starred = Object.create(null);
        }

        if (star) {
            starred![this.id] = true;
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [this.id]: _, ...rest } = starred!;
            starred = rest;
        }
        await Container.context.workspaceState.update(WorkspaceState.StarredRepositories, starred);
    }

    startWatchingFileSystem() {
        this._fsWatchCounter++;
        if (this._fsWatcherDisposable !== undefined) return;

        // TODO: createFileSystemWatcher doesn't work unless the folder is part of the workspaceFolders
        // https://github.com/Microsoft/vscode/issues/3025
        const watcher = workspace.createFileSystemWatcher(new RelativePattern(this.folder, '**'));
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
