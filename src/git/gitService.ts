'use strict';
import * as fs from 'fs';
import * as paths from 'path';
import {
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    Extension,
    extensions,
    ProgressLocation,
    Range,
    TextEditor,
    Uri,
    window,
    WindowState,
    workspace,
    WorkspaceFolder,
    WorkspaceFoldersChangeEvent
} from 'vscode';
// eslint-disable-next-line import/no-unresolved
import { API as BuiltInGitApi, GitExtension } from '../@types/git';
import { configuration, RemotesConfig } from '../configuration';
import { CommandContext, DocumentSchemes, setCommandContext } from '../constants';
import { Container } from '../container';
import { LogCorrelationContext, Logger } from '../logger';
import { Messages } from '../messages';
import { gate, Iterables, log, Objects, Strings, TernarySearchTree, Versions } from '../system';
import { CachedBlame, CachedDiff, CachedLog, GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';
import { vslsUriPrefixRegex } from '../vsls/vsls';
import {
    CommitFormatting,
    Git,
    GitAuthor,
    GitBlame,
    GitBlameCommit,
    GitBlameLine,
    GitBlameLines,
    GitBlameParser,
    GitBranch,
    GitBranchParser,
    GitCommit,
    GitCommitType,
    GitContributor,
    GitDiff,
    GitDiffHunkLine,
    GitDiffParser,
    GitDiffShortStat,
    GitFile,
    GitLog,
    GitLogCommit,
    GitLogDiffFilter,
    GitLogParser,
    GitRemote,
    GitRemoteParser,
    GitStash,
    GitStashParser,
    GitStatus,
    GitStatusFile,
    GitStatusParser,
    GitTag,
    GitTagParser,
    GitTree,
    GitTreeParser,
    Repository,
    RepositoryChange
} from './git';
import { GitUri } from './gitUri';
import { RemoteProviderFactory, RemoteProviders } from './remotes/factory';
import { GitShortLogParser } from './parsers/parsers';

export * from './gitUri';
export * from './models/models';
export * from './formatters/formatters';
export { getNameFromRemoteResource, RemoteProvider, RemoteResource, RemoteResourceType } from './remotes/provider';
export { RemoteProviderFactory } from './remotes/factory';

const emptyStr = '';
const slash = '/';

const RepoSearchWarnings = {
    doesNotExist: /no such file or directory/i
};

const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;

export enum GitRepoSearchBy {
    Author = 'author',
    ChangedLines = 'changed-lines',
    Changes = 'changes',
    Files = 'files',
    Message = 'message',
    Sha = 'sha'
}

export class GitService implements Disposable {
    static emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
    static deletedOrMissingSha = Git.deletedOrMissingSha;
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

    private readonly _branchesCache = new Map<string, GitBranch[]>();
    private readonly _tagsCache = new Map<string, GitTag[]>();
    private readonly _tagsWithRefsCache = new Map<string, GitTag[]>();
    private readonly _trackedCache = new Map<string, boolean | Promise<boolean>>();
    private readonly _userMapCache = new Map<string, { name?: string; email?: string } | null>();

    constructor() {
        this._repositoryTree = TernarySearchTree.forPaths();

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
        this._branchesCache.clear();
        this._tagsCache.clear();
        this._tagsWithRefsCache.clear();
        this._trackedCache.clear();
        this._userMapCache.clear();

        this._disposable && this._disposable.dispose();
    }

    get useCaching() {
        return Container.config.advanced.caching.enabled;
    }

    private onAnyRepositoryChanged(repo: Repository, reason: RepositoryChange) {
        this._trackedCache.clear();

        this._branchesCache.delete(repo.path);
        this._tagsCache.delete(repo.path);
        this._tagsWithRefsCache.clear();

        if (reason === RepositoryChange.Config) {
            this._userMapCache.delete(repo.path);
        }

        if (reason === RepositoryChange.Closed) {
            // Send a notification that the repositories changed
            setImmediate(async () => {
                await this.updateContext(this._repositoryTree);

                this.fireRepositoriesChanged();
            });
        }
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (
            configuration.changed(e, configuration.name('defaultDateStyle').value) ||
            configuration.changed(e, configuration.name('defaultDateFormat').value)
        ) {
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
            };

            Logger.log(`Starting repository search in ${e.added.length} folders`);
        }

        for (const f of e.added) {
            const { scheme } = f.uri;
            if (scheme !== DocumentSchemes.File && scheme !== DocumentSchemes.Vsls) continue;

            if (scheme === DocumentSchemes.Vsls) {
                if (Container.vsls.isMaybeGuest) {
                    const guest = await Container.vsls.guest();
                    if (guest !== undefined) {
                        const repositories = await guest.getRepositoriesInFolder(
                            f,
                            this.onAnyRepositoryChanged.bind(this)
                        );
                        for (const r of repositories) {
                            this._repositoryTree.set(r.path, r);
                        }
                    }
                }
            }
            else {
                // Search for and add all repositories (nested and/or submodules)
                const repositories = await this.repositorySearch(f);
                for (const r of repositories) {
                    this._repositoryTree.set(r.path, r);
                }
            }
        }

        for (const f of e.removed) {
            const { fsPath, scheme } = f.uri;
            if (scheme !== DocumentSchemes.File && scheme !== DocumentSchemes.Vsls) continue;

            const repos = this._repositoryTree.findSuperstr(fsPath);
            const reposToDelete =
                repos !== undefined
                    ? // Since the filtered tree will have keys that are relative to the fsPath, normalize to the full path
                      [...Iterables.map<Repository, [Repository, string]>(repos, r => [r, r.path])]
                    : [];

            // const filteredTree = this._repositoryTree.findSuperstr(fsPath);
            // const reposToDelete =
            //     filteredTree !== undefined
            //         ? // Since the filtered tree will have keys that are relative to the fsPath, normalize to the full path
            //           [
            //               ...Iterables.map<[Repository, string], [Repository, string]>(
            //                   filteredTree.entries(),
            //                   ([r, k]) => [r, path.join(fsPath, k)]
            //               )
            //           ]
            //         : [];

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

    @log<GitService['repositorySearch']>({
        args: false,
        singleLine: true,
        prefix: (context, folder) => `${context.prefix}(${folder.uri.fsPath})`,
        exit: result =>
            `returned ${result.length} repositories${
                result.length !== 0 ? ` (${result.map(r => r.path).join(', ')})` : emptyStr
            }`
    })
    private async repositorySearch(folder: WorkspaceFolder): Promise<Repository[]> {
        const cc = Logger.getCorrelationContext();
        const { uri } = folder;
        const depth = configuration.get<number>(configuration.name('advanced')('repositorySearchDepth').value, uri);

        Logger.log(cc, `searching (depth=${depth})...`);

        const repositories: Repository[] = [];
        const anyRepoChangedFn = this.onAnyRepositoryChanged.bind(this);

        const rootPath = await this.getRepoPathCore(uri.fsPath, true);
        if (rootPath !== undefined) {
            Logger.log(cc, `found root repository in '${rootPath}'`);
            repositories.push(new Repository(folder, rootPath, true, anyRepoChangedFn, this._suspended));
        }

        if (depth <= 0) return repositories;

        // Get any specified excludes -- this is a total hack, but works for some simple cases and something is better than nothing :)
        let excludes = {
            ...workspace.getConfiguration('files', uri).get<{ [key: string]: boolean }>('exclude', {}),
            ...workspace.getConfiguration('search', uri).get<{ [key: string]: boolean }>('exclude', {})
        };

        const excludedPaths = [
            ...Iterables.filterMap(Objects.entries(excludes), ([key, value]) => {
                if (!value) return undefined;
                if (key.startsWith('**/')) return key.substring(3);
                return key;
            })
        ];

        excludes = excludedPaths.reduce((accumulator, current) => {
            accumulator[current] = true;
            return accumulator;
        }, Object.create(null));

        let repoPaths;
        try {
            repoPaths = await this.repositorySearchCore(uri.fsPath, depth, excludes);
        }
        catch (ex) {
            if (RepoSearchWarnings.doesNotExist.test(ex.message || emptyStr)) {
                Logger.log(cc, `FAILED${ex.message ? ` Error: ${ex.message}` : emptyStr}`);
            }
            else {
                Logger.error(ex, cc, 'FAILED');
            }

            return repositories;
        }

        for (let p of repoPaths) {
            p = paths.dirname(p);
            // If we are the same as the root, skip it
            if (Strings.normalizePath(p) === rootPath) continue;

            Logger.log(cc, `searching in '${p}'...`);

            const rp = await this.getRepoPathCore(p, true);
            if (rp === undefined) continue;

            Logger.log(cc, `found repository in '${rp}'`);
            repositories.push(new Repository(folder, rp, false, anyRepoChangedFn, this._suspended));
        }

        return repositories;
    }

    private repositorySearchCore(
        root: string,
        depth: number,
        excludes: { [key: string]: boolean },
        repositories: string[] = []
    ): Promise<string[]> {
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
                    const path = paths.resolve(root, file);

                    return new Promise<void>((resolve2, reject2) => {
                        fs.stat(path, (err, stat) => {
                            if (file === '.git') {
                                repositories.push(path);
                            }
                            else if (err == null && excludes[file] !== true && stat != null && stat.isDirectory()) {
                                folders.push(path);
                            }

                            resolve2();
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

    @log()
    async applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string) {
        const cc = Logger.getCorrelationContext();

        ref1 = ref1 || uri.sha;
        if (ref1 === undefined || uri.repoPath === undefined) return;

        if (ref2 === undefined) {
            ref2 = ref1;
            ref1 = `${ref1}^`;
        }

        let patch;
        try {
            patch = await Git.diff(uri.repoPath, uri.fsPath, ref1, ref2, {
                similarityThreshold: Container.config.advanced.similarityThreshold
            });
            void (await Git.apply(uri.repoPath!, patch));
        }
        catch (ex) {
            if (patch && /patch does not apply/i.test(ex.message)) {
                const result = await window.showWarningMessage(
                    'Unable to apply changes cleanly. Retry and allow conflicts?',
                    { title: 'Yes' },
                    { title: 'No', isCloseAffordance: true }
                );

                if (result === undefined || result.title !== 'Yes') return;

                if (result.title === 'Yes') {
                    try {
                        void (await Git.apply(uri.repoPath!, patch, { allowConflicts: true }));
                        return;
                    }
                    catch (e) {
                        // eslint-disable-next-line no-ex-assign
                        ex = e;
                    }
                }
            }

            Logger.error(ex, cc);
            void Messages.showGenericErrorMessage('Unable to apply changes');
        }
    }

    @log()
    checkout(repoPath: string, ref: string, fileName?: string) {
        return Git.checkout(repoPath, ref, fileName);
    }

    @gate()
    @log()
    fetch(repoPath: string, remote?: string) {
        return Git.fetch(repoPath, { remote: remote });
    }

    @gate()
    @log()
    async fetchAll() {
        const repositories = await this.getOrderedRepositories();
        if (repositories.length === 0) return;

        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: 'Fetching repositories',
                cancellable: true
            },
            async (progress, token) => {
                const total = repositories.length;
                for (const repo of repositories) {
                    progress.report({
                        message: `${repo.formattedName}...`,
                        increment: 100 / total
                    });

                    if (token.isCancellationRequested) break;

                    await repo.fetch({ progress: false });
                }
            }
        );
    }

    @gate()
    @log()
    async pullAll() {
        const repositories = await this.getOrderedRepositories();
        if (repositories.length === 0) return;

        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: 'Pulling repositories',
                cancellable: true
            },
            async (progress, token) => {
                const total = repositories.length;
                for (const repo of repositories) {
                    progress.report({
                        message: `${repo.formattedName}...`,
                        increment: 100 / total
                    });

                    if (token.isCancellationRequested) break;

                    await repo.pull({ progress: false });
                }
            }
        );
    }

    @gate()
    @log()
    async pushAll() {
        const repositories = await this.getOrderedRepositories();
        if (repositories.length === 0) return;

        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: 'Pushing repositories',
                cancellable: true
            },
            async (progress, token) => {
                const total = repositories.length;
                for (const repo of repositories) {
                    progress.report({
                        message: `${repo.formattedName}...`,
                        increment: 100 / total
                    });

                    if (token.isCancellationRequested) break;

                    await repo.push({ progress: false });
                }
            }
        );
    }

    async fileExists(
        repoPath: string,
        fileName: string,
        options: { ensureCase: boolean } = { ensureCase: false }
    ): Promise<boolean> {
        if (Container.vsls.isMaybeGuest) {
            const guest = await Container.vsls.guest();
            if (guest !== undefined) {
                return guest.fileExists(repoPath, fileName, options);
            }
        }

        const path = paths.resolve(repoPath, fileName);
        const exists = await new Promise<boolean>((resolve, reject) => fs.exists(path, resolve));
        if (!options.ensureCase || !exists) return exists;

        // Deal with renames in case only on case-insensative file systems
        const normalizedRepoPath = paths.normalize(repoPath);
        return this.fileExistsWithCase(path, normalizedRepoPath, normalizedRepoPath.length);
    }

    private async fileExistsWithCase(path: string, repoPath: string, repoPathLength: number): Promise<boolean> {
        const dir = paths.dirname(path);
        if (dir.length < repoPathLength) return false;
        if (dir === repoPath) return true;

        const filenames = await new Promise<string[]>((resolve, reject) =>
            fs.readdir(dir, (err: NodeJS.ErrnoException, files: string[]) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(files);
                }
            })
        );
        if (filenames.indexOf(paths.basename(path)) === -1) {
            return false;
        }
        return this.fileExistsWithCase(dir, repoPath, repoPathLength);
    }

    @log()
    async findNextCommit(repoPath: string, fileName: string, ref?: string): Promise<GitLogCommit | undefined> {
        let log = await this.getLogForFile(repoPath, fileName, { maxCount: 1, ref: ref, renames: true, reverse: true });
        let commit = log && Iterables.first(log.commits.values());
        if (commit) return commit;

        const nextFileName = await this.findNextFileName(repoPath, fileName, ref);
        if (nextFileName) {
            log = await this.getLogForFile(repoPath, nextFileName, {
                maxCount: 1,
                ref: ref,
                renames: true,
                reverse: true
            });
            commit = log && Iterables.first(log.commits.values());
        }

        return commit;
    }

    @log()
    async findNextFileName(repoPath: string | undefined, fileName: string, ref?: string): Promise<string | undefined> {
        [fileName, repoPath] = Git.splitPath(fileName, repoPath);

        return (await this.fileExists(repoPath, fileName, { ensureCase: true }))
            ? fileName
            : this.findNextFileNameCore(repoPath, fileName, ref);
    }

    private async findNextFileNameCore(repoPath: string, fileName: string, ref?: string): Promise<string | undefined> {
        if (ref === undefined) {
            // Get the most recent commit for this file name
            ref = await this.getRecentShaForFile(repoPath, fileName);
            if (ref === undefined) return undefined;
        }

        // Get the full commit (so we can see if there are any matching renames in the files)
        const log = await this.getLog(repoPath, { maxCount: 1, ref: ref });
        if (log === undefined) return undefined;

        const c = Iterables.first(log.commits.values());
        const file = c.files.find(f => f.originalFileName === fileName);
        if (file === undefined) return undefined;

        return file.fileName;
    }

    async findWorkingFileName(commit: GitCommit): Promise<[string | undefined, string | undefined]>;
    async findWorkingFileName(
        fileName: string,
        repoPath?: string,
        ref?: string
    ): Promise<[string | undefined, string | undefined]>;
    @log()
    async findWorkingFileName(
        commitOrFileName: GitCommit | string,
        repoPath?: string,
        ref?: string
    ): Promise<[string | undefined, string | undefined]> {
        let fileName;
        if (typeof commitOrFileName === 'string') {
            fileName = commitOrFileName;
            if (repoPath === undefined) {
                repoPath = await this.getRepoPath(fileName, { ref: ref });
                [fileName, repoPath] = Git.splitPath(fileName, repoPath);
            }
            else {
                fileName = Strings.normalizePath(paths.relative(repoPath, fileName));
            }
        }
        else {
            const c = commitOrFileName;
            repoPath = c.repoPath;
            if (c.workingFileName && (await this.fileExists(repoPath, c.workingFileName, { ensureCase: true }))) {
                return [c.workingFileName, repoPath];
            }
            fileName = c.fileName;
        }

        // Keep walking up to the most recent commit for a given filename, until it exists on disk
        while (true) {
            if (await this.fileExists(repoPath, fileName, { ensureCase: true })) return [fileName, repoPath];

            fileName = await this.findNextFileNameCore(repoPath, fileName);
            if (fileName === undefined) return [undefined, undefined];
        }
    }

    @log({
        args: {
            0: (editor: TextEditor) =>
                editor !== undefined ? `TextEditor(${Logger.toLoggable(editor.document.uri)})` : 'undefined'
        }
    })
    async getActiveRepoPath(editor?: TextEditor): Promise<string | undefined> {
        editor = editor || window.activeTextEditor;

        let repoPath;
        if (editor != null) {
            const doc = await Container.tracker.getOrAdd(editor.document.uri);
            if (doc !== undefined) {
                repoPath = doc.uri.repoPath;
            }
        }

        if (repoPath != null) return repoPath;

        return this.getHighlanderRepoPath();
    }

    @log()
    getHighlanderRepoPath(): string | undefined {
        const entry = this._repositoryTree.highlander();
        if (entry === undefined) return undefined;

        const [repo] = entry;
        return repo.path;
    }

    @log()
    async getBlameForFile(uri: GitUri): Promise<GitBlame | undefined> {
        const cc = Logger.getCorrelationContext();

        let key = 'blame';
        if (uri.sha !== undefined) {
            key += `:${uri.sha}`;
        }

        const doc = await Container.tracker.getOrAdd(uri);
        if (this.useCaching) {
            if (doc.state !== undefined) {
                const cachedBlame = doc.state.get<CachedBlame>(key);
                if (cachedBlame !== undefined) {
                    Logger.debug(cc, `Cache hit: '${key}'`);
                    return cachedBlame.item;
                }
            }

            Logger.debug(cc, `Cache miss: '${key}'`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }

        const promise = this.getBlameForFileCore(uri, doc, key, cc);

        if (doc.state !== undefined) {
            Logger.debug(cc, `Cache add: '${key}'`);

            const value: CachedBlame = {
                item: promise as Promise<GitBlame>
            };
            doc.state.set<CachedBlame>(key, value);
        }

        return promise;
    }

    private async getBlameForFileCore(
        uri: GitUri,
        document: TrackedDocument<GitDocumentState>,
        key: string,
        cc: LogCorrelationContext | undefined
    ): Promise<GitBlame | undefined> {
        if (!(await this.isTracked(uri))) {
            Logger.log(cc, `Skipping blame; '${uri.fsPath}' is not tracked`);
            return GitService.emptyPromise as Promise<GitBlame>;
        }

        const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

        try {
            const data = await Git.blame(root, file, uri.sha, {
                args: Container.config.advanced.blame.customArguments,
                ignoreWhitespace: Container.config.blame.ignoreWhitespace
            });
            const blame = GitBlameParser.parse(data, root, file, await this.getCurrentUser(root));
            return blame;
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (document.state !== undefined) {
                const msg = ex && ex.toString();
                Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

                const value: CachedBlame = {
                    item: GitService.emptyPromise as Promise<GitBlame>,
                    errorMessage: msg
                };
                document.state.set<CachedBlame>(key, value);

                document.setBlameFailure();

                return GitService.emptyPromise as Promise<GitBlame>;
            }

            return undefined;
        }
    }

    @log({
        args: {
            1: contents => '<contents>'
        }
    })
    async getBlameForFileContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
        const cc = Logger.getCorrelationContext();

        const key = `blame:${Strings.sha1(contents)}`;

        const doc = await Container.tracker.getOrAdd(uri);
        if (this.useCaching) {
            if (doc.state !== undefined) {
                const cachedBlame = doc.state.get<CachedBlame>(key);
                if (cachedBlame !== undefined) {
                    Logger.debug(cc, `Cache hit: ${key}`);
                    return cachedBlame.item;
                }
            }

            Logger.debug(cc, `Cache miss: ${key}`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }

        const promise = this.getBlameForFileContentsCore(uri, contents, doc, key, cc);

        if (doc.state !== undefined) {
            Logger.debug(cc, `Cache add: '${key}'`);

            const value: CachedBlame = {
                item: promise as Promise<GitBlame>
            };
            doc.state.set<CachedBlame>(key, value);
        }

        return promise;
    }

    async getBlameForFileContentsCore(
        uri: GitUri,
        contents: string,
        document: TrackedDocument<GitDocumentState>,
        key: string,
        cc: LogCorrelationContext | undefined
    ): Promise<GitBlame | undefined> {
        if (!(await this.isTracked(uri))) {
            Logger.log(cc, `Skipping blame; '${uri.fsPath}' is not tracked`);
            return GitService.emptyPromise as Promise<GitBlame>;
        }

        const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

        try {
            const data = await Git.blame_contents(root, file, contents, {
                args: Container.config.advanced.blame.customArguments,
                correlationKey: `:${key}`,
                ignoreWhitespace: Container.config.blame.ignoreWhitespace
            });
            const blame = GitBlameParser.parse(data, root, file, await this.getCurrentUser(root));
            return blame;
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (document.state !== undefined) {
                const msg = ex && ex.toString();
                Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

                const value: CachedBlame = {
                    item: GitService.emptyPromise as Promise<GitBlame>,
                    errorMessage: msg
                };
                document.state.set<CachedBlame>(key, value);

                document.setBlameFailure();
                return GitService.emptyPromise as Promise<GitBlame>;
            }

            return undefined;
        }
    }

    @log()
    async getBlameForLine(
        uri: GitUri,
        editorLine: number, // editor lines are 0-based
        options: { skipCache?: boolean } = {}
    ): Promise<GitBlameLine | undefined> {
        if (!options.skipCache && this.useCaching) {
            const blame = await this.getBlameForFile(uri);
            if (blame === undefined) return undefined;

            let blameLine = blame.lines[editorLine];
            if (blameLine === undefined) {
                if (blame.lines.length !== editorLine) return undefined;
                blameLine = blame.lines[editorLine - 1];
            }

            const commit = blame.commits.get(blameLine.sha);
            if (commit === undefined) return undefined;

            const author = blame.authors.get(commit.author)!;
            return {
                author: { ...author, lineCount: commit.lines.length },
                commit: commit,
                line: blameLine
            };
        }

        const lineToBlame = editorLine + 1;
        const fileName = uri.fsPath;

        try {
            const data = await Git.blame(uri.repoPath, fileName, uri.sha, {
                args: Container.config.advanced.blame.customArguments,
                ignoreWhitespace: Container.config.blame.ignoreWhitespace,
                startLine: lineToBlame,
                endLine: lineToBlame
            });
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName, await this.getCurrentUser(uri.repoPath!));
            if (blame === undefined) return undefined;

            return {
                author: Iterables.first(blame.authors.values()),
                commit: Iterables.first(blame.commits.values()),
                line: blame.lines[editorLine]
            };
        }
        catch {
            return undefined;
        }
    }

    @log({
        args: {
            2: contents => '<contents>'
        }
    })
    async getBlameForLineContents(
        uri: GitUri,
        editorLine: number, // editor lines are 0-based
        contents: string,
        options: { skipCache?: boolean } = {}
    ): Promise<GitBlameLine | undefined> {
        if (!options.skipCache && this.useCaching) {
            const blame = await this.getBlameForFileContents(uri, contents);
            if (blame === undefined) return undefined;

            let blameLine = blame.lines[editorLine];
            if (blameLine === undefined) {
                if (blame.lines.length !== editorLine) return undefined;
                blameLine = blame.lines[editorLine - 1];
            }

            const commit = blame.commits.get(blameLine.sha);
            if (commit === undefined) return undefined;

            const author = blame.authors.get(commit.author)!;
            return {
                author: { ...author, lineCount: commit.lines.length },
                commit: commit,
                line: blameLine
            };
        }

        const lineToBlame = editorLine + 1;
        const fileName = uri.fsPath;

        try {
            const data = await Git.blame_contents(uri.repoPath, fileName, contents, {
                args: Container.config.advanced.blame.customArguments,
                ignoreWhitespace: Container.config.blame.ignoreWhitespace,
                startLine: lineToBlame,
                endLine: lineToBlame
            });
            const currentUser = await this.getCurrentUser(uri.repoPath!);
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName, currentUser);
            if (blame === undefined) return undefined;

            return {
                author: Iterables.first(blame.authors.values()),
                commit: Iterables.first(blame.commits.values()),
                line: blame.lines[editorLine]
            };
        }
        catch {
            return undefined;
        }
    }

    @log()
    async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined> {
        const blame = await this.getBlameForFile(uri);
        if (blame === undefined) return undefined;

        return this.getBlameForRangeSync(blame, uri, range);
    }

    @log()
    async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined> {
        const blame = await this.getBlameForFileContents(uri, contents);
        if (blame === undefined) return undefined;

        return this.getBlameForRangeSync(blame, uri, range);
    }

    @log({
        args: { 0: blame => '<blame>' }
    })
    getBlameForRangeSync(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
        if (blame.lines.length === 0) return { allLines: blame.lines, ...blame };

        if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
            return { allLines: blame.lines, ...blame };
        }

        const lines = blame.lines.slice(range.start.line, range.end.line + 1);
        const shas = new Set(lines.map(l => l.sha));

        // ranges are 0-based
        const startLine = range.start.line + 1;
        const endLine = range.end.line + 1;

        const authors: Map<string, GitAuthor> = new Map();
        const commits: Map<string, GitBlameCommit> = new Map();
        for (const c of blame.commits.values()) {
            if (!shas.has(c.sha)) continue;

            const commit = c.with({
                lines: c.lines.filter(l => l.line >= startLine && l.line <= endLine)
            });
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
            repoPath: uri.repoPath!,
            authors: sortedAuthors,
            commits: commits,
            lines: lines,
            allLines: blame.lines
        };
    }

    @log()
    async getBranch(repoPath: string | undefined): Promise<GitBranch | undefined> {
        if (repoPath === undefined) return undefined;

        const data = await Git.revparse_currentBranch(repoPath);
        if (data === undefined) return undefined;

        const branch = data[0].split('\n');
        return new GitBranch(repoPath, branch[0], false, true, data[1], branch[1]);
    }

    @log()
    async getBranches(repoPath: string | undefined): Promise<GitBranch[]> {
        if (repoPath === undefined) return [];

        let branches;
        if (this.useCaching) {
            branches = this._branchesCache.get(repoPath);
            if (branches !== undefined) return branches;
        }

        const data = await Git.branch(repoPath, { all: true });
        // If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
        if (data == null || data.length === 0) {
            const current = await this.getBranch(repoPath);
            branches = current !== undefined ? [current] : [];
        }
        else {
            branches = GitBranchParser.parse(data, repoPath);
        }

        if (this.useCaching) {
            const repo = await this.getRepository(repoPath);
            if (repo !== undefined && repo.supportsChangeEvents) {
                this._branchesCache.set(repoPath, branches);
            }
        }
        return branches;
    }

    @log()
    async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
        const data = await Git.diff_shortstat(repoPath, ref);
        return GitDiffParser.parseShortStat(data);
    }

    @log()
    getConfig(key: string, repoPath?: string): Promise<string | undefined> {
        return Git.config_get(key, repoPath);
    }

    @log()
    async getContributors(repoPath: string): Promise<GitContributor[]> {
        if (repoPath === undefined) return [];

        const data = await Git.shortlog(repoPath);
        const shortlog = GitShortLogParser.parse(data, repoPath);
        return shortlog === undefined ? [] : shortlog.contributors;
    }

    @log()
    async getCurrentUser(repoPath: string) {
        let user = this._userMapCache.get(repoPath);
        if (user != null) return user;
        // If we found the repo, but no user data was found just return
        if (user === null) return undefined;

        const data = await Git.config_getRegex('user.(name|email)', repoPath, { local: true });
        if (!data) {
            // If we found no user data, mark it so we won't bother trying again
            this._userMapCache.set(repoPath, null);
            return undefined;
        }

        user = { name: undefined, email: undefined };

        let key: string;
        let value: string;
        let match: RegExpExecArray | null = null;
        do {
            match = userConfigRegex.exec(data);
            if (match == null) break;

            [, key, value] = match;
            // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
            user[key as 'name' | 'email'] = ` ${value}`.substr(1);
        } while (match != null);

        const author = `${user.name} <${user.email}>`;
        // Check if there is a mailmap for the current user
        const mappedAuthor = await Git.check_mailmap(repoPath, author);
        if (mappedAuthor != null && mappedAuthor.length !== 0 && author !== mappedAuthor) {
            match = mappedAuthorRegex.exec(mappedAuthor);
            if (match != null) {
                [, user.name, user.email] = match;
            }
        }

        this._userMapCache.set(repoPath, user);
        return user;
    }

    @log()
    async getDiffForFile(
        uri: GitUri,
        ref1: string | undefined,
        ref2?: string,
        originalFileName?: string
    ): Promise<GitDiff | undefined> {
        const cc = Logger.getCorrelationContext();

        let key = 'diff';
        if (ref1 !== undefined) {
            key += `:${ref1}`;
        }
        if (ref2 !== undefined) {
            key += `:${ref2}`;
        }

        const doc = await Container.tracker.getOrAdd(uri);
        if (this.useCaching) {
            if (doc.state !== undefined) {
                const cachedDiff = doc.state.get<CachedDiff>(key);
                if (cachedDiff !== undefined) {
                    Logger.debug(cc, `Cache hit: '${key}'`);
                    return cachedDiff.item;
                }
            }

            Logger.debug(cc, `Cache miss: '${key}'`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }

        const promise = this.getDiffForFileCore(
            uri.repoPath,
            uri.fsPath,
            ref1,
            ref2,
            originalFileName,
            { encoding: GitService.getEncoding(uri) },
            doc,
            key,
            cc
        );

        if (doc.state !== undefined) {
            Logger.debug(cc, `Cache add: '${key}'`);

            const value: CachedDiff = {
                item: promise as Promise<GitDiff>
            };
            doc.state.set<CachedDiff>(key, value);
        }

        return promise;
    }

    private async getDiffForFileCore(
        repoPath: string | undefined,
        fileName: string,
        ref1: string | undefined,
        ref2: string | undefined,
        originalFileName: string | undefined,
        options: { encoding?: string },
        document: TrackedDocument<GitDocumentState>,
        key: string,
        cc: LogCorrelationContext | undefined
    ): Promise<GitDiff | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            let data;
            if (ref1 !== undefined && ref2 === undefined && !GitService.isStagedUncommitted(ref1)) {
                data = await Git.show_diff(root, file, ref1, originalFileName, {
                    similarityThreshold: Container.config.advanced.similarityThreshold
                });
            }
            else {
                data = await Git.diff(root, file, ref1, ref2, {
                    ...options,
                    filter: 'M',
                    similarityThreshold: Container.config.advanced.similarityThreshold
                });
            }

            const diff = GitDiffParser.parse(data);
            return diff;
        }
        catch (ex) {
            // Trap and cache expected diff errors
            if (document.state !== undefined) {
                const msg = ex && ex.toString();
                Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

                const value: CachedDiff = {
                    item: GitService.emptyPromise as Promise<GitDiff>,
                    errorMessage: msg
                };
                document.state.set<CachedDiff>(key, value);

                return GitService.emptyPromise as Promise<GitDiff>;
            }

            return undefined;
        }
    }

    @log()
    async getDiffForLine(
        uri: GitUri,
        editorLine: number, // editor lines are 0-based
        ref1: string | undefined,
        ref2?: string,
        originalFileName?: string
    ): Promise<GitDiffHunkLine | undefined> {
        try {
            let diff = await this.getDiffForFile(uri, ref1, ref2, originalFileName);
            // If we didn't find a diff & ref1 is undefined (meaning uncommitted), check for a staged diff
            if (diff === undefined && ref1 === undefined) {
                diff = await this.getDiffForFile(uri, Git.stagedUncommittedSha, ref2, originalFileName);
            }

            if (diff === undefined) return undefined;

            const line = editorLine + 1;
            const hunk = diff.hunks.find(c => c.currentPosition.start <= line && c.currentPosition.end >= line);
            if (hunk === undefined) return undefined;

            return hunk.lines[line - hunk.currentPosition.start];
        }
        catch (ex) {
            return undefined;
        }
    }

    @log()
    async getDiffStatus(
        repoPath: string,
        ref1?: string,
        ref2?: string,
        options: { filter?: string; similarityThreshold?: number } = {}
    ): Promise<GitFile[] | undefined> {
        try {
            const data = await Git.diff_nameStatus(repoPath, ref1, ref2, {
                similarityThreshold: Container.config.advanced.similarityThreshold,
                ...options
            });
            const diff = GitDiffParser.parseNameStatus(data, repoPath);
            return diff;
        }
        catch (ex) {
            return undefined;
        }
    }

    @log()
    async getFileStatusForCommit(repoPath: string, fileName: string, ref: string): Promise<GitFile | undefined> {
        if (ref === GitService.deletedOrMissingSha || GitService.isUncommitted(ref)) return undefined;

        const data = await Git.show_status(repoPath, fileName, ref);
        if (!data) return undefined;

        const files = GitDiffParser.parseNameStatus(data, repoPath);
        if (files === undefined || files.length === 0) return undefined;

        return files[0];
    }

    @log()
    getRecentLogCommitForFile(repoPath: string | undefined, fileName: string): Promise<GitLogCommit | undefined> {
        return this.getLogCommitForFile(repoPath, fileName, undefined);
    }

    @log()
    getRecentShaForFile(repoPath: string, fileName: string) {
        return Git.log_recent(repoPath, fileName, {
            similarityThreshold: Container.config.advanced.similarityThreshold
        });
    }

    @log()
    async getLogCommit(repoPath: string, ref: string): Promise<GitLogCommit | undefined> {
        const log = await this.getLog(repoPath, { maxCount: 2, ref: ref });
        if (log === undefined) return undefined;

        return log.commits.get(ref);
    }

    @log()
    async getLogCommitForFile(
        repoPath: string | undefined,
        fileName: string,
        options: { ref?: string; firstIfNotFound?: boolean; reverse?: boolean } = {}
    ): Promise<GitLogCommit | undefined> {
        const log = await this.getLogForFile(repoPath, fileName, {
            maxCount: 2,
            ref: options.ref,
            reverse: options.reverse
        });
        if (log === undefined) return undefined;

        const commit = options.ref && log.commits.get(options.ref);
        if (commit === undefined && !options.firstIfNotFound && options.ref) {
            // If the ref isn't a valid sha we will never find it, so let it fall through so we return the first
            if (!Git.isSha(options.ref) || Git.isUncommitted(options.ref)) return undefined;
        }

        return commit || Iterables.first(log.commits.values());
    }

    @log()
    async getLog(
        repoPath: string,
        { ref, ...options }: { authors?: string[]; maxCount?: number; ref?: string; reverse?: boolean } = {}
    ): Promise<GitLog | undefined> {
        const maxCount = options.maxCount == null ? Container.config.advanced.maxListItems || 0 : options.maxCount;

        try {
            const data = await Git.log(repoPath, ref, {
                authors: options.authors,
                maxCount: maxCount,
                reverse: options.reverse,
                similarityThreshold: Container.config.advanced.similarityThreshold
            });
            const log = GitLogParser.parse(
                data,
                GitCommitType.Branch,
                repoPath,
                undefined,
                ref,
                await this.getCurrentUser(repoPath),
                maxCount,
                options.reverse!,
                undefined
            );

            if (log !== undefined) {
                const opts = { ...options, ref: ref };
                log.query = (maxCount: number | undefined) => this.getLog(repoPath, { ...opts, maxCount: maxCount });
            }

            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    @log()
    async getLogForSearch(
        repoPath: string,
        search: string,
        searchBy: GitRepoSearchBy,
        options: { maxCount?: number } = {}
    ): Promise<GitLog | undefined> {
        let maxCount = options.maxCount == null ? Container.config.advanced.maxListItems || 0 : options.maxCount;
        const similarityThreshold = Container.config.advanced.similarityThreshold;

        let searchArgs: string[] | undefined = undefined;
        switch (searchBy) {
            case GitRepoSearchBy.Author:
                searchArgs = [
                    '-m',
                    `-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
                    '--all',
                    '--full-history',
                    '-E',
                    '-i',
                    `--author=${search}`
                ];
                break;
            case GitRepoSearchBy.ChangedLines:
                searchArgs = [
                    `-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
                    '--all',
                    '--full-history',
                    '-E',
                    '-i',
                    `-G${search}`
                ];
                break;
            case GitRepoSearchBy.Changes:
                searchArgs = [
                    `-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
                    '--all',
                    '--full-history',
                    '-E',
                    '-i',
                    '--pickaxe-regex',
                    `-S${search}`
                ];
                break;
            case GitRepoSearchBy.Files:
                searchArgs = [
                    `-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
                    '--all',
                    '--full-history',
                    '-E',
                    '-i',
                    '--',
                    `${search}`
                ];
                break;
            case GitRepoSearchBy.Message:
                searchArgs = [
                    '-m',
                    `-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
                    '--all',
                    '--full-history',
                    '-E',
                    '-i'
                ];
                if (search) {
                    searchArgs.push(`--grep=${search}`);
                }
                break;
            case GitRepoSearchBy.Sha:
                searchArgs = ['-m', `-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`, search];
                maxCount = 1;
                break;
        }

        try {
            const data = await Git.log_search(repoPath, searchArgs, { maxCount: maxCount });
            const log = GitLogParser.parse(
                data,
                GitCommitType.Branch,
                repoPath,
                undefined,
                undefined,
                await this.getCurrentUser(repoPath),
                maxCount,
                false,
                undefined
            );

            if (log !== undefined) {
                const opts = { ...options };
                log.query = (maxCount: number | undefined) =>
                    this.getLogForSearch(repoPath, search, searchBy, { ...opts, maxCount: maxCount });
            }

            return log;
        }
        catch (ex) {
            return undefined;
        }
    }

    @log()
    async getLogForFile(
        repoPath: string | undefined,
        fileName: string,
        options: { maxCount?: number; range?: Range; ref?: string; renames?: boolean; reverse?: boolean } = {}
    ): Promise<GitLog | undefined> {
        if (repoPath !== undefined && repoPath === Strings.normalizePath(fileName)) {
            throw new Error(`File name cannot match the repository path; fileName=${fileName}`);
        }

        const cc = Logger.getCorrelationContext();

        options = { reverse: false, ...options };

        if (options.renames === undefined) {
            options.renames = Container.config.advanced.fileHistoryFollowsRenames;
        }

        let key = 'log';
        if (options.ref !== undefined) {
            key += `:${options.ref}`;
        }
        if (options.maxCount !== undefined) {
            key += `:n${options.maxCount}`;
        }
        if (options.renames) {
            key += ':follow';
        }
        if (options.reverse) {
            key += ':reverse';
        }

        const doc = await Container.tracker.getOrAdd(GitUri.fromFile(fileName, repoPath!, options.ref));
        if (this.useCaching && options.range === undefined) {
            if (doc.state !== undefined) {
                const cachedLog = doc.state.get<CachedLog>(key);
                if (cachedLog !== undefined) {
                    Logger.debug(cc, `Cache hit: '${key}'`);
                    return cachedLog.item;
                }

                if (options.ref !== undefined || options.maxCount !== undefined) {
                    // Since we are looking for partial log, see if we have the log of the whole file
                    const cachedLog = doc.state.get<CachedLog>(
                        `log${options.renames ? ':follow' : emptyStr}${options.reverse ? ':reverse' : emptyStr}`
                    );
                    if (cachedLog !== undefined) {
                        if (options.ref === undefined) {
                            Logger.debug(cc, `Cache hit: ~'${key}'`);
                            return cachedLog.item;
                        }

                        Logger.debug(cc, `Cache ?: '${key}'`);
                        let log = await cachedLog.item;
                        if (log !== undefined && !log.truncated && log.commits.has(options.ref)) {
                            Logger.debug(cc, `Cache hit: '${key}'`);

                            // Create a copy of the log starting at the requested commit
                            let skip = true;
                            let i = 0;
                            const authors = new Map<string, GitAuthor>();
                            const commits = new Map(
                                Iterables.filterMap<[string, GitLogCommit], [string, GitLogCommit]>(
                                    log.commits.entries(),
                                    ([ref, c]) => {
                                        if (skip) {
                                            if (ref !== options.ref) return undefined;
                                            skip = false;
                                        }

                                        i++;
                                        if (options.maxCount !== undefined && i > options.maxCount) {
                                            return undefined;
                                        }

                                        authors.set(c.author, log.authors.get(c.author)!);
                                        return [ref, c];
                                    }
                                )
                            );

                            const opts = { ...options };
                            log = {
                                ...log,
                                maxCount: options.maxCount,
                                count: commits.size,
                                commits: commits,
                                authors: authors,
                                query: (maxCount: number | undefined) =>
                                    this.getLogForFile(repoPath, fileName, { ...opts, maxCount: maxCount })
                            };

                            return log;
                        }
                    }
                }
            }

            Logger.debug(cc, `Cache miss: '${key}'`);

            if (doc.state === undefined) {
                doc.state = new GitDocumentState(doc.key);
            }
        }

        const promise = this.getLogForFileCore(repoPath, fileName, options, doc, key, cc);

        if (doc.state !== undefined && options.range === undefined) {
            Logger.debug(cc, `Cache add: '${key}'`);

            const value: CachedLog = {
                item: promise as Promise<GitLog>
            };
            doc.state.set<CachedLog>(key, value);
        }

        return promise;
    }

    private async getLogForFileCore(
        repoPath: string | undefined,
        fileName: string,
        {
            ref,
            range,
            ...options
        }: { maxCount?: number; range?: Range; ref?: string; renames?: boolean; reverse?: boolean },
        document: TrackedDocument<GitDocumentState>,
        key: string,
        cc: LogCorrelationContext | undefined
    ): Promise<GitLog | undefined> {
        if (!(await this.isTracked(fileName, repoPath, { ref: ref }))) {
            Logger.log(cc, `Skipping log; '${fileName}' is not tracked`);
            return GitService.emptyPromise as Promise<GitLog>;
        }

        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            if (range !== undefined && range.start.line > range.end.line) {
                range = new Range(range.end, range.start);
            }

            const maxCount = options.maxCount == null ? Container.config.advanced.maxListItems || 0 : options.maxCount;

            const data = await Git.log_file(root, file, ref, {
                ...options,
                maxCount: maxCount,
                startLine: range === undefined ? undefined : range.start.line + 1,
                endLine: range === undefined ? undefined : range.end.line + 1
            });
            const log = GitLogParser.parse(
                data,
                GitCommitType.File,
                root,
                file,
                ref,
                await this.getCurrentUser(root),
                maxCount,
                options.reverse!,
                range
            );

            if (log !== undefined) {
                const opts = { ...options, ref: ref, range: range };
                log.query = (maxCount: number | undefined) =>
                    this.getLogForFile(repoPath, fileName, { ...opts, maxCount: maxCount });
            }

            return log;
        }
        catch (ex) {
            // Trap and cache expected log errors
            if (document.state !== undefined && range === undefined && !options.reverse) {
                const msg = ex && ex.toString();
                Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

                const value: CachedLog = {
                    item: GitService.emptyPromise as Promise<GitLog>,
                    errorMessage: msg
                };
                document.state.set<CachedLog>(key, value);

                return GitService.emptyPromise as Promise<GitLog>;
            }

            return undefined;
        }
    }

    @log()
    async hasRemotes(repoPath: string | undefined): Promise<boolean> {
        if (repoPath === undefined) return false;

        const repository = await this.getRepository(repoPath);
        if (repository === undefined) return false;

        return repository.hasRemotes();
    }

    @log()
    async hasTrackingBranch(repoPath: string | undefined): Promise<boolean> {
        if (repoPath === undefined) return false;

        const repository = await this.getRepository(repoPath);
        if (repository === undefined) return false;

        return repository.hasTrackingBranch();
    }

    @log()
    async getMergeBase(repoPath: string, ref1: string, ref2: string, options: { forkPoint?: boolean } = {}) {
        const cc = Logger.getCorrelationContext();

        try {
            const data = await Git.merge_base(repoPath, ref1, ref2, options);
            if (data === undefined) return undefined;

            return data.split('\n')[0];
        }
        catch (ex) {
            Logger.error(ex, cc);
            return undefined;
        }
    }

    @log()
    async getNextDiffUris(
        repoPath: string,
        uri: Uri,
        ref: string | undefined
    ): Promise<{ current: GitUri; next: GitUri | undefined; deleted?: boolean } | undefined> {
        // If we have no ref (or staged ref) there is no next commit
        if (ref === undefined || ref.length === 0) return undefined;

        const fileName = GitUri.getRelativePath(uri, repoPath);

        if (Git.isStagedUncommitted(ref)) {
            return {
                current: GitUri.fromFile(fileName, repoPath, ref),
                next: GitUri.fromFile(fileName, repoPath, undefined)
            };
        }

        const next = await this.getNextUri(repoPath, uri, ref);
        if (next === undefined) {
            const status = await Container.git.getStatusForFile(repoPath, fileName);
            if (status !== undefined) {
                // If the file is staged, diff with the staged version
                if (status.indexStatus !== undefined) {
                    return {
                        current: GitUri.fromFile(fileName, repoPath, ref),
                        next: GitUri.fromFile(fileName, repoPath, GitService.stagedUncommittedSha)
                    };
                }
            }

            return {
                current: GitUri.fromFile(fileName, repoPath, ref),
                next: GitUri.fromFile(fileName, repoPath, undefined)
            };
        }

        return {
            current: GitUri.fromFile(fileName, repoPath, ref),
            next: next
        };
    }

    @log()
    async getNextUri(
        repoPath: string,
        uri: Uri,
        ref?: string,
        skip: number = 0
        // editorLine?: number
    ): Promise<GitUri | undefined> {
        // If we have no ref (or staged ref) there is no next commit
        if (ref === undefined || ref.length === 0 || Git.isStagedUncommitted(ref)) return undefined;

        let filters: GitLogDiffFilter[] | undefined;
        if (ref === GitService.deletedOrMissingSha) {
            // If we are trying to move next from a deleted or missing ref then get the first commit
            ref = undefined;
            filters = ['A'];
        }

        const fileName = GitUri.getRelativePath(uri, repoPath);
        let data = await Git.log_file(repoPath, fileName, ref, {
            filters: filters,
            format: GitLogParser.simpleFormat,
            maxCount: skip + 1,
            // startLine: editorLine !== undefined ? editorLine + 1 : undefined,
            reverse: true
        });
        if (data == null || data.length === 0) return undefined;

        const [nextRef, file, status] = GitLogParser.parseSimple(data, skip);
        // If the file was deleted, check for a possible rename
        if (status === 'D') {
            data = await Git.log_file(repoPath, '.', nextRef, {
                filters: ['R'],
                format: GitLogParser.simpleFormat,
                maxCount: 1
                // startLine: editorLine !== undefined ? editorLine + 1 : undefined
            });
            if (data == null || data.length === 0) {
                return GitUri.fromFile(file || fileName, repoPath, nextRef);
            }

            const [nextRenamedRef, renamedFile] = GitLogParser.parseSimpleRenamed(data, file || fileName);
            return GitUri.fromFile(
                renamedFile || file || fileName,
                repoPath,
                nextRenamedRef || nextRef || GitService.deletedOrMissingSha
            );
        }

        return GitUri.fromFile(file || fileName, repoPath, nextRef);
    }

    @log()
    async getPreviousDiffUris(
        repoPath: string,
        uri: Uri,
        ref: string | undefined,
        skip: number = 0,
        editorLine?: number
    ): Promise<{ current: GitUri; previous: GitUri | undefined } | undefined> {
        if (ref === GitService.deletedOrMissingSha) return undefined;

        const fileName = GitUri.getRelativePath(uri, repoPath);

        // If the ref is missing (i.e. working tree), check the file status to see if there is anything staged
        if ((ref === undefined || ref.length === 0) && editorLine === undefined) {
            const status = await Container.git.getStatusForFile(repoPath, fileName);
            if (status !== undefined) {
                // If the file is staged, diff with the staged version
                if (status.indexStatus !== undefined) {
                    if (skip === 0) {
                        return {
                            current: GitUri.fromFile(fileName, repoPath, ref),
                            previous: GitUri.fromFile(fileName, repoPath, GitService.stagedUncommittedSha)
                        };
                    }

                    return {
                        current: GitUri.fromFile(fileName, repoPath, GitService.stagedUncommittedSha),
                        previous: await this.getPreviousUri(repoPath, uri, ref, skip - 1, editorLine)
                    };
                }
            }
        }
        else if (GitService.isStagedUncommitted(ref)) {
            const current =
                skip === 0
                    ? GitUri.fromFile(fileName, repoPath, ref)
                    : (await this.getPreviousUri(repoPath, uri, undefined, skip - 1, editorLine))!;
            if (current.sha === GitService.deletedOrMissingSha) return undefined;

            return {
                current: current,
                previous: await this.getPreviousUri(repoPath, uri, undefined, skip, editorLine)
            };
        }

        const current =
            skip === 0
                ? GitUri.fromFile(fileName, repoPath, ref)
                : (await this.getPreviousUri(repoPath, uri, ref, skip - 1, editorLine))!;
        if (current.sha === GitService.deletedOrMissingSha) return undefined;

        return {
            current: current,
            previous: await this.getPreviousUri(repoPath, uri, ref, skip, editorLine)
        };
    }

    @log()
    async getPreviousUri(
        repoPath: string,
        uri: Uri,
        ref?: string,
        skip: number = 0,
        editorLine?: number
    ): Promise<GitUri | undefined> {
        if (ref === GitService.deletedOrMissingSha) return undefined;

        if (ref !== undefined) {
            skip++;
        }

        const fileName = GitUri.getRelativePath(uri, repoPath);
        const data = await Git.log_file(repoPath, fileName, ref, {
            format: GitLogParser.simpleFormat,
            maxCount: skip + 1,
            startLine: editorLine !== undefined ? editorLine + 1 : undefined
        });
        if (data == null || data.length === 0) throw new Error('File has no history');

        const [previousRef, file] = GitLogParser.parseSimple(data, skip);
        return GitUri.fromFile(file || fileName, repoPath, previousRef || GitService.deletedOrMissingSha);
    }

    @log()
    async getRemotes(repoPath: string | undefined, options: { includeAll?: boolean } = {}): Promise<GitRemote[]> {
        if (repoPath === undefined) return [];

        const repository = await this.getRepository(repoPath);
        const remotes = repository !== undefined ? repository.getRemotes() : this.getRemotesCore(repoPath);

        if (options.includeAll) return remotes;

        return (await remotes).filter(r => r.provider !== undefined);
    }

    async getRemotesCore(repoPath: string | undefined, providers?: RemoteProviders): Promise<GitRemote[]> {
        if (repoPath === undefined) return [];

        providers =
            providers ||
            RemoteProviderFactory.loadProviders(
                configuration.get<RemotesConfig[] | null | undefined>(configuration.name('remotes').value, null)
            );

        try {
            const data = await Git.remote(repoPath);
            return GitRemoteParser.parse(data, repoPath, RemoteProviderFactory.factory(providers));
        }
        catch (ex) {
            Logger.error(ex);
            return [];
        }
    }

    async getRepoPath(filePath: string, options?: { ref?: string }): Promise<string | undefined>;
    async getRepoPath(uri: Uri | undefined, options?: { ref?: string }): Promise<string | undefined>;
    @log<GitService['getRepoPath']>({
        exit: path => `returned ${path}`
    })
    async getRepoPath(
        filePathOrUri: string | Uri | undefined,
        options: { ref?: string } = {}
    ): Promise<string | undefined> {
        if (filePathOrUri == null) return this.getHighlanderRepoPath();
        if (filePathOrUri instanceof GitUri) return filePathOrUri.repoPath;

        const cc = Logger.getCorrelationContext();

        // Don't save the tracking info to the cache, because we could be looking in the wrong place (e.g. looking in the root when the file is in a submodule)
        let repo = await this.getRepository(filePathOrUri, { ...options, skipCacheUpdate: true });
        if (repo !== undefined) return repo.path;

        const rp = await this.getRepoPathCore(
            typeof filePathOrUri === 'string' ? filePathOrUri : filePathOrUri.fsPath,
            false
        );
        if (rp === undefined) return undefined;

        // Recheck this._repositoryTree.get(rp) to make sure we haven't already tried adding this due to awaits
        if (this._repositoryTree.get(rp) !== undefined) return rp;

        const isVslsScheme =
            typeof filePathOrUri === 'string' ? undefined : filePathOrUri.scheme === DocumentSchemes.Vsls;

        // If this new repo is inside one of our known roots and we we don't already know about, add it
        const root = this.findRepositoryForPath(this._repositoryTree, rp, isVslsScheme);

        let folder;
        if (root !== undefined) {
            // Not sure why I added this for vsls (I can't see a reason for it anymore), but if it is added it will break submodules
            // rp = root.path;
            folder = root.folder;
        }
        else {
            folder = workspace.getWorkspaceFolder(GitUri.file(rp, isVslsScheme));
            if (folder === undefined) {
                const parts = rp.split(slash);
                folder = {
                    uri: GitUri.file(rp, isVslsScheme),
                    name: parts[parts.length - 1],
                    index: this._repositoryTree.count()
                };
            }
        }

        Logger.log(cc, `Repository found in '${rp}'`);
        repo = new Repository(folder, rp, false, this.onAnyRepositoryChanged.bind(this), this._suspended);
        this._repositoryTree.set(rp, repo);

        // Send a notification that the repositories changed
        setImmediate(async () => {
            await this.updateContext(this._repositoryTree);

            this.fireRepositoriesChanged();
        });

        return rp;
    }

    private async getRepoPathCore(filePath: string, isDirectory: boolean): Promise<string | undefined> {
        try {
            return await Git.revparse_toplevel(isDirectory ? filePath : paths.dirname(filePath));
        }
        catch (ex) {
            Logger.error(ex);
            return undefined;
        }
    }

    @log()
    async getRepoPathOrActive(uri: Uri | undefined, editor: TextEditor | undefined) {
        const repoPath = await this.getRepoPath(uri);
        if (repoPath) return repoPath;

        return this.getActiveRepoPath(editor);
    }

    @log()
    async getRepositories(predicate?: (repo: Repository) => boolean): Promise<Iterable<Repository>> {
        const repositoryTree = await this.getRepositoryTree();

        const values = repositoryTree.values();
        return predicate !== undefined ? Iterables.filter(values, predicate) : values;
    }

    @log()
    async getOrderedRepositories(): Promise<Repository[]> {
        const repositories = [...(await this.getRepositories())];
        if (repositories.length === 0) return repositories;

        return repositories
            .filter(r => !r.closed)
            .sort((a, b) => (a.starred ? -1 : 1) - (b.starred ? -1 : 1) || a.index - b.index);
    }

    private async getRepositoryTree(): Promise<TernarySearchTree<Repository>> {
        if (this._repositoriesLoadingPromise !== undefined) {
            await this._repositoriesLoadingPromise;
            this._repositoriesLoadingPromise = undefined;
        }

        return this._repositoryTree;
    }

    async getRepository(
        repoPath: string,
        options?: { ref?: string; skipCacheUpdate?: boolean }
    ): Promise<Repository | undefined>;
    async getRepository(
        uri: Uri,
        options?: { ref?: string; skipCacheUpdate?: boolean }
    ): Promise<Repository | undefined>;
    async getRepository(
        repoPathOrUri: string | Uri,
        options?: { ref?: string; skipCacheUpdate?: boolean }
    ): Promise<Repository | undefined>;
    @log<GitService['getRepository']>({
        exit: repo => `returned ${repo !== undefined ? `${repo.path}` : 'undefined'}`
    })
    async getRepository(
        repoPathOrUri: string | Uri,
        options: { ref?: string; skipCacheUpdate?: boolean } = {}
    ): Promise<Repository | undefined> {
        const repositoryTree = await this.getRepositoryTree();

        let isVslsScheme;

        let path: string;
        if (typeof repoPathOrUri === 'string') {
            const repo = repositoryTree.get(repoPathOrUri);
            if (repo !== undefined) return repo;

            path = repoPathOrUri;
            isVslsScheme = undefined;
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

            isVslsScheme = repoPathOrUri.scheme === DocumentSchemes.Vsls;
        }

        const repo = this.findRepositoryForPath(repositoryTree, path, isVslsScheme);
        if (repo === undefined) return undefined;

        // Make sure the file is tracked in this repo before returning -- it could be from a submodule
        if (!(await this.isTracked(path, repo.path, options))) return undefined;
        return repo;
    }

    private findRepositoryForPath(
        repositoryTree: TernarySearchTree<Repository>,
        path: string,
        isVslsScheme: boolean | undefined
    ): Repository | undefined {
        let repo = repositoryTree.findSubstr(path);
        // If we can't find the repo and we are a guest, check if we are a "root" workspace
        if (repo === undefined && isVslsScheme !== false && Container.vsls.isMaybeGuest) {
            if (!vslsUriPrefixRegex.test(path)) {
                path = Strings.normalizePath(path);
                const vslsPath = `/~0${path[0] === slash ? path : `/${path}`}`;
                repo = repositoryTree.findSubstr(vslsPath);
            }
        }
        return repo;
    }

    async getRepositoryCount(): Promise<number> {
        const repositoryTree = await this.getRepositoryTree();
        return repositoryTree.count();
    }

    @log()
    async getStashList(repoPath: string | undefined): Promise<GitStash | undefined> {
        if (repoPath === undefined) return undefined;

        const data = await Git.stash_list(repoPath, {
            similarityThreshold: Container.config.advanced.similarityThreshold
        });
        const stash = GitStashParser.parse(data, repoPath);
        return stash;
    }

    @log()
    async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined> {
        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status_file(repoPath, fileName, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        if (status === undefined || !status.files.length) return undefined;

        return status.files[0];
    }

    @log()
    async getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined> {
        if (repoPath === undefined) return undefined;

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status(repoPath, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        return status;
    }

    @log()
    async getTags(repoPath: string | undefined, options: { includeRefs?: boolean } = {}): Promise<GitTag[]> {
        if (repoPath === undefined) return [];

        let tags;
        if (options.includeRefs) {
            tags = this._tagsWithRefsCache.get(repoPath);
            if (tags !== undefined) return tags;

            const data = await Git.showref_tag(repoPath);
            tags = GitTagParser.parseWithRef(data, repoPath) || [];

            const repo = await this.getRepository(repoPath);
            if (repo !== undefined && repo.supportsChangeEvents) {
                this._tagsWithRefsCache.set(repoPath, tags);
            }

            return tags;
        }

        tags = this._tagsCache.get(repoPath);
        if (tags !== undefined) return tags;

        const data = await Git.tag(repoPath);
        tags = GitTagParser.parse(data, repoPath) || [];

        const repo = await this.getRepository(repoPath);
        if (repo !== undefined && repo.supportsChangeEvents) {
            this._tagsCache.set(repoPath, tags);
        }

        return tags;
    }

    @log()
    async getTreeFileForRevision(repoPath: string, fileName: string, ref: string): Promise<GitTree | undefined> {
        if (repoPath === undefined || fileName == null || fileName.length === 0) return undefined;

        const data = await Git.ls_tree(repoPath, ref, { fileName: fileName });
        const trees = GitTreeParser.parse(data);
        return trees === undefined || trees.length === 0 ? undefined : trees[0];
    }

    @log()
    async getTreeForRevision(repoPath: string, ref: string): Promise<GitTree[]> {
        if (repoPath === undefined) return [];

        const data = await Git.ls_tree(repoPath, ref);
        return GitTreeParser.parse(data) || [];
    }

    @log()
    getVersionedFileBuffer(repoPath: string, fileName: string, ref: string) {
        return Git.show<Buffer>(repoPath, fileName, ref, { encoding: 'buffer' });
    }

    @log()
    async getVersionedUri(
        repoPath: string | undefined,
        fileName: string,
        ref: string | undefined
    ): Promise<Uri | undefined> {
        if (ref === GitService.deletedOrMissingSha) return undefined;

        if (!ref || (Git.isUncommitted(ref) && !Git.isStagedUncommitted(ref))) {
            if (await this.fileExists(repoPath!, fileName)) return GitUri.file(fileName);

            return undefined;
        }

        if (Git.isStagedUncommitted(ref)) {
            return GitUri.git(fileName, repoPath);
        }

        return GitUri.toRevisionUri(ref, fileName, repoPath!);
    }

    isTrackable(scheme: string): boolean;
    isTrackable(uri: Uri): boolean;
    isTrackable(schemeOruri: string | Uri): boolean {
        const scheme = typeof schemeOruri === 'string' ? schemeOruri : schemeOruri.scheme;
        return (
            scheme === DocumentSchemes.File ||
            scheme === DocumentSchemes.Vsls ||
            scheme === DocumentSchemes.Git ||
            scheme === DocumentSchemes.GitLens
        );
    }

    async isTracked(
        fileName: string,
        repoPath?: string,
        options?: { ref?: string; skipCacheUpdate?: boolean }
    ): Promise<boolean>;
    async isTracked(uri: GitUri): Promise<boolean>;
    @log<GitService['isTracked']>({
        exit: tracked => `returned ${tracked}`,
        singleLine: true
    })
    async isTracked(
        fileNameOrUri: string | GitUri,
        repoPath?: string,
        options: { ref?: string; skipCacheUpdate?: boolean } = {}
    ): Promise<boolean> {
        if (options.ref === GitService.deletedOrMissingSha) return false;

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

        let tracked = this._trackedCache.get(cacheKey);
        if (tracked !== undefined) {
            tracked = await tracked;

            return tracked;
        }

        tracked = this.isTrackedCore(fileName, repoPath === undefined ? emptyStr : repoPath, ref);
        if (options.skipCacheUpdate) {
            tracked = await tracked;

            return tracked;
        }

        this._trackedCache.set(cacheKey, tracked);
        tracked = await tracked;
        this._trackedCache.set(cacheKey, tracked);

        return tracked;
    }

    private async isTrackedCore(fileName: string, repoPath: string, ref?: string) {
        if (ref === GitService.deletedOrMissingSha) return false;

        try {
            // Even if we have a ref, check first to see if the file exists (that way the cache will be better reused)
            let tracked = Boolean(await Git.ls_files(repoPath === undefined ? emptyStr : repoPath, fileName));
            if (!tracked && ref !== undefined) {
                tracked = Boolean(
                    await Git.ls_files(repoPath === undefined ? emptyStr : repoPath, fileName, { ref: ref })
                );
                // If we still haven't found this file, make sure it wasn't deleted in that ref (i.e. check the previous)
                if (!tracked) {
                    tracked = Boolean(
                        await Git.ls_files(repoPath === undefined ? emptyStr : repoPath, fileName, {
                            ref: `${ref}^`
                        })
                    );
                }
            }
            return tracked;
        }
        catch (ex) {
            Logger.error(ex);
            return false;
        }
    }

    @log()
    async getDiffTool(repoPath?: string) {
        return (
            (await Git.config_get('diff.guitool', repoPath, { local: true })) ||
            Git.config_get('diff.tool', repoPath, { local: true })
        );
    }

    @log()
    async openDiffTool(
        repoPath: string,
        uri: Uri,
        options: { ref1?: string; ref2?: string; staged?: boolean; tool?: string } = {}
    ) {
        if (!options.tool) {
            const cc = Logger.getCorrelationContext();

            options.tool = await this.getDiffTool(repoPath);
            if (options.tool === undefined) throw new Error('No diff tool found');

            Logger.log(cc, `Using tool=${options.tool}`);
        }

        const { tool, ...opts } = options;
        return Git.difftool_fileDiff(repoPath, uri.fsPath, tool, opts);
    }

    @log()
    async openDirectoryDiff(repoPath: string, ref1: string, ref2?: string, tool?: string) {
        if (!tool) {
            const cc = Logger.getCorrelationContext();

            tool = await this.getDiffTool(repoPath);
            if (tool === undefined) throw new Error('No diff tool found');

            Logger.log(cc, `Using tool=${tool}`);
        }

        return Git.difftool_dirDiff(repoPath, tool, ref1, ref2);
    }

    @log()
    async resolveReference(repoPath: string, ref: string, uri?: Uri) {
        const resolved = Git.isSha(ref) || !Git.isShaLike(ref) || ref.endsWith('^3');
        if (uri == null) return resolved ? ref : (await Git.revparse(repoPath, ref)) || ref;

        const ensuredRef = await Git.cat_file_validate(
            repoPath,
            Strings.normalizePath(paths.relative(repoPath, uri.fsPath)),
            ref
        );
        if (ensuredRef === undefined) return ref;

        return ensuredRef;
    }

    @log()
    validateReference(repoPath: string, ref: string) {
        return Git.cat_validate(repoPath, ref);
    }

    stageFile(repoPath: string, fileName: string): Promise<string>;
    stageFile(repoPath: string, uri: Uri): Promise<string>;
    @log()
    stageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<string> {
        return Git.add(
            repoPath,
            typeof fileNameOrUri === 'string' ? fileNameOrUri : Git.splitPath(fileNameOrUri.fsPath, repoPath)[0]
        );
    }

    stageDirectory(repoPath: string, directory: string): Promise<string>;
    stageDirectory(repoPath: string, uri: Uri): Promise<string>;
    @log()
    stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<string> {
        return Git.add(
            repoPath,
            typeof directoryOrUri === 'string' ? directoryOrUri : Git.splitPath(directoryOrUri.fsPath, repoPath)[0]
        );
    }

    unStageFile(repoPath: string, fileName: string): Promise<string>;
    unStageFile(repoPath: string, uri: Uri): Promise<string>;
    @log()
    unStageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<string> {
        return Git.reset(
            repoPath,
            typeof fileNameOrUri === 'string' ? fileNameOrUri : Git.splitPath(fileNameOrUri.fsPath, repoPath)[0]
        );
    }

    unStageDirectory(repoPath: string, directory: string): Promise<string>;
    unStageDirectory(repoPath: string, uri: Uri): Promise<string>;
    @log()
    unStageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<string> {
        return Git.reset(
            repoPath,
            typeof directoryOrUri === 'string' ? directoryOrUri : Git.splitPath(directoryOrUri.fsPath, repoPath)[0]
        );
    }

    @log()
    stashApply(repoPath: string, stashName: string, deleteAfter: boolean = false) {
        return Git.stash_apply(repoPath, stashName, deleteAfter);
    }

    @log()
    stashDelete(repoPath: string, stashName: string) {
        return Git.stash_delete(repoPath, stashName);
    }

    @log()
    stashSave(repoPath: string, message?: string, uris?: Uri[]) {
        if (uris === undefined) return Git.stash_save(repoPath, message);

        GitService.ensureGitVersion('2.13.2', 'Stashing individual files');

        const pathspecs = uris.map(u => Git.splitPath(u.fsPath, repoPath)[0]);
        return Git.stash_push(repoPath, pathspecs, message);
    }

    static getEncoding(repoPath: string, fileName: string): string;
    static getEncoding(uri: Uri): string;
    static getEncoding(repoPathOrUri: string | Uri, fileName?: string): string {
        const uri = typeof repoPathOrUri === 'string' ? GitUri.resolveToUri(fileName!, repoPathOrUri) : repoPathOrUri;
        return Git.getEncoding(workspace.getConfiguration('files', uri).get<string>('encoding'));
    }

    @log()
    static async initialize(): Promise<void> {
        // Try to use the same git as the built-in vscode git extension
        let gitPath;
        const gitApi = await GitService.getBuiltInGitApi();
        if (gitApi !== undefined) {
            gitPath = gitApi.git.path;
        }

        await Git.setOrFindGitPath(gitPath || workspace.getConfiguration('git').get<string>('path'));
    }

    @log()
    static async getBuiltInGitApi(): Promise<BuiltInGitApi | undefined> {
        try {
            const extension = extensions.getExtension('vscode.git') as Extension<GitExtension>;
            if (extension !== undefined) {
                const gitExtension = extension.isActive ? extension.exports : await extension.activate();

                return gitExtension.getAPI(1);
            }
        }
        catch {}

        return undefined;
    }

    static getGitPath(): string {
        return Git.getGitPath();
    }

    static getGitVersion(): string {
        return Git.getGitVersion();
    }

    static isShaLike(ref: string): boolean {
        return Git.isShaLike(ref);
    }

    static isStagedUncommitted(ref: string | undefined): boolean {
        return Git.isStagedUncommitted(ref);
    }

    static isUncommitted(ref: string | undefined): boolean {
        return Git.isUncommitted(ref);
    }

    static shortenSha(
        ref: string | undefined,
        strings: { deletedOrMissing?: string; stagedUncommitted?: string; uncommitted?: string; working?: string } = {}
    ) {
        if (ref === undefined) return undefined;

        strings = { deletedOrMissing: '(deleted)', working: emptyStr, ...strings };

        if (ref == null || ref.length === 0) return strings.working;
        if (ref === GitService.deletedOrMissingSha) return strings.deletedOrMissing;

        return Git.isShaLike(ref) || Git.isStagedUncommitted(ref) ? Git.shortenSha(ref, strings) : ref;
    }

    static compareGitVersion(version: string) {
        return Versions.compare(Versions.fromString(this.getGitVersion()), Versions.fromString(version));
    }

    static ensureGitVersion(version: string, feature: string): void {
        const gitVersion = this.getGitVersion();
        if (Versions.compare(Versions.fromString(gitVersion), Versions.fromString(version)) === -1) {
            throw new Error(
                `${feature} requires a newer version of Git (>= ${version}) than is currently installed (${gitVersion}). Please install a more recent version of Git to use this GitLens feature.`
            );
        }
    }
}
