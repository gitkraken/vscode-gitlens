'use strict';
import { Functions, Iterables, Objects, TernarySearchTree } from './system';
import { ConfigurationChangeEvent, Disposable, Event, EventEmitter, Range, TextDocument, TextDocumentChangeEvent, TextEditor, Uri, window, WindowState, workspace, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode';
import { configuration, IConfig, IRemotesConfig } from './configuration';
import { CommandContext, DocumentSchemes, setCommandContext } from './constants';
import { RemoteProviderFactory, RemoteProviderMap } from './git/remotes/factory';
import { Git, GitAuthor, GitBlame, GitBlameCommit, GitBlameLine, GitBlameLines, GitBlameParser, GitBranch, GitBranchParser, GitCommit, GitCommitType, GitDiff, GitDiffChunkLine, GitDiffParser, GitDiffShortStat, GitLog, GitLogCommit, GitLogParser, GitRemote, GitRemoteParser, GitStash, GitStashParser, GitStatus, GitStatusFile, GitStatusParser, IGit, Repository } from './git/git';
import { GitUri, IGitCommitInfo, IGitUriData } from './git/gitUri';
import { Logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

export { GitUri, IGit, IGitCommitInfo };
export * from './git/models/models';
export * from './git/formatters/commit';
export * from './git/formatters/status';
export { getNameFromRemoteResource, RemoteProvider, RemoteResource, RemoteResourceType } from './git/remotes/provider';
export { RemoteProviderFactory } from './git/remotes/factory';
export * from './git/gitContextTracker';

class UriCacheEntry {

    constructor(
        public readonly uri: GitUri
    ) { }
}

class GitCacheEntry {

    private cache: Map<string, CachedBlame | CachedDiff | CachedLog> = new Map();

    constructor(
        public readonly key: string
    ) { }

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

export enum GitChangeReason {
    GitCache = 'git-cache',
    Repositories = 'repositories'
}

export interface GitChangeEvent {
    reason: GitChangeReason;
}

export class GitService extends Disposable {

    static emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
    static deletedSha = 'ffffffffffffffffffffffffffffffffffffffff';
    static stagedUncommittedSha = Git.stagedUncommittedSha;
    static uncommittedSha = Git.uncommittedSha;

    config: IConfig;

    private _onDidBlameFail = new EventEmitter<string>();
    get onDidBlameFail(): Event<string> {
        return this._onDidBlameFail.event;
    }

    private _onDidChange = new EventEmitter<GitChangeEvent>();
    get onDidChange(): Event<GitChangeEvent> {
        return this._onDidChange.event;
    }

    private _cacheDisposable: Disposable | undefined;
    private _disposable: Disposable | undefined;
    private _documentKeyMap: Map<TextDocument, string>;
    private _gitCache: Map<string, GitCacheEntry>;
    private _repositoryTree: TernarySearchTree<Repository>;
    private _repositoriesLoadingPromise: Promise<void> | undefined;
    private _suspended: boolean = false;
    private _trackedCache: Map<string, boolean | Promise<boolean>>;
    private _versionedUriCache: Map<string, UriCacheEntry>;

    constructor() {
        super(() => this.dispose());

        this._documentKeyMap = new Map();
        this._gitCache = new Map();
        this._repositoryTree = TernarySearchTree.forPaths();
        this._trackedCache = new Map();
        this._versionedUriCache = new Map();

        this._disposable = Disposable.from(
            window.onDidChangeWindowState(this.onWindowStateChanged, this),
            workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this),
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
        this._repositoriesLoadingPromise = this.onWorkspaceFoldersChanged();
    }

    dispose() {
        this._repositoryTree.forEach(r => r.dispose());

        this._disposable && this._disposable.dispose();

        this._cacheDisposable && this._cacheDisposable.dispose();
        this._cacheDisposable = undefined;

        this._documentKeyMap.clear();
        this._gitCache.clear();
        this._trackedCache.clear();
        this._versionedUriCache.clear();
    }

    get UseCaching() {
        return this.config.advanced.caching.enabled;
    }

    private onAnyRepositoryChanged() {
        this._gitCache.clear();
        this._trackedCache.clear();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const cfg = configuration.get<IConfig>();

        if (initializing || configuration.changed(e, configuration.name('advanced')('caching')('enabled').value)) {
            if (cfg.advanced.caching.enabled) {
                this._cacheDisposable && this._cacheDisposable.dispose();

                this._cacheDisposable = Disposable.from(
                    workspace.onDidChangeTextDocument(Functions.debounce(this.onTextDocumentChanged, 50), this),
                    workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this)
                );
            }
            else {
                this._cacheDisposable && this._cacheDisposable.dispose();
                this._cacheDisposable = undefined;

                this._documentKeyMap.clear();
                this._gitCache.clear();
            }
        }

        this.config = cfg;

        // Only count the change if we aren't initializing
        if (!initializing && configuration.changed(e, configuration.name('blame')('ignoreWhitespace').value, null)) {
            this._gitCache.clear();
            this.fireChange(GitChangeReason.GitCache);
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

    private onWindowStateChanged(e: WindowState) {
        if (e.focused) {
            this._repositoryTree.forEach(r => r.resume());
        }
        else {
            this._repositoryTree.forEach(r => r.suspend());
        }

        this._suspended = !e.focused;
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

            // Search for and add all repositories (nested and/or submodules)
            const repositories = await this.repositorySearch(f);
            for (const r of repositories) {
                this._repositoryTree.set(r.path, r);
            }
        }

        for (const f of e.removed) {
            if (f.uri.scheme !== DocumentSchemes.File) continue;

            const fsPath = f.uri.fsPath;
            const filteredTree = this._repositoryTree.findSuperstr(fsPath);
            const reposToDelete = filteredTree !== undefined
                // Since the filtered tree will have keys that are relative to the fsPath, normalize to the full path
                ? [...Iterables.map<[Repository, string], [Repository, string]>(filteredTree.entries(), ([r, k]) => [r, path.join(fsPath, k)])]
                : [];

            const repo = this._repositoryTree.get(fsPath);
            if (repo !== undefined) {
                reposToDelete.push([repo, fsPath]);
            }

            for (const [r, k] of reposToDelete) {
                this._repositoryTree.delete(k);
                r.dispose();
            }
        }

        await setCommandContext(CommandContext.HasRepository, this._repositoryTree.any());

        if (!initializing) {
            // Defer the event trigger enough to let everything unwind
            setTimeout(() => this.fireChange(GitChangeReason.Repositories), 1);
        }
    }

    private async repositorySearch(folder: WorkspaceFolder): Promise<Repository[]> {
        const folderUri = folder.uri;

        const repositories: Repository[] = [];
        const anyRepoChangedFn = this.onAnyRepositoryChanged.bind(this);

        const rootPath = await this.getRepoPathCore(folderUri.fsPath, true);
        await this.getRepoPathCore(folderUri.fsPath, true);
        if (rootPath !== undefined) {
            repositories.push(new Repository(folder, rootPath, true, this, anyRepoChangedFn, this._suspended));
        }

        // Can remove this try/catch once https://github.com/Microsoft/vscode/issues/38229 is fixed
        let depth;
        try {
            depth = configuration.get<number>(configuration.name('advanced')('repositorySearchDepth').value, folderUri);
        }
        catch (ex) {
            Logger.error(ex);
            depth = configuration.get<number>(configuration.name('advanced')('repositorySearchDepth').value, null);
        }

        if (depth <= 0) return repositories;

        // Can remove this try/catch once https://github.com/Microsoft/vscode/issues/38229 is fixed
        let excludes = {};
        try {
            // Get any specified excludes -- this is a total hack, but works for some simple cases and something is better than nothing :)
            excludes = {
                ...workspace.getConfiguration('files', folderUri).get<{ [key: string]: boolean }>('exclude', {}),
                ...workspace.getConfiguration('search', folderUri).get<{ [key: string]: boolean }>('exclude', {})
            };
        }
        catch (ex) {
            Logger.error(ex);
            excludes = {
                ...workspace.getConfiguration('files', null!).get<{ [key: string]: boolean }>('exclude', {}),
                ...workspace.getConfiguration('search', null!).get<{ [key: string]: boolean }>('exclude', {})
            };
        }

        const excludedPaths = [...Iterables.filterMap(Objects.entries(excludes), ([key, value]) => {
            if (!value) return undefined;
            if (key.startsWith('**/')) return key.substring(3);
            return key;
        })];

        excludes = excludedPaths.reduce((accumulator, current) => {
            accumulator[current] = true;
            return accumulator;
        }, Object.create(null) as any);

        const start = process.hrtime();

        const paths = await this.repositorySearchCore(folderUri.fsPath, depth, excludes);

        const duration = process.hrtime(start);
        Logger.log(`${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms to search (depth=${depth}) for repositories in ${folderUri.fsPath}`);

        for (const p of paths) {
            const rp = await this.getRepoPathCore(path.dirname(p), true);
            if (rp !== undefined && rp !== rootPath) {
                repositories.push(new Repository(folder, rp, false, this, anyRepoChangedFn, this._suspended));
            }
        }

        // const uris = await workspace.findFiles(new RelativePattern(folder, '**/.git/HEAD'));
        // for (const uri of uris) {
        //     const rp = await this.getRepoPathCore(path.resolve(path.dirname(uri.fsPath), '../'), true);
        //     if (rp !== undefined && rp !== rootPath) {
        //         repositories.push(new Repository(folder, rp, false, this, anyRepoChangedFn, this._suspended));
        //     }
        // }

        return repositories;
    }

    private async repositorySearchCore(root: string, depth: number, excludes: { [key: string]: boolean }, repositories: string[] = []): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            fs.readdir(root, async (err, files) => {
                if (err != null) {
                    reject(err);
                    return;
                }

                if (files.length === 0) {
                    resolve(repositories);
                    return;
                }

                const folders: string[] = [];

                const promises = files.map(file => {
                    const fullPath = path.resolve(root, file);

                    return new Promise<void>((res, rej) => {
                        fs.stat(fullPath, (err, stat) => {
                            if (file === '.git') {
                                repositories.push(fullPath);
                            }
                            else if (err == null && excludes[file] !== true && stat != null && stat.isDirectory()) {
                                folders.push(fullPath);
                            }

                            res();
                        });
                    });
                });

                await Promise.all(promises);

                if (depth-- > 0) {
                    for (const folder of folders) {
                        await this.repositorySearchCore(folder, depth, excludes, repositories);
                    }
                }

                resolve(repositories);
            });
        });
    }

    private fireChange(reason: GitChangeReason) {
        this._onDidChange.fire({ reason: reason });
    }

    checkoutFile(uri: GitUri, sha?: string) {
        sha = sha || uri.sha;
        Logger.log(`checkoutFile('${uri.repoPath}', '${uri.fsPath}', '${sha}')`);

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

    async getActiveRepoPath(editor?: TextEditor): Promise<string | undefined> {
        if (editor === undefined) {
            const repoPath = this.getHighlanderRepoPath();
            if (repoPath !== undefined) return repoPath;
        }

        editor = editor || window.activeTextEditor;
        if (editor === undefined) return undefined;

        return this.getRepoPath(editor.document.uri);
    }

    getHighlanderRepoPath(): string | undefined {
        const entry = this._repositoryTree.highlander();
        if (entry === undefined) return undefined;

        const [repo] = entry;
        return repo.path;
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
                    Logger.log(`getBlameForFile[Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);
                    return cachedBlame.item;
                }
            }

            Logger.log(`getBlameForFile[Not Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getBlameForFile('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);
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
        Logger.log(`getBlameForLine('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}', ${line})`);

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
        Logger.log(`getBlameForRange('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}', [${range.start.line}, ${range.end.line}])`);

        const blame = await this.getBlameForFile(uri);
        if (blame === undefined) return undefined;

        return this.getBlameForRangeSync(blame, uri, range);
    }

    getBlameForRangeSync(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
        Logger.log(`getBlameForRangeSync('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}', [${range.start.line}, ${range.end.line}])`);

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
        if (repoPath === undefined) return undefined;

        Logger.log(`getBranch('${repoPath}')`);

        const data = await Git.revparse_currentBranch(repoPath);
        if (data === undefined) return undefined;

        const branch = data.split('\n');
        return new GitBranch(repoPath, branch[0], true, branch[1]);
    }

    async getBranches(repoPath: string | undefined): Promise<GitBranch[]> {
        if (repoPath === undefined) return [];

        Logger.log(`getBranches('${repoPath}')`);

        const data = await Git.branch(repoPath, { all: true });
        return GitBranchParser.parse(data, repoPath) || [];
    }

    getCacheEntryKey(fileName: string): string;
    getCacheEntryKey(uri: Uri): string;
    getCacheEntryKey(fileNameOrUri: string | Uri): string {
        return Git.normalizePath(typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath).toLowerCase();
    }

    async getChangedFilesCount(repoPath: string, sha?: string): Promise<GitDiffShortStat | undefined> {
        Logger.log(`getChangedFilesCount('${repoPath}', '${sha}')`);

        const data = await Git.diff_shortstat(repoPath, sha);
        return GitDiffParser.parseShortStat(data);
    }

    async getConfig(key: string, repoPath?: string): Promise<string | undefined> {
        Logger.log(`getConfig('${key}', '${repoPath}')`);

        return await Git.config_get(key, repoPath);
    }

    getGitUriForVersionedFile(uri: Uri) {
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
                    Logger.log(`getDiffForFile[Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${sha1}', '${sha2}')`);
                    return cachedDiff.item;
                }
            }

            Logger.log(`getDiffForFile[Not Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${sha1}', '${sha2}')`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getDiffForFile('${uri.repoPath}', '${uri.fsPath}', '${sha1}', '${sha2}')`);
        }

        const promise = this.getDiffForFileCore(uri.repoPath, uri.fsPath, sha1, sha2, { encoding: GitService.getEncoding(uri) }, entry, key);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}:${key}'`);

            entry.set<CachedDiff>(key, {
                item: promise
            } as CachedDiff);
        }

        return promise;
    }

    private async getDiffForFileCore(repoPath: string | undefined, fileName: string, sha1: string | undefined, sha2: string | undefined, options: { encoding?: string }, entry: GitCacheEntry | undefined, key: string): Promise<GitDiff | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            const data = await Git.diff(root, file, sha1, sha2, options);
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
        Logger.log(`getDiffForLine('${uri.repoPath}', '${uri.fsPath}', ${line}, '${sha1}', '${sha2}')`);

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
        Logger.log(`getDiffStatus('${repoPath}', '${sha1}', '${sha2}', ${options.filter})`);

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

        Logger.log(`getLogCommit('${repoPath}', '${fileName}', '${sha}', ${options.firstIfMissing}, ${options.previous})`);

        const log = await this.getLogForFile(repoPath, fileName, sha, { maxCount: options.previous ? 2 : 1 });
        if (log === undefined) return undefined;

        const commit = sha && log.commits.get(sha);
        if (commit === undefined && sha && !options.firstIfMissing) return undefined;

        return commit || Iterables.first(log.commits.values());
    }

    async getLogForRepo(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false): Promise<GitLog | undefined> {
        Logger.log(`getLogForRepo('${repoPath}', '${sha}', ${maxCount}, ${reverse})`);

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
        Logger.log(`getLogForRepoSearch('${repoPath}', '${search}', '${searchBy}', ${maxCount})`);

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
                    Logger.log(`getLogForFile[Cached(${key})]('${repoPath}', '${fileName}', '${sha}', ${options.maxCount}, undefined, ${options.reverse}, ${options.skipMerges})`);
                    return cachedLog.item;
                }

                if (key !== 'log') {
                    // Since we are looking for partial log, see if we have the log of the whole file
                    const cachedLog = entry.get<CachedLog>('log');
                    if (cachedLog !== undefined) {
                        if (sha === undefined) {
                            Logger.log(`getLogForFile[Cached(~${key})]('${repoPath}', '${fileName}', '', ${options.maxCount}, undefined, ${options.reverse}, ${options.skipMerges})`);
                            return cachedLog.item;
                        }

                        Logger.log(`getLogForFile[? Cache(${key})]('${repoPath}', '${fileName}', '${sha}', ${options.maxCount}, undefined, ${options.reverse}, ${options.skipMerges})`);
                        const log = await cachedLog.item;
                        if (log !== undefined && log.commits.has(sha)) {
                            Logger.log(`getLogForFile[Cached(${key})]('${repoPath}', '${fileName}', '${sha}', ${options.maxCount}, undefined, ${options.reverse}, ${options.skipMerges})`);
                            return cachedLog.item;
                        }
                    }
                }
            }

            Logger.log(`getLogForFile[Not Cached(${key})]('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, undefined, ${options.reverse}, ${options.skipMerges})`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getLogForFile('${repoPath}', '${fileName}', ${sha}, ${options.maxCount}, ${options.range && `[${options.range.start.line}, ${options.range.end.line}]`}, ${options.reverse}, ${options.skipMerges})`);
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

    async hasRemote(repoPath: string | undefined): Promise<boolean> {
        if (repoPath === undefined) return false;

        const repository = await this.getRepository(repoPath);
        if (repository === undefined) return false;

        return repository.hasRemote();
    }

    async hasRemotes(repoPath: string | undefined): Promise<boolean> {
        if (repoPath === undefined) return false;

        const repository = await this.getRepository(repoPath);
        if (repository === undefined) return false;

        return repository.hasRemotes();
    }

    async getRemotes(repoPath: string | undefined): Promise<GitRemote[]> {
        if (repoPath === undefined) return [];

        Logger.log(`getRemotes('${repoPath}')`);

        const repository = await this.getRepository(repoPath);
        if (repository !== undefined) return repository.getRemotes();

        return this.getRemotesCore(repoPath);
    }

    async getRemotesCore(repoPath: string | undefined, providerMap?: RemoteProviderMap): Promise<GitRemote[]> {
        if (repoPath === undefined) return [];

        Logger.log(`getRemotesCore('${repoPath}')`);

        providerMap = providerMap || RemoteProviderFactory.createMap(configuration.get<IRemotesConfig[] | null | undefined>(configuration.name('remotes').value, null));

        const data = await Git.remote(repoPath);
        return GitRemoteParser.parse(data, repoPath, RemoteProviderFactory.factory(providerMap));
    }

    async getRepoPath(filePath: string): Promise<string | undefined>;
    async getRepoPath(uri: Uri | undefined): Promise<string | undefined>;
    async getRepoPath(filePathOrUri: string | Uri | undefined): Promise<string | undefined> {
        if (filePathOrUri === undefined) return await this.getActiveRepoPath();
        if (filePathOrUri instanceof GitUri) return filePathOrUri.repoPath;

        const repo = await this.getRepository(filePathOrUri);
        if (repo !== undefined) return repo.path;

        const rp = await this.getRepoPathCore(typeof filePathOrUri === 'string' ? filePathOrUri : filePathOrUri.fsPath, false);
        if (rp === undefined) return undefined;

        // Recheck this._repositoryTree.get(rp) to make sure we haven't already tried adding this due to awaits
        if (this._repositoryTree.get(rp) !== undefined) return rp;

        // If this new repo is inside one of our known roots and we we don't already know about, add it
        const root = this._repositoryTree.findSubstr(rp);
        const folder = root === undefined
            ? workspace.getWorkspaceFolder(Uri.file(rp))
            : root.folder;

        if (folder !== undefined) {
            const repo = new Repository(folder, rp, false, this, this.onAnyRepositoryChanged.bind(this), this._suspended);
            this._repositoryTree.set(rp, repo);

            // Send a notification that the repositories changed
            setTimeout(async () => {
                await setCommandContext(CommandContext.HasRepository, this._repositoryTree.any());

                this.fireChange(GitChangeReason.Repositories);
            }, 0);
        }

        return rp;
    }

    private getRepoPathCore(filePath: string, isDirectory: boolean): Promise<string | undefined> {
        return Git.revparse_toplevel(isDirectory ? filePath : path.dirname(filePath));
    }

    async getRepositories(): Promise<Iterable<Repository>> {
        const repositoryTree = await this.getRepositoryTree();
        return repositoryTree.values();
    }

    private async getRepositoryTree(): Promise<TernarySearchTree<Repository>> {
        if (this._repositoriesLoadingPromise !== undefined) {
            await this._repositoriesLoadingPromise;
            this._repositoriesLoadingPromise = undefined;
        }

        return this._repositoryTree;
    }

    async getRepository(repoPath: string): Promise<Repository | undefined>;
    async getRepository(uri: Uri): Promise<Repository | undefined>;
    async getRepository(repoPathOrUri: string | Uri): Promise<Repository | undefined>;
    async getRepository(repoPathOrUri: string | Uri): Promise<Repository | undefined> {
        const repositoryTree = await this.getRepositoryTree();

        let path: string;
        if (typeof repoPathOrUri === 'string') {
            const repo = repositoryTree.get(repoPathOrUri);
            if (repo !== undefined) return repo;

            path = repoPathOrUri;
        }
        else {
            if (repoPathOrUri instanceof GitUri) {
                if (repoPathOrUri.repoPath) {
                    const repo = repositoryTree.get(repoPathOrUri.repoPath);
                    if (repo !== undefined) return repo;
                }

                path = repoPathOrUri.fsPath;
            }
            else {
                path = repoPathOrUri.fsPath;
            }
        }

        const repo = repositoryTree.findSubstr(path);
        if (repo === undefined) return undefined;

        // Make sure the file is tracked in that repo, before returning
        if (!await this.isTrackedCore(repo.path, path)) return undefined;
        return repo;
    }

    async getStashList(repoPath: string | undefined): Promise<GitStash | undefined> {
        if (repoPath === undefined) return undefined;

        Logger.log(`getStashList('${repoPath}')`);

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
        if (repoPath === undefined) return undefined;

        Logger.log(`getStatusForRepo('${repoPath}')`);

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status(repoPath, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        return status;
    }

    async getVersionedFile(repoPath: string | undefined, fileName: string, sha?: string) {
        Logger.log(`getVersionedFile('${repoPath}', '${fileName}', '${sha}')`);

        if (!sha || (Git.isUncommitted(sha) && !Git.isStagedUncommitted(sha))) return fileName;

        const file = await Git.getVersionedFile(repoPath, fileName, sha);
        if (file === undefined) return undefined;

        const cacheKey = this.getCacheEntryKey(file);
        const entry = new UriCacheEntry(new GitUri(Uri.file(fileName), { sha: sha, repoPath: repoPath!, fileName }));
        this._versionedUriCache.set(cacheKey, entry);
        return file;
    }

    getVersionedFileText(repoPath: string, fileName: string, sha: string) {
        Logger.log(`getVersionedFileText('${repoPath}', '${fileName}', ${sha})`);

        return Git.show(repoPath, fileName, sha, { encoding: GitService.getEncoding(repoPath, fileName) });
    }

    hasGitUriForFile(editor: TextEditor): boolean {
        if (editor === undefined || editor.document === undefined || editor.document.uri === undefined) return false;

        const cacheKey = this.getCacheEntryKey(editor.document.uri);
        return this._versionedUriCache.has(cacheKey);
    }

    isEditorBlameable(editor: TextEditor): boolean {
        return (editor.viewColumn !== undefined || this.isTrackable(editor.document.uri) || this.hasGitUriForFile(editor));
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
        let sha: string | undefined;
        if (typeof fileNameOrUri === 'string') {
            [fileName, repoPath] = Git.splitPath(fileNameOrUri, repoPath);
            cacheKey = this.getCacheEntryKey(fileNameOrUri);
        }
        else {
            if (!this.isTrackable(fileNameOrUri)) return false;

            fileName = fileNameOrUri.fsPath;
            repoPath = fileNameOrUri.repoPath;
            sha = fileNameOrUri.sha;
            cacheKey = this.getCacheEntryKey(fileName);
        }

        Logger.log(`isTracked('${fileName}', '${repoPath}', '${sha}')`);

        let tracked = this._trackedCache.get(cacheKey);
        if (tracked !== undefined) {
            if (typeof tracked === 'boolean') return tracked;
            return await tracked;
        }

        tracked = this.isTrackedCore(repoPath === undefined ? '' : repoPath, fileName, sha);
        this._trackedCache.set(cacheKey, tracked);

        tracked = await tracked;
        this._trackedCache.set(cacheKey, tracked);

        return tracked;
    }

    private async isTrackedCore(repoPath: string, fileName: string, sha?: string) {
        // Even if we have a sha, check first to see if the file exists (that way the cache will be better reused)
        let tracked = !!await Git.ls_files(repoPath === undefined ? '' : repoPath, fileName);
        if (!tracked && sha !== undefined) {
            tracked = !!await Git.ls_files(repoPath === undefined ? '' : repoPath, fileName, sha);
        }
        return tracked;
    }

    async getDiffTool(repoPath?: string) {
        return await Git.config_get('diff.guitool', repoPath) || await Git.config_get('diff.tool', repoPath);
    }

    async openDiffTool(repoPath: string, uri: Uri, staged: boolean, tool?: string) {
        if (!tool) {
            tool = await this.getDiffTool(repoPath);
            if (tool === undefined) throw new Error('No diff tool found');
        }

        Logger.log(`openDiffTool('${repoPath}', '${uri.fsPath}', ${staged}, '${tool}')`);

        return Git.difftool_fileDiff(repoPath, uri.fsPath, tool, staged);
    }

    async openDirectoryDiff(repoPath: string, sha1: string, sha2?: string, tool?: string) {
        if (!tool) {
            tool = await this.getDiffTool(repoPath);
            if (tool === undefined) throw new Error('No diff tool found');
        }

        Logger.log(`openDirectoryDiff('${repoPath}', '${sha1}', '${sha2}', '${tool}')`);

        return Git.difftool_dirDiff(repoPath, tool, sha1, sha2);
    }

    stopWatchingFileSystem() {
        this._repositoryTree.forEach(r => r.stopWatchingFileSystem());
    }

    stashApply(repoPath: string, stashName: string, deleteAfter: boolean = false) {
        Logger.log(`stashApply('${repoPath}', '${stashName}', ${deleteAfter})`);

        return Git.stash_apply(repoPath, stashName, deleteAfter);
    }

    stashDelete(repoPath: string, stashName: string) {
        Logger.log(`stashDelete('${repoPath}', '${stashName}')`);

        return Git.stash_delete(repoPath, stashName);
    }

    stashSave(repoPath: string, message?: string, uris?: Uri[]) {
        Logger.log(`stashSave('${repoPath}', '${message}', ${uris})`);

        if (uris === undefined) return Git.stash_save(repoPath, message);
        const pathspecs = uris.map(u => Git.splitPath(u.fsPath, repoPath)[0]);
        return Git.stash_push(repoPath, pathspecs, message);
    }

    static getEncoding(repoPath: string, fileName: string): string;
    static getEncoding(uri: Uri): string;
    static getEncoding(repoPathOrUri: string | Uri, fileName?: string): string {
        const uri = (typeof repoPathOrUri === 'string')
            ? Uri.file(path.join(repoPathOrUri, fileName!))
            : repoPathOrUri;
        return Git.getEncoding(workspace.getConfiguration('files', uri).get<string>('encoding'));
    }

    static initialize(gitPath?: string): Promise<IGit> {
        return Git.getGitInfo(gitPath);
    }

    static getGitPath(): string {
        return Git.gitInfo().path;
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

    static isStagedUncommitted(sha: string): boolean {
        return Git.isStagedUncommitted(sha);
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
        return Uri.parse(`${DocumentSchemes.GitLensGit}:${path.join(parsed.dir, parsed.name)}:${shortSha}${parsed.ext}?${JSON.stringify(data)}`);
    }

    private static toGitUriData<T extends IGitUriData>(commit: IGitUriData, originalFileName?: string): T {
        const fileName = Git.normalizePath(path.relative(commit.repoPath, commit.fileName));
        const data = { repoPath: commit.repoPath, fileName: fileName, sha: commit.sha } as T;
        if (originalFileName) {
            data.originalFileName = Git.normalizePath(path.relative(commit.repoPath, originalFileName));
        }
        return data;
    }

    static validateGitVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = this.getGitVersion().split('.');
        return (parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor);
    }
}