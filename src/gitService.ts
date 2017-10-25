'use strict';
import { Functions, Iterables, Objects } from './system';
import { Disposable, Event, EventEmitter, Range, TextDocument, TextDocumentChangeEvent, TextEditor, Uri, window, WindowState, workspace, WorkspaceFoldersChangeEvent } from 'vscode';
import { IConfig } from './configuration';
import { CommandContext, DocumentSchemes, ExtensionKey, setCommandContext } from './constants';
import { RemoteProviderFactory } from './git/remotes/factory';
import { Git, GitAuthor, GitBlame, GitBlameCommit, GitBlameLine, GitBlameLines, GitBlameParser, GitBranch, GitBranchParser, GitCommit, GitCommitType, GitDiff, GitDiffChunkLine, GitDiffParser, GitDiffShortStat, GitLog, GitLogCommit, GitLogParser, GitRemote, GitRemoteParser, GitStash, GitStashParser, GitStatus, GitStatusFile, GitStatusParser, IGit, Repository, setDefaultEncoding } from './git/git';
import { GitUri, IGitCommitInfo, IGitUriData } from './git/gitUri';
import { Logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

export { GitUri, IGitCommitInfo };
export * from './git/models/models';
export * from './git/formatters/commit';
export * from './git/formatters/status';
export { getNameFromRemoteResource, RemoteProvider, RemoteResource, RemoteResourceType } from './git/remotes/provider';
export { RemoteProviderFactory } from './git/remotes/factory';
export * from './git/gitContextTracker';

class UriCacheEntry {

    constructor(public readonly uri: GitUri) { }
}

class GitCacheEntry {

    private cache: Map<string, CachedBlame | CachedDiff | CachedLog> = new Map();

    constructor(public readonly key: string) { }

    get hasErrors(): boolean {
        return Iterables.every(this.cache.values(), entry => entry.errorMessage !== undefined);
    }

    get<T extends CachedBlame | CachedDiff | CachedLog>(key: string): T | undefined {
        return this.cache.get(key) as T;
    }

    set<T extends CachedBlame | CachedDiff | CachedLog>(key: string, value: T) {
        this.cache.set(key, value);
    }
}

interface CachedItem<T> {
    item: Promise<T>;
    errorMessage?: string;
}

interface CachedBlame extends CachedItem<GitBlame> { }
interface CachedDiff extends CachedItem<GitDiff> { }
interface CachedLog extends CachedItem<GitLog> { }

enum RemoveCacheReason {
    DocumentChanged,
    DocumentClosed
}

export enum GitRepoSearchBy {
    Author = 'author',
    Changes = 'changes',
    ChangesOccurrences = 'changes-occurrences',
    Files = 'files',
    Message = 'message',
    Sha = 'sha'
}

export enum RepoChangedReasons {
    CacheReset = 'cache-reset',
    Remotes = 'remotes',
    Repositories = 'Repositories',
    Stash = 'stash',
    Unknown = ''
}

export class GitService extends Disposable {

    static emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
    static fakeSha = 'ffffffffffffffffffffffffffffffffffffffff';
    static uncommittedSha = '0000000000000000000000000000000000000000';

    config: IConfig;

    private _onDidBlameFail = new EventEmitter<string>();
    get onDidBlameFail(): Event<string> {
        return this._onDidBlameFail.event;
    }

    // TODO: Support multi-root { repo, reasons }[]?
    private _onDidChangeRepo = new EventEmitter<RepoChangedReasons[]>();
    get onDidChangeRepo(): Event<RepoChangedReasons[]> {
        return this._onDidChangeRepo.event;
    }

    private _cacheDisposable: Disposable | undefined;
    private _disposable: Disposable | undefined;
    private _documentKeyMap: Map<TextDocument, string>;
    private _gitCache: Map<string, GitCacheEntry>;
    private _pendingChanges: { repo: boolean } = { repo: false };
    private _remotesCache: Map<string, GitRemote[]>;
    private _repositories: Map<string, Repository | undefined>;
    private _repositoriesPromise: Promise<void> | undefined;
    private _suspended: boolean = false;
    private _trackedCache: Map<string, boolean | Promise<boolean>>;
    private _versionedUriCache: Map<string, UriCacheEntry>;

    constructor() {
        super(() => this.dispose());

        this._documentKeyMap = new Map();
        this._gitCache = new Map();
        this._remotesCache = new Map();
        this._repositories = new Map();
        this._trackedCache = new Map();
        this._versionedUriCache = new Map();

        this.onConfigurationChanged();
        this._repositoriesPromise = this.onWorkspaceFoldersChanged();

        const subscriptions: Disposable[] = [
            window.onDidChangeWindowState(this.onWindowStateChanged, this),
            workspace.onDidChangeConfiguration(this.onConfigurationChanged, this),
            workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this),
            RemoteProviderFactory.onDidChange(this.onRemoteProviderChanged, this)
        ];
        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._repositories.forEach(r => r && r.dispose());

        this._disposable && this._disposable.dispose();

        this._cacheDisposable && this._cacheDisposable.dispose();
        this._cacheDisposable = undefined;

        this._documentKeyMap.clear();
        this._gitCache.clear();
        this._remotesCache.clear();
        this._trackedCache.clear();
        this._versionedUriCache.clear();
    }

    public get repoPath(): string | undefined {
        if (this._repositories.size !== 1) return undefined;

        const repo = Iterables.first(this._repositories.values());
        return repo === undefined ? undefined : repo.path;
    }

    public get UseCaching() {
        return this.config.advanced.caching.enabled;
    }

    private onConfigurationChanged() {
        const encoding = workspace.getConfiguration('files').get<string>('encoding', 'utf8');
        setDefaultEncoding(encoding);

        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        if (!Objects.areEquivalent(cfg.advanced, this.config && this.config.advanced)) {
            if (cfg.advanced.caching.enabled) {
                this._cacheDisposable && this._cacheDisposable.dispose();

                const subscriptions: Disposable[] = [
                    workspace.onDidChangeTextDocument(Functions.debounce(this.onTextDocumentChanged, 50), this),
                    workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this)
                ];
                this._cacheDisposable = Disposable.from(...subscriptions);
            }
            else {
                this._cacheDisposable && this._cacheDisposable.dispose();
                this._cacheDisposable = undefined;

                this._documentKeyMap.clear();
                this._gitCache.clear();
            }
        }

        // Only count the change if we aren't just starting up
        const ignoreWhitespace = this.config === undefined
            ? cfg.blame.ignoreWhitespace
            : this.config.blame.ignoreWhitespace;

        this.config = cfg;

        if (this.config.blame.ignoreWhitespace !== ignoreWhitespace) {
            this._gitCache.clear();
            this.fireRepoChange(RepoChangedReasons.CacheReset);
        }
    }

    private onRemoteProviderChanged() {
        this._remotesCache.clear();
        this.fireRepoChange(RepoChangedReasons.Remotes);
    }

    private onWindowStateChanged(e: WindowState) {
        if (e.focused) {
            this._repositories.forEach(r => r && r.resume());
        }
        else {
            this._repositories.forEach(r => r && r.suspend());
        }

        const suspended = !e.focused;
        const changed = suspended !== this._suspended;
        this._suspended = suspended;

        if (suspended || !changed) return;

        // If we've come back into focus and we are dirty, fire the change events
        if (this._pendingChanges.repo) {
            this._pendingChanges.repo = false;
            this._fireRepoChangeDebounced!();
        }
    }

    private async onWorkspaceFoldersChanged(e?: WorkspaceFoldersChangeEvent) {
        let initializing = false;
        if (e === undefined) {
            initializing = true;
            e = {
                added: workspace.workspaceFolders || [],
                removed: []
            } as WorkspaceFoldersChangeEvent;
        }

        for (const f of e.added) {
            if (f.uri.scheme !== DocumentSchemes.File) continue;

            const fsPath = f.uri.fsPath;
            const rp = await this.getRepoPathCore(fsPath, true);
            if (rp === undefined) {
                Logger.log(`onWorkspaceFoldersChanged(${fsPath})`, 'No repository found');
                this._repositories.set(fsPath, undefined);
            }
            else {
                this._repositories.set(fsPath, new Repository(f, rp, this.onRepoChanged.bind(this), this._suspended));
            }
        }

        for (const f of e.removed) {
            if (f.uri.scheme !== DocumentSchemes.File) continue;

            const repo = this._repositories.get(f.uri.fsPath);
            if (repo !== undefined) {
                repo.dispose();
            }

            this._repositories.delete(f.uri.fsPath);
        }

        const hasRepository = Iterables.some(this._repositories.values(), rp => rp !== undefined);
        await setCommandContext(CommandContext.HasRepository, hasRepository);

        if (!initializing) {
            this.fireRepoChange(RepoChangedReasons.Repositories);
        }
    }

    private onTextDocumentChanged(e: TextDocumentChangeEvent) {
        let key = this._documentKeyMap.get(e.document);
        if (key === undefined) {
            key = this.getCacheEntryKey(e.document.uri);
            this._documentKeyMap.set(e.document, key);
        }

        // Don't remove broken blame on change (since otherwise we'll have to run the broken blame again)
        const entry = this._gitCache.get(key);
        if (entry === undefined || entry.hasErrors) return;

        if (this._gitCache.delete(key)) {
            Logger.log(`Clear cache entry for '${key}', reason=${RemoveCacheReason[RemoveCacheReason.DocumentChanged]}`);
        }
    }

    private onTextDocumentClosed(document: TextDocument) {
        this._documentKeyMap.delete(document);

        const key = this.getCacheEntryKey(document.uri);
        if (this._gitCache.delete(key)) {
            Logger.log(`Clear cache entry for '${key}', reason=${RemoveCacheReason[RemoveCacheReason.DocumentClosed]}`);
        }
    }

    private onRepoChanged(uri: Uri) {
        if (uri !== undefined && uri.path.endsWith('ref/stash')) {
            this.fireRepoChange(RepoChangedReasons.Stash);

            return;
        }

        this._gitCache.clear();
        this._trackedCache.clear();

        this.fireRepoChange();
    }

    private _fireRepoChangeDebounced: (() => void) | undefined = undefined;
    private _repoChangedReasons: RepoChangedReasons[] = [];

    private fireRepoChange(reason: RepoChangedReasons = RepoChangedReasons.Unknown) {
        if (this._fireRepoChangeDebounced === undefined) {
            this._fireRepoChangeDebounced = Functions.debounce(this.fireRepoChangeCore, 250);
        }

        if (!this._repoChangedReasons.includes(reason)) {
            this._repoChangedReasons.push(reason);
        }

        if (this._suspended) {
            this._pendingChanges.repo = true;
            return;
        }

        return this._fireRepoChangeDebounced();
    }

    private fireRepoChangeCore() {
        const reasons = this._repoChangedReasons;
        this._repoChangedReasons = [];

        this._onDidChangeRepo.fire(reasons);
    }

    public async getRepositories(): Promise<Repository[]> {
        if (this._repositoriesPromise !== undefined) {
            await this._repositoriesPromise;
            this._repositoriesPromise = undefined;
        }

        return [...Iterables.filter(this._repositories.values(), r => r !== undefined) as Iterable<Repository>];
    }

    checkoutFile(uri: GitUri, sha?: string) {
        sha = sha || uri.sha;
        Logger.log(`checkoutFile('${uri.repoPath}', '${uri.fsPath}', ${sha})`);

        return Git.checkout(uri.repoPath!, uri.fsPath, sha!);
    }

    private async fileExists(repoPath: string, fileName: string): Promise<boolean> {
        return await new Promise<boolean>((resolve, reject) => fs.exists(path.resolve(repoPath, fileName), resolve));
    }

    async findNextCommit(repoPath: string, fileName: string, sha?: string): Promise<GitLogCommit | undefined> {
        let log = await this.getLogForFile(repoPath, fileName, sha, { maxCount: 1, reverse: true });
        let commit = log && Iterables.first(log.commits.values());
        if (commit) return commit;

        const nextFileName = await this.findNextFileName(repoPath, fileName, sha);
        if (nextFileName) {
            log = await this.getLogForFile(repoPath, nextFileName, sha, { maxCount: 1, reverse: true });
            commit = log && Iterables.first(log.commits.values());
        }

        return commit;
    }

    async findNextFileName(repoPath: string | undefined, fileName: string, sha?: string): Promise<string | undefined> {
        [fileName, repoPath] = Git.splitPath(fileName, repoPath);

        return (await this.fileExists(repoPath, fileName))
            ? fileName
            : await this.findNextFileNameCore(repoPath, fileName, sha);
    }

    private async findNextFileNameCore(repoPath: string, fileName: string, sha?: string): Promise<string | undefined> {
        if (sha === undefined) {
            // Get the most recent commit for this file name
            const c = await this.getLogCommit(repoPath, fileName);
            if (c === undefined) return undefined;

            sha = c.sha;
        }

        // Get the full commit (so we can see if there are any matching renames in the file statuses)
        const log = await this.getLogForRepo(repoPath, sha, 1);
        if (log === undefined) return undefined;

        const c = Iterables.first(log.commits.values());
        const status = c.fileStatuses.find(f => f.originalFileName === fileName);
        if (status === undefined) return undefined;

        return status.fileName;
    }

    async findWorkingFileName(commit: GitCommit): Promise<string | undefined>;
    async findWorkingFileName(repoPath: string | undefined, fileName: string): Promise<string | undefined>;
    async findWorkingFileName(commitOrRepoPath: GitCommit | string | undefined, fileName?: string): Promise<string | undefined> {
        let repoPath: string | undefined;
        if (commitOrRepoPath === undefined || typeof commitOrRepoPath === 'string') {
            repoPath = commitOrRepoPath;
            if (fileName === undefined) throw new Error('Invalid fileName');

            [fileName] = Git.splitPath(fileName, repoPath);
        }
        else {
            const c = commitOrRepoPath;
            repoPath = c.repoPath;
            if (c.workingFileName && await this.fileExists(repoPath, c.workingFileName)) return c.workingFileName;
            fileName = c.fileName;
        }

        while (true) {
            if (await this.fileExists(repoPath!, fileName)) return fileName;

            fileName = await this.findNextFileNameCore(repoPath!, fileName);
            if (fileName === undefined) return undefined;
        }
    }

    public async getBlameability(uri: GitUri): Promise<boolean> {
        if (!this.UseCaching) return await this.isTracked(uri);

        const cacheKey = this.getCacheEntryKey(uri);
        const entry = this._gitCache.get(cacheKey);
        if (entry === undefined) return await this.isTracked(uri);

        return !entry.hasErrors;
    }

    async getBlameForFile(uri: GitUri): Promise<GitBlame | undefined> {
        let key = 'blame';
        if (uri.sha !== undefined) {
            key += `:${uri.sha}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching) {
            const cacheKey = this.getCacheEntryKey(uri);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedBlame = entry.get<CachedBlame>(key);
                if (cachedBlame !== undefined) {
                    Logger.log(`Cached(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
                    return cachedBlame.item;
                }
            }

            Logger.log(`Not Cached(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
        }

        const promise = this.getBlameForFileCore(uri, entry, key);

        if (entry) {
            Logger.log(`Add blame cache for '${entry.key}:${key}'`);

            entry.set<CachedBlame>(key, {
                item: promise
            } as CachedBlame);
        }

        return promise;
    }

    private async getBlameForFileCore(uri: GitUri, entry: GitCacheEntry | undefined, key: string): Promise<GitBlame | undefined> {
        if (!(await this.isTracked(uri))) {
            Logger.log(`Skipping blame; '${uri.fsPath}' is not tracked`);
            if (entry && entry.key) {
                this._onDidBlameFail.fire(entry.key);
            }
            return await GitService.emptyPromise as GitBlame;
        }

        const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

        try {
            const data = await Git.blame(root, file, uri.sha, { ignoreWhitespace: this.config.blame.ignoreWhitespace });
            const blame = GitBlameParser.parse(data, root, file);
            return blame;
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace blame cache with empty promise for '${entry.key}:${key}'`);

                entry.set<CachedBlame>(key, {
                    item: GitService.emptyPromise,
                    errorMessage: msg
                } as CachedBlame);

                this._onDidBlameFail.fire(entry.key);
                return await GitService.emptyPromise as GitBlame;
            }

            return undefined;
        }
    }

    async getBlameForLine(uri: GitUri, line: number): Promise<GitBlameLine | undefined> {
        Logger.log(`getBlameForLine('${uri.repoPath}', '${uri.fsPath}', ${line}, ${uri.sha})`);

        if (this.UseCaching) {
            const blame = await this.getBlameForFile(uri);
            if (blame === undefined) return undefined;

            let blameLine = blame.lines[line];
            if (blameLine === undefined) {
                if (blame.lines.length !== line) return undefined;
                blameLine = blame.lines[line - 1];
            }

            const commit = blame.commits.get(blameLine.sha);
            if (commit === undefined) return undefined;

            return {
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                line: blameLine
            } as GitBlameLine;
        }

        const fileName = uri.fsPath;

        try {
            const data = await Git.blame(uri.repoPath, fileName, uri.sha, { ignoreWhitespace: this.config.blame.ignoreWhitespace, startLine: line + 1, endLine: line + 1 });
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName);
            if (blame === undefined) return undefined;

            const commit = Iterables.first(blame.commits.values());
            if (uri.repoPath) {
                commit.repoPath = uri.repoPath;
            }
            return {
                author: Iterables.first(blame.authors.values()),
                commit: commit,
                line: blame.lines[line]
            } as GitBlameLine;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined> {
        Logger.log(`getBlameForRange('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        const blame = await this.getBlameForFile(uri);
        if (blame === undefined) return undefined;

        return this.getBlameForRangeSync(blame, uri, range);
    }

    getBlameForRangeSync(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
        Logger.log(`getBlameForRangeSync('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        if (blame.lines.length === 0) return Object.assign({ allLines: blame.lines }, blame);

        if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
            return Object.assign({ allLines: blame.lines }, blame);
        }

        const lines = blame.lines.slice(range.start.line, range.end.line + 1);
        const shas = new Set(lines.map(l => l.sha));

        const authors: Map<string, GitAuthor> = new Map();
        const commits: Map<string, GitBlameCommit> = new Map();
        for (const c of blame.commits.values()) {
            if (!shas.has(c.sha)) continue;

            const commit = new GitBlameCommit(c.repoPath, c.sha, c.fileName, c.author, c.date, c.message,
                c.lines.filter(l => l.line >= range.start.line && l.line <= range.end.line), c.originalFileName, c.previousSha, c.previousFileName);
            commits.set(c.sha, commit);

            let author = authors.get(commit.author);
            if (author === undefined) {
                author = {
                    name: commit.author,
                    lineCount: 0
                };
                authors.set(author.name, author);
            }

            author.lineCount += commit.lines.length;
        }

        const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

        return {
            authors: sortedAuthors,
            commits: commits,
            lines: lines,
            allLines: blame.lines
        } as GitBlameLines;
    }

    async getBranch(repoPath: string | undefined): Promise<GitBranch | undefined> {
        Logger.log(`getBranch('${repoPath}')`);
        if (repoPath === undefined) return undefined;

        const data = await Git.revparse_currentBranch(repoPath);
        const branch = data.split('\n');
        return new GitBranch(repoPath, branch[0], true, branch[1]);
    }

    async getBranches(repoPath: string | undefined): Promise<GitBranch[]> {
        Logger.log(`getBranches('${repoPath}')`);
        if (repoPath === undefined) return [];

        const data = await Git.branch(repoPath, { all: true });
        return GitBranchParser.parse(data, repoPath) || [];
    }

    getCacheEntryKey(fileName: string): string;
    getCacheEntryKey(uri: Uri): string;
    getCacheEntryKey(fileNameOrUri: string | Uri): string {
        return Git.normalizePath(typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath).toLowerCase();
    }

    async getChangedFilesCount(repoPath: string, sha?: string): Promise<GitDiffShortStat | undefined> {
        const data = await Git.diff_shortstat(repoPath, sha);
        return GitDiffParser.parseShortStat(data);
    }

    async getConfig(key: string, repoPath?: string): Promise<string> {
        Logger.log(`getConfig('${key}', '${repoPath}')`);

        return await Git.config_get(key, repoPath);
    }

    getGitUriForFile(uri: Uri) {
        const cacheKey = this.getCacheEntryKey(uri);
        const entry = this._versionedUriCache.get(cacheKey);
        return entry && entry.uri;
    }

    async getDiffForFile(uri: GitUri, sha1?: string, sha2?: string): Promise<GitDiff | undefined> {
        if (sha1 !== undefined && sha2 === undefined && uri.sha !== undefined) {
            sha2 = uri.sha;
        }

        let key = 'diff';
        if (sha1 !== undefined) {
            key += `:${sha1}`;
        }
        if (sha2 !== undefined) {
            key += `:${sha2}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching) {
            const cacheKey = this.getCacheEntryKey(uri);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedDiff = entry.get<CachedDiff>(key);
                if (cachedDiff !== undefined) {
                    Logger.log(`Cached(${key}): getDiffForFile('${uri.repoPath}', '${uri.fsPath}', ${sha1}, ${sha2})`);
                    return cachedDiff.item;
                }
            }

            Logger.log(`Not Cached(${key}): getDiffForFile('${uri.repoPath}', '${uri.fsPath}', ${sha1}, ${sha2})`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getDiffForFile('${uri.repoPath}', '${uri.fsPath}', ${sha1}, ${sha2})`);
        }

        const promise = this.getDiffForFileCore(uri.repoPath, uri.fsPath, sha1, sha2, entry, key);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}:${key}'`);

            entry.set<CachedDiff>(key, {
                item: promise
            } as CachedDiff);
        }

        return promise;
    }

    private async getDiffForFileCore(repoPath: string | undefined, fileName: string, sha1: string | undefined, sha2: string | undefined, entry: GitCacheEntry | undefined, key: string): Promise<GitDiff | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            const data = await Git.diff(root, file, sha1, sha2);
            const diff = GitDiffParser.parse(data);
            return diff;
        }
        catch (ex) {
            // Trap and cache expected diff errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace diff cache with empty promise for '${entry.key}:${key}'`);

                entry.set<CachedDiff>(key, {
                    item: GitService.emptyPromise,
                    errorMessage: msg
                } as CachedDiff);

                return await GitService.emptyPromise as GitDiff;
            }

            return undefined;
        }
    }

    async getDiffForLine(uri: GitUri, line: number, sha1?: string, sha2?: string): Promise<GitDiffChunkLine | undefined> {
        try {
            const diff = await this.getDiffForFile(uri, sha1, sha2);
            if (diff === undefined) return undefined;

            const chunk = diff.chunks.find(c => c.currentPosition.start <= line && c.currentPosition.end >= line);
            if (chunk === undefined) return undefined;

            return chunk.lines[line - chunk.currentPosition.start + 1];
        }
        catch (ex) {
            return undefined;
        }
    }

    async getDiffStatus(repoPath: string, sha1?: string, sha2?: string, options: { filter?: string } = {}): Promise<GitStatusFile[] | undefined> {
        try {
            const data = await Git.diff_nameStatus(repoPath, sha1, sha2, options);
            const diff = GitDiffParser.parseNameStatus(data, repoPath);
            return diff;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogCommit(repoPath: string | undefined, fileName: string, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined>;
    async getLogCommit(repoPath: string | undefined, fileName: string, sha: string | undefined, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined>;
    async getLogCommit(repoPath: string | undefined, fileName: string, shaOrOptions?: string | undefined | { firstIfMissing?: boolean, previous?: boolean }, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined> {
        let sha: string | undefined = undefined;
        if (typeof shaOrOptions === 'string') {
            sha = shaOrOptions;
        }
        else if (options === undefined) {
            options = shaOrOptions;
        }

        options = options || {};

        const log = await this.getLogForFile(repoPath, fileName, sha, { maxCount: options.previous ? 2 : 1 });
        if (log === undefined) return undefined;

        const commit = sha && log.commits.get(sha);
        if (commit === undefined && sha && !options.firstIfMissing) return undefined;

        return commit || Iterables.first(log.commits.values());
    }

    async getLogForRepo(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false): Promise<GitLog | undefined> {
        Logger.log(`getLogForRepo('${repoPath}', ${sha}, ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        try {
            const data = await Git.log(repoPath, sha, maxCount, reverse);
            const log = GitLogParser.parse(data, GitCommitType.Branch, repoPath, undefined, sha, maxCount, reverse, undefined);
            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForRepoSearch(repoPath: string, search: string, searchBy: GitRepoSearchBy, maxCount?: number): Promise<GitLog | undefined> {
        Logger.log(`getLogForRepoSearch('${repoPath}', ${search}, ${searchBy}, ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        let searchArgs: string[] | undefined = undefined;
        switch (searchBy) {
            case GitRepoSearchBy.Author:
                searchArgs = [`--author=${search}`];
                break;
            case GitRepoSearchBy.Changes:
                searchArgs = [`-G${search}`];
                break;
            case GitRepoSearchBy.ChangesOccurrences:
                searchArgs = [`-S${search}`, '--pickaxe-regex'];
                break;
            case GitRepoSearchBy.Files:
                searchArgs = [`--`, `${search}`];
                break;
            case GitRepoSearchBy.Message:
                searchArgs = [`--grep=${search}`];
                break;
            case GitRepoSearchBy.Sha:
                searchArgs = [search];
                maxCount = 1;
                break;
        }

        try {
            const data = await Git.log_search(repoPath, searchArgs, maxCount);
            const log = GitLogParser.parse(data, GitCommitType.Branch, repoPath, undefined, undefined, maxCount, false, undefined);
            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForFile(repoPath: string | undefined, fileName: string, sha?: string, options: { maxCount?: number, range?: Range, reverse?: boolean, skipMerges?: boolean } = {}): Promise<GitLog | undefined> {
        options = { ...{ reverse: false, skipMerges: false }, ...options };

        let key = 'log';
        if (sha !== undefined) {
            key += `:${sha}`;
        }
        if (options.maxCount !== undefined) {
            key += `:n${options.maxCount}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching && options.range === undefined && !options.reverse) {
            const cacheKey = this.getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedLog = entry.get<CachedLog>(key);
                if (cachedLog !== undefined) {
                    Logger.log(`Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                    return cachedLog.item;
                }

                if (key !== 'log') {
                    // Since we are looking for partial log, see if we have the log of the whole file
                    const cachedLog = entry.get<CachedLog>('log');
                    if (cachedLog !== undefined) {
                        if (sha === undefined) {
                            Logger.log(`Cached(~${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                            return cachedLog.item;
                        }

                        Logger.log(`? Cache(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                        const log = await cachedLog.item;
                        if (log !== undefined && log.commits.has(sha)) {
                            Logger.log(`Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);
                            return cachedLog.item;
                        }
                    }
                }
            }

            Logger.log(`Not Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, false)`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, ${options.range && `[${options.range.start.line}, ${options.range.end.line}]`}, ${options.reverse})`);
        }

        const promise = this.getLogForFileCore(repoPath, fileName, sha, options, entry, key);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}:${key}'`);

            entry.set<CachedLog>(key, {
                item: promise
            } as CachedLog);
        }

        return promise;
    }

    private async getLogForFileCore(repoPath: string | undefined, fileName: string, sha: string | undefined, options: { maxCount?: number, range?: Range, reverse?: boolean, skipMerges?: boolean }, entry: GitCacheEntry | undefined, key: string): Promise<GitLog | undefined> {
        if (!(await this.isTracked(fileName, repoPath))) {
            Logger.log(`Skipping log; '${fileName}' is not tracked`);
            return await GitService.emptyPromise as GitLog;
        }

        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            const { range, ...opts } = options;
            const data = await Git.log_file(root, file, sha, { ...opts, ...{ startLine: range && range.start.line + 1, endLine: range && range.end.line + 1 } });
            const log = GitLogParser.parse(data, GitCommitType.File, root, file, sha, options.maxCount, options.reverse!, range);
            return log;
        }
        catch (ex) {
            // Trap and cache expected log errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace log cache with empty promise for '${entry.key}:${key}'`);

                entry.set<CachedLog>(key, {
                    item: GitService.emptyPromise,
                    errorMessage: msg
                } as CachedLog);

                return await GitService.emptyPromise as GitLog;
            }

            return undefined;
        }
    }

    hasRemotes(repoPath: string | undefined): boolean {
        if (repoPath === undefined) return false;

        const remotes = this._remotesCache.get(this.normalizeRepoPath(repoPath));
        return remotes !== undefined && remotes.length > 0;
    }

    private normalizeRepoPath(repoPath: string) {
        return (repoPath.endsWith('/') ? repoPath : `${repoPath}/`).toLowerCase();
    }

    async getRemotes(repoPath: string | undefined): Promise<GitRemote[]> {
        if (!repoPath) return [];

        Logger.log(`getRemotes('${repoPath}')`);

        const normalizedRepoPath = this.normalizeRepoPath(repoPath);

        let remotes = this._remotesCache.get(normalizedRepoPath);
        if (remotes !== undefined) return remotes;

        const data = await Git.remote(repoPath);
        remotes = GitRemoteParser.parse(data, repoPath);

        if (remotes !== undefined) {
            this._remotesCache.set(normalizedRepoPath, remotes);
        }

        return remotes;
    }

    async getRepoPath(filePath: string): Promise<string | undefined>;
    async getRepoPath(uri: Uri | undefined): Promise<string | undefined>;
    async getRepoPath(filePathOrUri: string | Uri | undefined): Promise<string | undefined> {
        if (filePathOrUri === undefined) return this.repoPath;
        if (filePathOrUri instanceof GitUri) return filePathOrUri.repoPath;

        if (typeof filePathOrUri === 'string') return this.getRepoPathCore(filePathOrUri, false);

        const folder = workspace.getWorkspaceFolder(filePathOrUri);
        if (folder !== undefined) {
            if (this._repositoriesPromise !== undefined) {
                await this._repositoriesPromise;
            }

            const rp = this._repositories.get(folder.uri.fsPath);
            if (rp !== undefined) return rp.path;
        }

        return this.getRepoPathCore(filePathOrUri.fsPath, false);
    }

    private getRepoPathCore(filePath: string, isDirectory: boolean): Promise<string | undefined> {
        return Git.revparse_toplevel(isDirectory ? filePath : path.dirname(filePath));
    }

    async getStashList(repoPath: string | undefined): Promise<GitStash | undefined> {
        Logger.log(`getStash('${repoPath}')`);
        if (repoPath === undefined) return undefined;

        const data = await Git.stash_list(repoPath);
        const stash = GitStashParser.parse(data, repoPath);
        return stash;
    }

    async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined> {
        Logger.log(`getStatusForFile('${repoPath}', '${fileName}')`);

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status_file(repoPath, fileName, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        if (status === undefined || !status.files.length) return undefined;

        return status.files[0];
    }

    async getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined> {
        Logger.log(`getStatusForRepo('${repoPath}')`);
        if (repoPath === undefined) return undefined;

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status(repoPath, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        return status;
    }

    async getVersionedFile(repoPath: string | undefined, fileName: string, sha: string) {
        Logger.log(`getVersionedFile('${repoPath}', '${fileName}', ${sha})`);

        const file = await Git.getVersionedFile(repoPath, fileName, sha);
        if (file === undefined) return undefined;

        const cacheKey = this.getCacheEntryKey(file);
        const entry = new UriCacheEntry(new GitUri(Uri.file(fileName), { sha, repoPath: repoPath!, fileName }));
        this._versionedUriCache.set(cacheKey, entry);
        return file;
    }

    getVersionedFileText(repoPath: string, fileName: string, sha: string) {
        Logger.log(`getVersionedFileText('${repoPath}', '${fileName}', ${sha})`);

        return Git.show(repoPath, fileName, sha);
    }

    hasGitUriForFile(editor: TextEditor): boolean {
        if (editor === undefined || editor.document === undefined || editor.document.uri === undefined) return false;

        const cacheKey = this.getCacheEntryKey(editor.document.uri);
        return this._versionedUriCache.has(cacheKey);
    }

    isEditorBlameable(editor: TextEditor): boolean {
        return (editor.viewColumn !== undefined || this.isTrackable(editor.document.uri) || this.hasGitUriForFile(editor));
    }

    async isFileUncommitted(uri: GitUri): Promise<boolean> {
        Logger.log(`isFileUncommitted('${uri.repoPath}', '${uri.fsPath}')`);

        const status = await this.getStatusForFile(uri.repoPath!, uri.fsPath);
        return !!status;
    }

    isTrackable(scheme: string): boolean;
    isTrackable(uri: Uri): boolean;
    isTrackable(schemeOruri: string | Uri): boolean {
        let scheme: string;
        if (typeof schemeOruri === 'string') {
            scheme = schemeOruri;
        }
        else {
            scheme = schemeOruri.scheme;
        }

        return scheme === DocumentSchemes.File || scheme === DocumentSchemes.Git || scheme === DocumentSchemes.GitLensGit;
    }

    async isTracked(fileName: string, repoPath?: string): Promise<boolean>;
    async isTracked(uri: GitUri): Promise<boolean>;
    async isTracked(fileNameOrUri: string | GitUri, repoPath?: string): Promise<boolean> {
        let cacheKey: string;
        let fileName: string;
        if (typeof fileNameOrUri === 'string') {
            [fileName, repoPath] = Git.splitPath(fileNameOrUri, repoPath);
            cacheKey = this.getCacheEntryKey(fileNameOrUri);
        }
        else {
            if (!this.isTrackable(fileNameOrUri)) return false;

            fileName = fileNameOrUri.fsPath;
            repoPath = fileNameOrUri.repoPath;
            cacheKey = this.getCacheEntryKey(fileNameOrUri);
        }

        Logger.log(`isTracked('${fileName}', '${repoPath}')`);

        let tracked = this._trackedCache.get(cacheKey);
        if (tracked !== undefined) {
            if (typeof tracked === 'boolean') return tracked;
            return await tracked;
        }

        tracked = this.isTrackedCore(repoPath === undefined ? '' : repoPath, fileName);
        this._trackedCache.set(cacheKey, tracked);

        tracked = await tracked;
        this._trackedCache.set(cacheKey, tracked);

        return tracked;
    }

    private async isTrackedCore(repoPath: string, fileName: string) {
        const result = await Git.ls_files(repoPath === undefined ? '' : repoPath, fileName);
        return !!result;
    }
    openDiffTool(repoPath: string, uri: Uri, staged: boolean) {
        Logger.log(`openDiffTool('${repoPath}', '${uri}', ${staged})`);

        return Git.difftool_fileDiff(repoPath, uri.fsPath, staged);
    }

    openDirectoryDiff(repoPath: string, sha1: string, sha2?: string) {
        Logger.log(`openDirectoryDiff('${repoPath}', ${sha1}, ${sha2})`);

        return Git.difftool_dirDiff(repoPath, sha1, sha2);
    }

    stopWatchingFileSystem() {
        this._repositories.forEach(r => r && r.stopWatchingFileSystem());
    }

    stashApply(repoPath: string, stashName: string, deleteAfter: boolean = false) {
        Logger.log(`stashApply('${repoPath}', ${stashName}, ${deleteAfter})`);

        return Git.stash_apply(repoPath, stashName, deleteAfter);
    }

    stashDelete(repoPath: string, stashName: string) {
        Logger.log(`stashDelete('${repoPath}', ${stashName}})`);

        return Git.stash_delete(repoPath, stashName);
    }

    stashSave(repoPath: string, message?: string, uris?: Uri[]) {
        Logger.log(`stashSave('${repoPath}', ${message}, ${uris})`);

        if (uris === undefined) return Git.stash_save(repoPath, message);
        const pathspecs = uris.map(u => Git.splitPath(u.fsPath, repoPath)[0]);
        return Git.stash_push(repoPath, pathspecs, message);
    }

    static getGitPath(gitPath?: string): Promise<IGit> {
        return Git.getGitPath(gitPath);
    }

    static getGitVersion(): string {
        return Git.gitInfo().version;
    }

    static fromGitContentUri(uri: Uri): IGitUriData {
        if (uri.scheme !== DocumentSchemes.GitLensGit) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        return GitService.fromGitContentUriCore<IGitUriData>(uri);
    }

    private static fromGitContentUriCore<T extends IGitUriData>(uri: Uri): T {
        return JSON.parse(uri.query) as T;
    }

    static isSha(sha: string): boolean {
        return Git.isSha(sha);
    }

    static isUncommitted(sha: string): boolean {
        return Git.isUncommitted(sha);
    }

    static normalizePath(fileName: string): string {
        return Git.normalizePath(fileName);
    }

    static shortenSha(sha: string | undefined) {
        if (sha === undefined) return undefined;
        return Git.shortenSha(sha);
    }

    static toGitContentUri(sha: string, fileName: string, repoPath: string, originalFileName?: string): Uri;
    static toGitContentUri(commit: GitCommit): Uri;
    static toGitContentUri(uri: GitUri): Uri;
    static toGitContentUri(shaOrcommitOrUri: string | GitCommit | GitUri, fileName?: string, repoPath?: string, originalFileName?: string): Uri {
        let data: IGitUriData;
        let shortSha: string | undefined;
        if (typeof shaOrcommitOrUri === 'string') {
            data = GitService.toGitUriData({
                sha: shaOrcommitOrUri,
                fileName: fileName!,
                repoPath: repoPath!,
                originalFileName: originalFileName
            });
            shortSha = GitService.shortenSha(shaOrcommitOrUri);
        }
        else if (shaOrcommitOrUri instanceof GitCommit) {
            data = GitService.toGitUriData(shaOrcommitOrUri, shaOrcommitOrUri.originalFileName);
            fileName = shaOrcommitOrUri.fileName;
            shortSha = shaOrcommitOrUri.shortSha;
        }
        else {
            data = GitService.toGitUriData({
                sha: shaOrcommitOrUri.sha!,
                fileName: shaOrcommitOrUri.fsPath!,
                repoPath: shaOrcommitOrUri.repoPath!
            });
            fileName = shaOrcommitOrUri.fsPath;
            shortSha = shaOrcommitOrUri.shortSha;
        }

        const parsed = path.parse(fileName!);
        return Uri.parse(`${DocumentSchemes.GitLensGit}:${parsed.dir}${parsed.name}:${shortSha}${parsed.ext}?${JSON.stringify(data)}`);
    }

    private static toGitUriData<T extends IGitUriData>(commit: IGitUriData, originalFileName?: string): T {
        const fileName = Git.normalizePath(path.resolve(commit.repoPath, commit.fileName));
        const data = { repoPath: commit.repoPath, fileName: fileName, sha: commit.sha } as T;
        if (originalFileName) {
            data.originalFileName = Git.normalizePath(path.resolve(commit.repoPath, originalFileName));
        }
        return data;
    }

    static validateGitVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = this.getGitVersion().split('.');
        return (parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor);
    }
}