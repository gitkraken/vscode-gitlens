'use strict';
import { Iterables, Objects, Strings, TernarySearchTree } from './system';
import { ConfigurationChangeEvent, Disposable, Event, EventEmitter, Range, TextEditor, Uri, window, WindowState, workspace, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode';
import { configuration, IRemotesConfig } from './configuration';
import { CommandContext, DocumentSchemes, setCommandContext } from './constants';
import { Container } from './container';
import { CachedBlame, CachedDiff, CachedLog, GitDocumentState, TrackedDocument } from './trackers/documentTracker';
import { RemoteProviderFactory, RemoteProviderMap } from './git/remotes/factory';
import { CommitFormatting, Git, GitAuthor, GitBlame, GitBlameCommit, GitBlameLine, GitBlameLines, GitBlameParser, GitBranch, GitBranchParser, GitCommit, GitCommitType, GitDiff, GitDiffChunkLine, GitDiffParser, GitDiffShortStat, GitLog, GitLogCommit, GitLogParser, GitRemote, GitRemoteParser, GitStash, GitStashParser, GitStatus, GitStatusFile, GitStatusParser, GitTag, GitTagParser, IGit, Repository } from './git/git';
import { GitUri, IGitCommitInfo } from './git/gitUri';
import { Logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

export { GitUri, IGit, IGitCommitInfo };
export * from './git/models/models';
export * from './git/formatters/commit';
export * from './git/formatters/status';
export { getNameFromRemoteResource, RemoteProvider, RemoteResource, RemoteResourceType } from './git/remotes/provider';
export { RemoteProviderFactory } from './git/remotes/factory';

export enum GitRepoSearchBy {
    Author = 'author',
    ChangedOccurrences = 'changed-occurrences',
    Changes = 'changes',
    Files = 'files',
    Message = 'message',
    Sha = 'sha'
}

export class GitService extends Disposable {

    static emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
    static deletedSha = 'ffffffffffffffffffffffffffffffffffffffff';
    static stagedUncommittedSha = Git.stagedUncommittedSha;
    static uncommittedSha = Git.uncommittedSha;

    private _onDidChangeRepositories = new EventEmitter<void>();
    get onDidChangeRepositories(): Event<void> {
        return this._onDidChangeRepositories.event;
    }

    private readonly _disposable: Disposable;
    private readonly _repositoryTree: TernarySearchTree<Repository>;
    private _repositoriesLoadingPromise: Promise<void> | undefined;
    private _suspended: boolean = false;
    private readonly _trackedCache: Map<string, boolean | Promise<boolean>>;
    private _versionedUriCache: Map<string, GitUri>;

    constructor() {
        super(() => this.dispose());

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
        this._trackedCache.clear();
        this._versionedUriCache.clear();

        this._disposable && this._disposable.dispose();
    }

    get UseCaching() {
        return Container.config.advanced.caching.enabled;
    }

    private onAnyRepositoryChanged(repo: Repository) {
        this._trackedCache.clear();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (initializing ||
            configuration.changed(e, configuration.name('defaultDateStyle').value) ||
            configuration.changed(e, configuration.name('defaultDateFormat').value)) {
            CommitFormatting.reset();
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

            Logger.log(`Starting repository search in ${e.added.length} folders`);
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

        await this.updateContext(this._repositoryTree);

        if (!initializing) {
            // Defer the event trigger enough to let everything unwind
            setImmediate(() => this.fireRepositoriesChanged());
        }
    }

    private async repositorySearch(folder: WorkspaceFolder): Promise<Repository[]> {
        const folderUri = folder.uri;

        const depth = configuration.get<number>(configuration.name('advanced')('repositorySearchDepth').value, folderUri);

        Logger.log(`Searching for repositories (depth=${depth}) in '${folderUri.fsPath}' ...`);

        const start = process.hrtime();

        const repositories: Repository[] = [];
        const anyRepoChangedFn = this.onAnyRepositoryChanged.bind(this);

        const rootPath = await this.getRepoPathCore(folderUri.fsPath, true);
        if (rootPath !== undefined) {
            Logger.log(`Repository found in '${rootPath}'`);
            repositories.push(new Repository(folder, rootPath, true, anyRepoChangedFn, this._suspended));
        }

        if (depth <= 0) {
            const duration = process.hrtime(start);
            Logger.log(`Searching for repositories (depth=${depth}) in '${folderUri.fsPath}' took ${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms`);

            return repositories;
        }

        // Get any specified excludes -- this is a total hack, but works for some simple cases and something is better than nothing :)
        let excludes = {
            ...workspace.getConfiguration('files', folderUri).get<{ [key: string]: boolean }>('exclude', {}),
            ...workspace.getConfiguration('search', folderUri).get<{ [key: string]: boolean }>('exclude', {})
        };

        const excludedPaths = [...Iterables.filterMap(Objects.entries(excludes), ([key, value]) => {
            if (!value) return undefined;
            if (key.startsWith('**/')) return key.substring(3);
            return key;
        })];

        excludes = excludedPaths.reduce((accumulator, current) => {
            accumulator[current] = true;
            return accumulator;
        }, Object.create(null) as any);

        const paths = await this.repositorySearchCore(folderUri.fsPath, depth, excludes);

        for (let p of paths) {
            p = path.dirname(p);
            // If we are the same as the root, skip it
            if (Strings.normalizePath(p) === rootPath) continue;

            const rp = await this.getRepoPathCore(p, true);
            if (rp === undefined) continue;

            Logger.log(`Repository found in '${rp}'`);
            repositories.push(new Repository(folder, rp, false, anyRepoChangedFn, this._suspended));
        }

        // const uris = await workspace.findFiles(new RelativePattern(folder, '**/.git/HEAD'));
        // for (const uri of uris) {
        //     const rp = await this.getRepoPathCore(path.resolve(path.dirname(uri.fsPath), '../'), true);
        //     if (rp !== undefined && rp !== rootPath) {
        //         repositories.push(new Repository(folder, rp, false, anyRepoChangedFn, this._suspended));
        //     }
        // }

        const duration = process.hrtime(start);
        Logger.log(`Searching for repositories (depth=${depth}) in '${folderUri.fsPath}' took ${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms`);

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

    private async updateContext(repositoryTree: TernarySearchTree<Repository>) {
        const hasRepository = repositoryTree.any();
        await setCommandContext(CommandContext.Enabled, hasRepository);

        let hasRemotes = false;
        if (hasRepository) {
            for (const repo of repositoryTree.values()) {
                hasRemotes = await repo.hasRemotes();
                if (hasRemotes) break;
            }
        }

        await setCommandContext(CommandContext.HasRemotes, hasRemotes);

        // If we have no repositories setup a watcher in case one is initialized
        if (!hasRepository) {
            const watcher = workspace.createFileSystemWatcher('**/.git', false, true, true);
            const disposable = Disposable.from(
                watcher,
                watcher.onDidCreate(async uri => {
                    const f = workspace.getWorkspaceFolder(uri);
                    if (f === undefined) return;

                    // Search for and add all repositories (nested and/or submodules)
                    const repositories = await this.repositorySearch(f);
                    if (repositories.length === 0) return;

                    disposable.dispose();

                    for (const r of repositories) {
                        this._repositoryTree.set(r.path, r);
                    }

                    await this.updateContext(this._repositoryTree);

                    // Defer the event trigger enough to let everything unwind
                    setImmediate(() => this.fireRepositoriesChanged());
                }, this)
            );
        }
    }

    private fireRepositoriesChanged() {
        this._onDidChangeRepositories.fire();
    }

    checkoutFile(uri: GitUri, ref?: string) {
        ref = ref || uri.sha;
        Logger.log(`checkoutFile('${uri.repoPath}', '${uri.fsPath}', '${ref}')`);

        return Git.checkout(uri.repoPath!, uri.fsPath, ref!);
    }

    private async fileExists(repoPath: string, fileName: string): Promise<boolean> {
        return await new Promise<boolean>((resolve, reject) => fs.exists(path.resolve(repoPath, fileName), resolve));
    }

    async findNextCommit(repoPath: string, fileName: string, ref?: string): Promise<GitLogCommit | undefined> {
        let log = await this.getLogForFile(repoPath, fileName, { maxCount: 1, ref: ref, reverse: true });
        let commit = log && Iterables.first(log.commits.values());
        if (commit) return commit;

        const nextFileName = await this.findNextFileName(repoPath, fileName, ref);
        if (nextFileName) {
            log = await this.getLogForFile(repoPath, nextFileName, { maxCount: 1, ref: ref, reverse: true });
            commit = log && Iterables.first(log.commits.values());
        }

        return commit;
    }

    async findNextFileName(repoPath: string | undefined, fileName: string, ref?: string): Promise<string | undefined> {
        [fileName, repoPath] = Git.splitPath(fileName, repoPath);

        return (await this.fileExists(repoPath, fileName))
            ? fileName
            : await this.findNextFileNameCore(repoPath, fileName, ref);
    }

    private async findNextFileNameCore(repoPath: string, fileName: string, ref?: string): Promise<string | undefined> {
        if (ref === undefined) {
            // Get the most recent commit for this file name
            ref = await this.getRecentShaForFile(repoPath, fileName);
            if (ref === undefined) return undefined;
        }

        // Get the full commit (so we can see if there are any matching renames in the file statuses)
        const log = await this.getLog(repoPath, { maxCount: 1, ref: ref });
        if (log === undefined) return undefined;

        const c = Iterables.first(log.commits.values());
        const status = c.fileStatuses.find(f => f.originalFileName === fileName);
        if (status === undefined) return undefined;

        return status.fileName;
    }

    async findWorkingFileName(commit: GitCommit): Promise<[string | undefined, string | undefined]>;
    async findWorkingFileName(fileName: string, repoPath?: string, ref?: string): Promise<[string | undefined, string | undefined]>;
    async findWorkingFileName(commitOrFileName: GitCommit | string, repoPath?: string, ref?: string): Promise<[string | undefined, string | undefined]> {
        let fileName;
        if (typeof commitOrFileName === 'string') {
            fileName = commitOrFileName;
            if (repoPath === undefined) {
                repoPath = await this.getRepoPath(fileName, { ref: ref });
                [fileName, repoPath] = Git.splitPath(fileName, repoPath);
            }

        }
        else {
            const c = commitOrFileName;
            repoPath = c.repoPath;
            if (c.workingFileName && await this.fileExists(repoPath, c.workingFileName)) return [c.workingFileName, repoPath];
            fileName = c.fileName;
        }

        // Keep walking up to the most recent commit for a given filename, until it exists on disk
        while (true) {
            if (await this.fileExists(repoPath, fileName)) return [fileName, repoPath];

            fileName = await this.findNextFileNameCore(repoPath, fileName);
            if (fileName === undefined) return [undefined, undefined];
        }
    }

    async getActiveRepoPath(editor?: TextEditor): Promise<string | undefined> {
        if (editor === undefined) {
            const repoPath = this.getHighlanderRepoPath();
            if (repoPath !== undefined) return repoPath;
        }

        editor = editor || window.activeTextEditor;
        if (editor === undefined) return undefined;

        const doc = await Container.tracker.getOrAdd(editor.document.uri);
        if (doc === undefined) return undefined;

        return doc.uri.repoPath;
    }

    getHighlanderRepoPath(): string | undefined {
        const entry = this._repositoryTree.highlander();
        if (entry === undefined) return undefined;

        const [repo] = entry;
        return repo.path;
    }

    async getBlameForFile(uri: GitUri): Promise<GitBlame | undefined> {
        let key = 'blame';
        if (uri.sha !== undefined) {
            key += `:${uri.sha}`;
        }

        const doc = await Container.tracker.getOrAdd(uri);
        if (this.UseCaching) {
            if (doc.state !== undefined) {
                const cachedBlame = doc.state.get<CachedBlame>(key);
                if (cachedBlame !== undefined) {
                    Logger.log(`getBlameForFile[Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);
                    return cachedBlame.item;
                }
            }

            Logger.log(`getBlameForFile[Not Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }
        else {
            Logger.log(`getBlameForFile('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);
        }

        const promise = this.getBlameForFileCore(uri, doc, key);

        if (doc.state !== undefined) {
            Logger.log(`Add blame cache for '${doc.state.key}:${key}'`);

            doc.state.set<CachedBlame>(key, {
                item: promise
            } as CachedBlame);
        }

        return promise;
    }

    private async getBlameForFileCore(uri: GitUri, document: TrackedDocument<GitDocumentState>, key: string): Promise<GitBlame | undefined> {
        if (!(await this.isTracked(uri))) {
            Logger.log(`Skipping blame; '${uri.fsPath}' is not tracked`);
            return GitService.emptyPromise as Promise<GitBlame>;
        }

        const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

        try {
            const data = await Git.blame(root, file, uri.sha, { ignoreWhitespace: Container.config.blame.ignoreWhitespace });
            const blame = GitBlameParser.parse(data, root, file);
            return blame;
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (document.state !== undefined) {
                const msg = ex && ex.toString();
                Logger.log(`Replace blame cache with empty promise for '${document.state.key}:${key}'`);

                document.state.set<CachedBlame>(key, {
                    item: GitService.emptyPromise,
                    errorMessage: msg
                } as CachedBlame);

                document.setBlameFailure();

                return GitService.emptyPromise as Promise<GitBlame>;
            }

            return undefined;
        }
    }

    async getBlameForFileContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
        const key = `blame:${Strings.sha1(contents)}`;

        const doc = await Container.tracker.getOrAdd(uri);
        if (this.UseCaching) {
            if (doc.state !== undefined) {
                const cachedBlame = doc.state.get<CachedBlame>(key);
                if (cachedBlame !== undefined) {
                    Logger.log(`getBlameForFileContents[Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);
                    return cachedBlame.item;
                }
            }

            Logger.log(`getBlameForFileContents[Not Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }
        else {
            Logger.log(`getBlameForFileContents('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}')`);
        }

        const promise = this.getBlameForFileContentsCore(uri, contents, doc, key);

        if (doc.state !== undefined) {
            Logger.log(`Add blame cache for '${doc.state.key}:${key}'`);

            doc.state.set<CachedBlame>(key, {
                item: promise
            } as CachedBlame);
        }

        return promise;
    }

    async getBlameForFileContentsCore(uri: GitUri, contents: string, document: TrackedDocument<GitDocumentState>, key: string): Promise<GitBlame | undefined> {
        if (!(await this.isTracked(uri))) {
            Logger.log(`Skipping blame; '${uri.fsPath}' is not tracked`);
            return GitService.emptyPromise as Promise<GitBlame>;
        }

        const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

        try {
            const data = await Git.blame_contents(root, file, contents, { correlationKey: `:${key}`, ignoreWhitespace: Container.config.blame.ignoreWhitespace });
            const blame = GitBlameParser.parse(data, root, file);
            return blame;
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (document.state !== undefined) {
                const msg = ex && ex.toString();
                Logger.log(`Replace blame cache with empty promise for '${document.state.key}:${key}'`);

                document.state.set<CachedBlame>(key, {
                    item: GitService.emptyPromise,
                    errorMessage: msg
                } as CachedBlame);

                document.setBlameFailure();
                return GitService.emptyPromise as Promise<GitBlame>;
            }

            return undefined;
        }
    }

    async getBlameForLine(uri: GitUri, line: number, options: { skipCache?: boolean } = {}): Promise<GitBlameLine | undefined> {
        Logger.log(`getBlameForLine('${uri.repoPath}', '${uri.fsPath}', '${uri.sha}', ${line})`);

        if (!options.skipCache && this.UseCaching) {
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
                author: { ...blame.authors.get(commit.author), lineCount: commit.lines.length },
                commit: commit,
                line: blameLine
            } as GitBlameLine;
        }

        const lineToBlame = line + 1;
        const fileName = uri.fsPath;

        try {
            const data = await Git.blame(uri.repoPath, fileName, uri.sha, { ignoreWhitespace: Container.config.blame.ignoreWhitespace, startLine: lineToBlame, endLine: lineToBlame });
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName);
            if (blame === undefined) return undefined;

            return {
                author: Iterables.first(blame.authors.values()),
                commit: Iterables.first(blame.commits.values()),
                line: blame.lines[line]
            } as GitBlameLine;
        }
        catch {
            return undefined;
        }
    }

    async getBlameForLineContents(uri: GitUri, line: number, contents: string, options: { skipCache?: boolean } = {}): Promise<GitBlameLine | undefined> {
        Logger.log(`getBlameForLineContents('${uri.repoPath}', '${uri.fsPath}', ${line})`);

        if (!options.skipCache && this.UseCaching) {
            const blame = await this.getBlameForFileContents(uri, contents);
            if (blame === undefined) return undefined;

            let blameLine = blame.lines[line];
            if (blameLine === undefined) {
                if (blame.lines.length !== line) return undefined;
                blameLine = blame.lines[line - 1];
            }

            const commit = blame.commits.get(blameLine.sha);
            if (commit === undefined) return undefined;

            return {
                author: { ...blame.authors.get(commit.author), lineCount: commit.lines.length },
                commit: commit,
                line: blameLine
            } as GitBlameLine;
        }

        const lineToBlame = line + 1;
        const fileName = uri.fsPath;

        try {
            const data = await Git.blame_contents(uri.repoPath, fileName, contents, { ignoreWhitespace: Container.config.blame.ignoreWhitespace, startLine: lineToBlame, endLine: lineToBlame });
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName);
            if (blame === undefined) return undefined;

            return {
                author: Iterables.first(blame.authors.values()),
                commit: Iterables.first(blame.commits.values()),
                line: blame.lines[line]
            } as GitBlameLine;
        }
        catch {
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

        if (blame.lines.length === 0) return { allLines: blame.lines, ...blame };

        if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
            return { allLines: blame.lines, ...blame };
        }

        const lines = blame.lines.slice(range.start.line, range.end.line + 1);
        const shas = new Set(lines.map(l => l.sha));

        const authors: Map<string, GitAuthor> = new Map();
        const commits: Map<string, GitBlameCommit> = new Map();
        for (const c of blame.commits.values()) {
            if (!shas.has(c.sha)) continue;

            const commit = c.with({ lines: c.lines.filter(l => l.line >= range.start.line && l.line <= range.end.line) });
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
        // If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
        if (data === '') {
            const current = await this.getBranch(repoPath);
            return current !== undefined ? [current] : [];
        }

        return GitBranchParser.parse(data, repoPath) || [];
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

        const doc = await Container.tracker.getOrAdd(uri);
        if (this.UseCaching) {
            if (doc.state !== undefined) {
                const cachedDiff = doc.state.get<CachedDiff>(key);
                if (cachedDiff !== undefined) {
                    Logger.log(`getDiffForFile[Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${sha1}', '${sha2}')`);
                    return cachedDiff.item;
                }
            }

            Logger.log(`getDiffForFile[Not Cached(${key})]('${uri.repoPath}', '${uri.fsPath}', '${sha1}', '${sha2}')`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }
        else {
            Logger.log(`getDiffForFile('${uri.repoPath}', '${uri.fsPath}', '${sha1}', '${sha2}')`);
        }

        const promise = this.getDiffForFileCore(uri.repoPath, uri.fsPath, sha1, sha2, { encoding: GitService.getEncoding(uri) }, doc, key);

        if (doc.state !== undefined) {
            Logger.log(`Add log cache for '${doc.state.key}:${key}'`);

            doc.state.set<CachedDiff>(key, {
                item: promise
            } as CachedDiff);
        }

        return promise;
    }

    private async getDiffForFileCore(repoPath: string | undefined, fileName: string, sha1: string | undefined, sha2: string | undefined, options: { encoding?: string }, document: TrackedDocument<GitDocumentState>, key: string): Promise<GitDiff | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            const data = await Git.diff(root, file, sha1, sha2, options);
            const diff = GitDiffParser.parse(data);
            return diff;
        }
        catch (ex) {
            // Trap and cache expected diff errors
            if (document.state !== undefined) {
                const msg = ex && ex.toString();
                Logger.log(`Replace diff cache with empty promise for '${document.state.key}:${key}'`);

                document.state.set<CachedDiff>(key, {
                    item: GitService.emptyPromise,
                    errorMessage: msg
                } as CachedDiff);

                return GitService.emptyPromise as Promise<GitDiff>;
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

    async getRecentLogCommitForFile(repoPath: string | undefined, fileName: string): Promise<GitLogCommit | undefined> {
        return this.getLogCommitForFile(repoPath, fileName, undefined);
    }

    async getRecentShaForFile(repoPath: string, fileName: string) {
        return await Git.log_recent(repoPath, fileName);
    }

    async getLogCommit(repoPath: string, ref: string): Promise<GitLogCommit | undefined> {
        Logger.log(`getLogCommit('${repoPath}', '${ref}'`);

        const log = await this.getLog(repoPath, { maxCount: 2, ref: ref });
        if (log === undefined) return undefined;

        return log.commits.get(ref);
    }

    async getLogCommitForFile(repoPath: string | undefined, fileName: string, options: { ref?: string, firstIfNotFound?: boolean } = {}): Promise<GitLogCommit | undefined> {
        Logger.log(`getFileLogCommit('${repoPath}', '${fileName}', '${options.ref}', ${options.firstIfNotFound})`);

        const log = await this.getLogForFile(repoPath, fileName, { maxCount: 2, ref: options.ref });
        if (log === undefined) return undefined;

        const commit = options.ref && log.commits.get(options.ref);
        if (commit === undefined && !options.firstIfNotFound && options.ref) {
            // If the sha isn't resolved we will never find it, so let it fall through so we return the first
            if (!Git.isResolveRequired(options.ref)) return undefined;
        }

        return commit || Iterables.first(log.commits.values());
    }

    async getLog(repoPath: string, options: { maxCount?: number, ref?: string, reverse?: boolean } = {}): Promise<GitLog | undefined> {
        options = { reverse: false, ...options };

        Logger.log(`getLog('${repoPath}', '${options.ref}', ${options.maxCount}, ${options.reverse})`);

        const maxCount = options.maxCount == null
            ? Container.config.advanced.maxListItems || 0
            : options.maxCount;

        try {
            const data = await Git.log(repoPath, { maxCount: maxCount, ref: options.ref, reverse: options.reverse });
            const log = GitLogParser.parse(data, GitCommitType.Branch, repoPath, undefined, options.ref, maxCount, options.reverse!, undefined);

            if (log !== undefined) {
                const opts = { ...options };
                log.query = (maxCount: number | undefined) => this.getLog(repoPath, { ...opts, maxCount: maxCount });
            }

            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForSearch(repoPath: string, search: string, searchBy: GitRepoSearchBy, options: { maxCount?: number } = {}): Promise<GitLog | undefined> {
        Logger.log(`getLogForSearch('${repoPath}', '${search}', '${searchBy}', ${options.maxCount})`);

        let maxCount = options.maxCount == null
            ? Container.config.advanced.maxListItems || 0
            : options.maxCount;

        let searchArgs: string[] | undefined = undefined;
        switch (searchBy) {
            case GitRepoSearchBy.Author:
                searchArgs = [`--author=${search}`];
                break;
            case GitRepoSearchBy.ChangedOccurrences:
                searchArgs = [`-S${search}`, '--pickaxe-regex'];
                break;
            case GitRepoSearchBy.Changes:
                searchArgs = [`-G${search}`];
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
            const data = await Git.log_search(repoPath, searchArgs, { maxCount: maxCount });
            const log = GitLogParser.parse(data, GitCommitType.Branch, repoPath, undefined, undefined, maxCount, false, undefined);

            if (log !== undefined) {
                const opts = { ...options };
                log.query = (maxCount: number | undefined) => this.getLogForSearch(repoPath, search, searchBy, { ...opts, maxCount: maxCount });
            }

            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForFile(repoPath: string | undefined, fileName: string, options: { maxCount?: number, range?: Range, ref?: string, renames?: boolean, reverse?: boolean } = {}): Promise<GitLog | undefined> {
        if (repoPath !== undefined && repoPath === Strings.normalizePath(fileName)) throw new Error(`File name cannot match the repository path; fileName=${fileName}`);

        options = { reverse: false, ...options };

        if (options.renames === undefined) {
            options.renames = true;
        }

        let key = 'log';
        if (options.ref !== undefined) {
            key += `:${options.ref}`;
        }
        if (options.maxCount !== undefined) {
            key += `:n${options.maxCount}`;
        }
        if (options.renames) {
            key += `:follow`;
        }

        const doc = await Container.tracker.getOrAdd(new GitUri(Uri.file(fileName), { repoPath: repoPath!, sha: options.ref }));
        if (this.UseCaching && options.range === undefined && !options.reverse) {
            if (doc.state !== undefined) {
                const cachedLog = doc.state.get<CachedLog>(key);
                if (cachedLog !== undefined) {
                    Logger.log(`getLogForFile[Cached(${key})]('${repoPath}', '${fileName}', '${options.ref}', ${options.maxCount}, undefined, ${options.renames}, ${options.reverse})`);
                    return cachedLog.item;
                }

                if (key !== 'log') {
                    // Since we are looking for partial log, see if we have the log of the whole file
                    const cachedLog = doc.state.get<CachedLog>('log');
                    if (cachedLog !== undefined) {
                        if (options.ref === undefined) {
                            Logger.log(`getLogForFile[Cached(~${key})]('${repoPath}', '${fileName}', '', ${options.maxCount}, undefined, ${options.renames}, ${options.reverse})`);
                            return cachedLog.item;
                        }

                        Logger.log(`getLogForFile[? Cache(${key})]('${repoPath}', '${fileName}', '${options.ref}', ${options.maxCount}, undefined, ${options.renames}, ${options.reverse})`);
                        const log = await cachedLog.item;
                        if (log !== undefined && log.commits.has(options.ref)) {
                            Logger.log(`getLogForFile[Cached(${key})]('${repoPath}', '${fileName}', '${options.ref}', ${options.maxCount}, undefined, ${options.renames}, ${options.reverse})`);
                            return cachedLog.item;
                        }
                    }
                }
            }

            Logger.log(`getLogForFile[Not Cached(${key})]('${repoPath}', '${fileName}', ${options.ref}, ${options.maxCount}, undefined, ${options.reverse})`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }
        else {
            Logger.log(`getLogForFile('${repoPath}', '${fileName}', ${options.ref}, ${options.maxCount}, ${options.range && `[${options.range.start.line}, ${options.range.end.line}]`}, ${options.reverse})`);
        }

        const promise = this.getLogForFileCore(repoPath, fileName, options, doc, key);

        if (doc.state !== undefined && options.range === undefined && !options.reverse) {
            Logger.log(`Add log cache for '${doc.state.key}:${key}'`);

            doc.state.set<CachedLog>(key, {
                item: promise
            } as CachedLog);
        }

        return promise;
    }

    private async getLogForFileCore(repoPath: string | undefined, fileName: string, options: { maxCount?: number, range?: Range, ref?: string, renames?: boolean, reverse?: boolean }, document: TrackedDocument<GitDocumentState>, key: string): Promise<GitLog | undefined> {
        if (!(await this.isTracked(fileName, repoPath, { ref: options.ref }))) {
            Logger.log(`Skipping log; '${fileName}' is not tracked`);
            return GitService.emptyPromise as Promise<GitLog>;
        }

        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            const { range, ...opts } = options;

            const maxCount = options.maxCount == null
                ? Container.config.advanced.maxListItems || 0
                : options.maxCount;

            const data = await Git.log_file(root, file, { ...opts, maxCount: maxCount, startLine: range && range.start.line + 1, endLine: range && range.end.line + 1 });
            const log = GitLogParser.parse(data, GitCommitType.File, root, file, opts.ref, maxCount, opts.reverse!, range);

            if (log !== undefined) {
                const opts = { ...options };
                log.query = (maxCount: number | undefined) => this.getLogForFile(repoPath, fileName, { ...opts, maxCount: maxCount });
            }

            return log;
        }
        catch (ex) {
            // Trap and cache expected log errors
            if (document.state !== undefined && options.range === undefined && !options.reverse) {
                const msg = ex && ex.toString();
                Logger.log(`Replace log cache with empty promise for '${document.state.key}:${key}'`);

                document.state.set<CachedLog>(key, {
                    item: GitService.emptyPromise,
                    errorMessage: msg
                } as CachedLog);

                return GitService.emptyPromise as Promise<GitLog>;
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

    async getMergeBase(repoPath: string, ref1: string, ref2: string, options: { forkPoint?: boolean } = {}) {
        try {
            const data = await Git.merge_base(repoPath, ref1, ref2, options);
            if (data === undefined) return undefined;

            return data.split('\n')[0];
        }
        catch (ex) {
            Logger.error(ex, 'GitService.getMergeBase');
            return undefined;
        }
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

        try {
            const data = await Git.remote(repoPath);
            return GitRemoteParser.parse(data, repoPath, RemoteProviderFactory.factory(providerMap));
        }
        catch (ex) {
            Logger.error(ex, 'GitService.getRemotesCore');
            return [];
        }
    }

    async getRepoPath(filePath: string, options?: { ref?: string }): Promise<string | undefined>;
    async getRepoPath(uri: Uri | undefined, options?: { ref?: string }): Promise<string | undefined>;
    async getRepoPath(filePathOrUri: string | Uri | undefined, options: { ref?: string } = {}): Promise<string | undefined> {
        if (filePathOrUri === undefined) return await this.getActiveRepoPath();
        if (filePathOrUri instanceof GitUri) return filePathOrUri.repoPath;

        // Don't save the tracking info to the cache, because we could be looking in the wrong place (e.g. looking in the root when the file is in a submodule)
        const repo = await this.getRepository(filePathOrUri, { ...options, skipCacheUpdate: true });
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
            const repo = new Repository(folder, rp, false, this.onAnyRepositoryChanged.bind(this), this._suspended);
            this._repositoryTree.set(rp, repo);

            // Send a notification that the repositories changed
            setImmediate(async () => {
                await this.updateContext(this._repositoryTree);

                this.fireRepositoriesChanged();
            });
        }

        return rp;
    }

    private async getRepoPathCore(filePath: string, isDirectory: boolean): Promise<string | undefined> {
        try {
            return await Git.revparse_toplevel(isDirectory ? filePath : path.dirname(filePath));
        }
        catch (ex) {
            Logger.error(ex, 'GitService.getRepoPathCore');
            return undefined;
        }
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

    async getRepository(repoPath: string, options?: { ref?: string, skipCacheUpdate?: boolean }): Promise<Repository | undefined>;
    async getRepository(uri: Uri, options?: { ref?: string, skipCacheUpdate?: boolean }): Promise<Repository | undefined>;
    async getRepository(repoPathOrUri: string | Uri, options?: { ref?: string, skipCacheUpdate?: boolean }): Promise<Repository | undefined>;
    async getRepository(repoPathOrUri: string | Uri, options: { ref?: string, skipCacheUpdate?: boolean } = {}): Promise<Repository | undefined> {
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

        // Make sure the file is tracked in this repo before returning -- it could be from a submodule
        if (!await this.isTracked(path, repo.path, options)) return undefined;
        return repo;
    }

    async getRepositoryCount(): Promise<number> {
        const repositoryTree = await this.getRepositoryTree();
        return repositoryTree.count();
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

    async getTags(repoPath: string | undefined): Promise<GitTag[]> {
        if (repoPath === undefined) return [];

        Logger.log(`getTags('${repoPath}')`);

        const data = await Git.tag(repoPath);
        return GitTagParser.parse(data, repoPath) || [];
    }

    async getVersionedFile(repoPath: string | undefined, fileName: string, sha: string | undefined) {
        Logger.log(`getVersionedFile('${repoPath}', '${fileName}', '${sha}')`);

        if (!sha || (Git.isUncommitted(sha) && !Git.isStagedUncommitted(sha))) {
            if (await this.fileExists(repoPath!, fileName)) return fileName;

            return undefined;
        }

        const file = await Git.getVersionedFile(repoPath, fileName, sha);
        if (file === undefined) return undefined;

        this._versionedUriCache.set(GitUri.toKey(file), new GitUri(Uri.file(fileName), { sha: sha, repoPath: repoPath!, versionedPath: file }));

        return file;
    }

    getVersionedFileText(repoPath: string, fileName: string, sha: string) {
        Logger.log(`getVersionedFileText('${repoPath}', '${fileName}', ${sha})`);

        return Git.show(repoPath, fileName, sha, { encoding: GitService.getEncoding(repoPath, fileName) });
    }

    getVersionedUri(uri: Uri) {
        return this._versionedUriCache.get(GitUri.toKey(uri));
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

    async isTracked(fileName: string, repoPath?: string, options?: { ref?: string, skipCacheUpdate?: boolean }): Promise<boolean>;
    async isTracked(uri: GitUri): Promise<boolean>;
    async isTracked(fileNameOrUri: string | GitUri, repoPath?: string, options: { ref?: string, skipCacheUpdate?: boolean } = {}): Promise<boolean> {
        if (options.ref === GitService.deletedSha) return false;

        let ref = options.ref;

        let cacheKey: string;
        let fileName: string;
        if (typeof fileNameOrUri === 'string') {
            [fileName, repoPath] = Git.splitPath(fileNameOrUri, repoPath);
            cacheKey = GitUri.toKey(fileNameOrUri);
        }
        else {
            if (!this.isTrackable(fileNameOrUri)) return false;

            fileName = fileNameOrUri.fsPath;
            repoPath = fileNameOrUri.repoPath;
            ref = fileNameOrUri.sha;
            cacheKey = GitUri.toKey(fileName);
        }

        if (ref !== undefined) {
            cacheKey += `:${ref}`;
        }

        Logger.log(`isTracked('${fileName}', '${repoPath}', '${ref}')`);

        let tracked = this._trackedCache.get(cacheKey);
        if (tracked !== undefined) return await tracked;

        tracked = this.isTrackedCore(fileName, repoPath === undefined ? '' : repoPath, ref);
        if (options.skipCacheUpdate) return tracked;

        this._trackedCache.set(cacheKey, tracked);
        tracked = await tracked;
        this._trackedCache.set(cacheKey, tracked);

        return tracked;
    }

    private async isTrackedCore(fileName: string, repoPath: string, ref?: string) {
        if (ref === GitService.deletedSha) return false;

        try {
            // Even if we have a sha, check first to see if the file exists (that way the cache will be better reused)
            let tracked = !!await Git.ls_files(repoPath === undefined ? '' : repoPath, fileName);
            if (!tracked && ref !== undefined) {
                tracked = !!await Git.ls_files(repoPath === undefined ? '' : repoPath, fileName, { ref: ref });
                // If we still haven't found this file, make sure it wasn't deleted in that sha (i.e. check the previous)
                if (!tracked) {
                    tracked = !!await Git.ls_files(repoPath === undefined ? '' : repoPath, fileName, { ref: `${ref}^` });
                }
            }
            return tracked;
        }
        catch (ex) {
            Logger.error(ex, 'GitService.isTrackedCore');
            return false;
        }
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

    async openDirectoryDiff(repoPath: string, ref1: string, ref2?: string, tool?: string) {
        if (!tool) {
            tool = await this.getDiffTool(repoPath);
            if (tool === undefined) throw new Error('No diff tool found');
        }

        Logger.log(`openDirectoryDiff('${repoPath}', '${ref1}', '${ref2}', '${tool}')`);

        return Git.difftool_dirDiff(repoPath, tool, ref1, ref2);
    }

    async resolveReference(repoPath: string, ref: string, uri?: Uri) {
        if (!GitService.isResolveRequired(ref)) return ref;

        Logger.log(`resolveReference('${repoPath}', '${ref}', '${uri && uri.toString()}')`);

        if (uri === undefined) return (await Git.revparse(repoPath, ref)) || ref;

        return (await Git.log_resolve(repoPath, Strings.normalizePath(path.relative(repoPath, uri.fsPath)), ref)) || ref;
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

    static isResolveRequired(sha: string): boolean {
        return Git.isResolveRequired(sha);
    }

    static isSha(sha: string): boolean {
        return Git.isSha(sha);
    }

    static isStagedUncommitted(sha: string | undefined): boolean {
        return Git.isStagedUncommitted(sha);
    }

    static isUncommitted(sha: string | undefined): boolean {
        return Git.isUncommitted(sha);
    }

    static shortenSha(sha: string | undefined, strings: { deleted?: string, stagedUncommitted?: string, uncommitted?: string } = {}) {
        if (sha === undefined) return undefined;

        strings = { deleted: '(deleted)', ...strings };

        if (sha === GitService.deletedSha) return strings.deleted;

        return Git.isSha(sha) || Git.isStagedUncommitted(sha)
            ? Git.shortenSha(sha, strings)
            : sha;
    }

    static validateGitVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = this.getGitVersion().split('.');
        return (parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor);
    }
}