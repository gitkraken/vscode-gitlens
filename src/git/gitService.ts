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
import { Arrays, debug, gate, Iterables, log, Objects, Strings, TernarySearchTree, Versions } from '../system';
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
    GitCommitType,
    GitContributor,
    GitDiff,
    GitDiffHunkLine,
    GitDiffParser,
    GitDiffShortStat,
    GitErrors,
    GitFile,
    GitLog,
    GitLogCommit,
    GitLogDiffFilter,
    GitLogParser,
    GitReflog,
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
import { GitReflogParser, GitShortLogParser } from './parsers/parsers';

export * from './gitUri';
export * from './models/models';
export * from './formatters/formatters';
export * from './remotes/provider';
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
    Changes = 'changes',
    Files = 'files',
    Message = 'message',
    Sha = 'sha'
}

const emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
const reflogCommands = ['merge', 'pull'];

export class GitService implements Disposable {
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

    @log()
    static async initialize(): Promise<void> {
        // Try to use the same git as the built-in vscode git extension
        let gitPath;
        const gitApi = await GitService.getBuiltInGitApi();
        if (gitApi !== undefined) {
            gitPath = gitApi.git.path;
        }

        await Git.setOrFindGitPath(gitPath || configuration.getAny<string>('git.path'));
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
            configuration.changed(e, configuration.name('defaultDateFormat').value) ||
            configuration.changed(e, configuration.name('defaultDateSource').value) ||
            configuration.changed(e, configuration.name('defaultDateStyle').value)
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
            ...configuration.getAny<{ [key: string]: boolean }>('files.exclude', uri, {}),
            ...configuration.getAny<{ [key: string]: boolean }>('search.exclude', uri, {})
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

    @debug({
        args: {
            0: (root: string) => root,
            1: (depth: number) => `${depth}`,
            2: () => false,
            3: () => false
        }
    })
    private repositorySearchCore(
        root: string,
        depth: number,
        excludes: { [key: string]: boolean },
        repositories: string[] = []
    ): Promise<string[]> {
        const cc = Logger.getCorrelationContext();

        return new Promise<string[]>((resolve, reject) => {
            fs.readdir(root, { withFileTypes: true }, async (err, files) => {
                if (err != null) {
                    reject(err);
                    return;
                }

                if (files.length === 0) {
                    resolve(repositories);
                    return;
                }

                depth--;

                let f;
                for (f of files) {
                    if (!f.isDirectory()) continue;

                    if (f.name === '.git') {
                        repositories.push(paths.resolve(root, f.name));
                    }
                    else if (depth >= 0 && excludes[f.name] !== true) {
                        try {
                            await this.repositorySearchCore(paths.resolve(root, f.name), depth, excludes, repositories);
                        }
                        catch (ex) {
                            Logger.error(ex, cc, 'FAILED');
                        }
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
    async checkout(repoPath: string, ref: string, options: { createBranch?: string } | { fileName?: string } = {}) {
        const cc = Logger.getCorrelationContext();

        try {
            return await Git.checkout(repoPath, ref, options);
        }
        catch (ex) {
            if (/overwritten by checkout/i.test(ex.message)) {
                void Messages.showGenericErrorMessage(
                    `Unable to checkout '${ref}'. Please commit or stash your changes before switching branches`
                );
                return undefined;
            }

            Logger.error(ex, cc);
            void void Messages.showGenericErrorMessage(`Unable to checkout '${ref}'`);
            return undefined;
        }
    }

    @gate()
    @log()
    fetch(repoPath: string, options: { all?: boolean; prune?: boolean; remote?: string } = {}) {
        return Git.fetch(repoPath, options);
    }

    @gate<GitService['fetchAll']>(
        (repos, opts) => `${repos === undefined ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`
    )
    @log({
        args: {
            0: (repos?: Repository[]) => (repos === undefined ? false : repos.map(r => r.name).join(', '))
        }
    })
    async fetchAll(repositories?: Repository[], options: { all?: boolean; prune?: boolean } = {}) {
        if (repositories === undefined) {
            repositories = await this.getOrderedRepositories();
        }
        if (repositories.length === 0) return;

        if (repositories.length === 1) {
            repositories[0].fetch(options);

            return;
        }

        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Fetching ${repositories.length} repositories`
            },
            () => Promise.all(repositories!.map(r => r.fetch({ progress: false, ...options })))
        );
    }

    @gate<GitService['pullAll']>(
        (repos, opts) => `${repos === undefined ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`
    )
    @log({
        args: {
            0: (repos?: Repository[]) => (repos === undefined ? false : repos.map(r => r.name).join(', '))
        }
    })
    async pullAll(repositories?: Repository[], options: { rebase?: boolean } = {}) {
        if (repositories === undefined) {
            repositories = await this.getOrderedRepositories();
        }
        if (repositories.length === 0) return;

        if (repositories.length === 1) {
            repositories[0].pull(options);

            return;
        }

        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Pulling ${repositories.length} repositories`
            },
            () => Promise.all(repositories!.map(r => r.pull({ progress: false, ...options })))
        );
    }

    @gate<GitService['pushAll']>(repos => `${repos === undefined ? '' : repos.map(r => r.id).join(',')}`)
    @log({
        args: {
            0: (repos?: Repository[]) => (repos === undefined ? false : repos.map(r => r.name).join(', '))
        }
    })
    async pushAll(repositories?: Repository[]) {
        if (repositories === undefined) {
            repositories = await this.getOrderedRepositories();
        }
        if (repositories.length === 0) return;

        if (repositories.length === 1) {
            repositories[0].push();

            return;
        }

        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Pushing ${repositories.length} repositories`
            },
            () => Promise.all(repositories!.map(r => r.push({ progress: false })))
        );
    }

    @log({
        args: {
            0: (editor: TextEditor) =>
                editor !== undefined ? `TextEditor(${Logger.toLoggable(editor.document.uri)})` : 'undefined'
        }
    })
    async getActiveRepository(editor?: TextEditor): Promise<Repository | undefined> {
        const repoPath = await this.getActiveRepoPath(editor);
        if (repoPath === undefined) return undefined;

        return this.getRepository(repoPath);
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
            return emptyPromise as Promise<GitBlame>;
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
                    item: emptyPromise as Promise<GitBlame>,
                    errorMessage: msg
                };
                document.state.set<CachedBlame>(key, value);

                document.setBlameFailure();

                return emptyPromise as Promise<GitBlame>;
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
            return emptyPromise as Promise<GitBlame>;
        }

        const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

        try {
            const data = await Git.blame__contents(root, file, contents, {
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
                    item: emptyPromise as Promise<GitBlame>,
                    errorMessage: msg
                };
                document.state.set<CachedBlame>(key, value);

                document.setBlameFailure();
                return emptyPromise as Promise<GitBlame>;
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
            const data = await Git.blame__contents(uri.repoPath, fileName, contents, {
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

        const data = await Git.rev_parse__currentBranch(repoPath);
        if (data === undefined) return undefined;

        const branch = data[0].split('\n');
        return new GitBranch(repoPath, branch[0], false, true, data[1], branch[1]);
    }

    @log()
    async getBranches(
        repoPath: string | undefined,
        options: { filter?: (b: GitBranch) => boolean; sort?: boolean } = {}
    ): Promise<GitBranch[]> {
        if (repoPath === undefined) return [];

        let branches: GitBranch[] | undefined;
        try {
            if (this.useCaching) {
                branches = this._branchesCache.get(repoPath);
                if (branches !== undefined) return branches;
            }

            const data = await Git.for_each_ref__branch(repoPath, { all: true });
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
        finally {
            if (options.filter !== undefined) {
                branches = branches!.filter(options.filter);
            }

            if (options.sort) {
                GitBranch.sort(branches!);
            }

            if (options.filter !== undefined) {
                // eslint-disable-next-line no-unsafe-finally
                return branches!;
            }
        }
    }

    @log()
    async getBranchesAndOrTags(
        repoPath: string | undefined,
        {
            filterBranches,
            filterTags,
            include,
            ...options
        }: {
            filterBranches?: (b: GitBranch) => boolean;
            filterTags?: (t: GitTag) => boolean;
            include?: 'all' | 'branches' | 'tags';
            sort?: boolean;
        } = {}
    ) {
        const [branches, tags] = await Promise.all<GitBranch[] | undefined, GitTag[] | undefined>([
            include === 'all' || include === 'branches'
                ? Container.git.getBranches(repoPath, {
                      ...options,
                      filter: filterBranches && filterBranches
                  })
                : undefined,
            include === 'all' || include === 'tags'
                ? Container.git.getTags(repoPath, {
                      ...options,
                      filter: filterTags && filterTags
                  })
                : undefined
        ]);

        if (branches !== undefined && tags !== undefined) {
            return [...branches.filter(b => !b.remote), ...tags, ...branches.filter(b => b.remote)];
        }

        if (branches !== undefined) {
            return branches;
        }

        return tags;
    }

    @log()
    async getBranchesAndTagsTipsFn(repoPath: string | undefined, currentName?: string) {
        const [branches, tags] = await Promise.all([
            Container.git.getBranches(repoPath),
            Container.git.getTags(repoPath, { includeRefs: true })
        ]);

        const branchesAndTagsBySha = Arrays.groupByFilterMap(
            (branches as { name: string; sha: string }[]).concat(tags as { name: string; sha: string }[]),
            bt => bt.sha!,
            bt => (bt.name === currentName ? undefined : bt.name)
        );

        return (sha: string) => {
            const branchesAndTags = branchesAndTagsBySha.get(sha);
            if (branchesAndTags === undefined || branchesAndTags.length === 0) return undefined;
            return branchesAndTags.join(', ');
        };
    }

    @log()
    async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
        const data = await Git.diff__shortstat(repoPath, ref);
        return GitDiffParser.parseShortStat(data);
    }

    @log()
    async getCommit(repoPath: string, ref: string): Promise<GitLogCommit | undefined> {
        const log = await this.getLog(repoPath, { maxCount: 2, ref: ref });
        if (log === undefined) return undefined;

        return log.commits.get(ref);
    }

    @log()
    getCommitCount(repoPath: string, refs: string[]) {
        return Git.rev_list(repoPath, refs, { count: true });
    }

    @log()
    async getCommitForFile(
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
    getConfig(key: string, repoPath?: string): Promise<string | undefined> {
        return Git.config__get(key, repoPath);
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

        const data = await Git.config__get_regex('user.(name|email)', repoPath, { local: true });
        if (!data) {
            // If we found no user data, mark it so we won't bother trying again
            this._userMapCache.set(repoPath, null);
            return undefined;
        }

        user = { name: undefined, email: undefined };

        let key: string;
        let value: string;

        let match: RegExpExecArray | null;
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
            if (ref1 !== undefined && ref2 === undefined && !Git.isUncommittedStaged(ref1)) {
                data = await Git.show__diff(root, file, ref1, originalFileName, {
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
                    item: emptyPromise as Promise<GitDiff>,
                    errorMessage: msg
                };
                document.state.set<CachedDiff>(key, value);

                return emptyPromise as Promise<GitDiff>;
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
            const diff = await this.getDiffForFile(uri, ref1, ref2, originalFileName);
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
            const data = await Git.diff__name_status(repoPath, ref1, ref2, {
                similarityThreshold: Container.config.advanced.similarityThreshold,
                ...options
            });
            const files = GitDiffParser.parseNameStatus(data, repoPath);
            return files === undefined || files.length === 0 ? undefined : files;
        }
        catch (ex) {
            return undefined;
        }
    }

    @log()
    async getFileStatusForCommit(repoPath: string, fileName: string, ref: string): Promise<GitFile | undefined> {
        if (ref === GitService.deletedOrMissingSha || Git.isUncommitted(ref)) return undefined;

        const data = await Git.show__name_status(repoPath, fileName, ref);
        if (!data) return undefined;

        const files = GitDiffParser.parseNameStatus(data, repoPath);
        if (files === undefined || files.length === 0) return undefined;

        return files[0];
    }

    @log()
    async getLog(
        repoPath: string,
        {
            ref,
            ...options
        }: { authors?: string[]; maxCount?: number; merges?: boolean; ref?: string; reverse?: boolean } = {}
    ): Promise<GitLog | undefined> {
        const maxCount = options.maxCount == null ? Container.config.advanced.maxListItems || 0 : options.maxCount;

        try {
            const data = await Git.log(repoPath, ref, {
                authors: options.authors,
                maxCount: maxCount,
                merges: options.merges === undefined ? true : options.merges,
                reverse: options.reverse,
                similarityThreshold: Container.config.advanced.similarityThreshold
            });
            const log = GitLogParser.parse(
                data,
                GitCommitType.Log,
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
        let maxCount = options.maxCount == null ? Container.config.advanced.maxSearchItems || 0 : options.maxCount;
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
            case GitRepoSearchBy.Changes:
                searchArgs = [
                    `-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
                    '--all',
                    '--full-history',
                    '-E',
                    '-i',
                    `-G${search}`
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
            const data = await Git.log__search(repoPath, searchArgs, { maxCount: maxCount });
            const log = GitLogParser.parse(
                data,
                GitCommitType.Log,
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

        options.maxCount = options.maxCount == null ? Container.config.advanced.maxListItems || 0 : options.maxCount;
        if (options.maxCount) {
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
            return emptyPromise as Promise<GitLog>;
        }

        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            if (range !== undefined && range.start.line > range.end.line) {
                range = new Range(range.end, range.start);
            }

            const data = await Git.log__file(root, file, ref, {
                ...options,
                startLine: range === undefined ? undefined : range.start.line + 1,
                endLine: range === undefined ? undefined : range.end.line + 1
            });
            const log = GitLogParser.parse(
                data,
                GitCommitType.LogFile,
                root,
                file,
                ref,
                await this.getCurrentUser(root),
                options.maxCount,
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
                    item: emptyPromise as Promise<GitLog>,
                    errorMessage: msg
                };
                document.state.set<CachedLog>(key, value);

                return emptyPromise as Promise<GitLog>;
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

        const fileName = GitUri.relativeTo(uri, repoPath);

        if (Git.isUncommittedStaged(ref)) {
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
                        next: GitUri.fromFile(fileName, repoPath, GitService.uncommittedStagedSha)
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
        if (ref === undefined || ref.length === 0 || Git.isUncommittedStaged(ref)) return undefined;

        let filters: GitLogDiffFilter[] | undefined;
        if (ref === GitService.deletedOrMissingSha) {
            // If we are trying to move next from a deleted or missing ref then get the first commit
            ref = undefined;
            filters = ['A'];
        }

        const fileName = GitUri.relativeTo(uri, repoPath);
        let data = await Git.log__file(repoPath, fileName, ref, {
            filters: filters,
            maxCount: skip + 1,
            // startLine: editorLine !== undefined ? editorLine + 1 : undefined,
            reverse: true,
            simple: true
        });
        if (data == null || data.length === 0) return undefined;

        const [nextRef, file, status] = GitLogParser.parseSimple(data, skip);
        // If the file was deleted, check for a possible rename
        if (status === 'D') {
            data = await Git.log__file(repoPath, '.', nextRef, {
                filters: ['R'],
                maxCount: 1,
                // startLine: editorLine !== undefined ? editorLine + 1 : undefined
                simple: true
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
        firstParent: boolean = false
    ): Promise<{ current: GitUri; previous: GitUri | undefined } | undefined> {
        if (ref === GitService.deletedOrMissingSha) return undefined;

        const fileName = GitUri.relativeTo(uri, repoPath);

        // If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
        if (ref === undefined || ref.length === 0) {
            // First, check the file status to see if there is anything staged
            const status = await Container.git.getStatusForFile(repoPath, fileName);
            if (status !== undefined) {
                // If the file is staged with working changes, diff working with staged (index)
                // If the file is staged without working changes, diff staged with HEAD
                if (status.indexStatus !== undefined) {
                    // Backs up to get to HEAD
                    if (status.workingTreeStatus === undefined) {
                        skip++;
                    }

                    if (skip === 0) {
                        // Diff working with staged
                        return {
                            current: GitUri.fromFile(fileName, repoPath, undefined),
                            previous: GitUri.fromFile(fileName, repoPath, GitService.uncommittedStagedSha)
                        };
                    }

                    return {
                        // Diff staged with HEAD (or prior if more skips)
                        current: GitUri.fromFile(fileName, repoPath, GitService.uncommittedStagedSha),
                        previous: await this.getPreviousUri(repoPath, uri, ref, skip - 1, undefined, firstParent)
                    };
                }
                else if (status.workingTreeStatus !== undefined) {
                    if (skip === 0) {
                        return {
                            current: GitUri.fromFile(fileName, repoPath, undefined),
                            previous: await this.getPreviousUri(repoPath, uri, undefined, skip, undefined, firstParent)
                        };
                    }
                }
            }
            else if (skip === 0) {
                skip++;
            }
        }
        // If we are at the index (staged), diff staged with HEAD
        else if (GitService.isUncommittedStaged(ref)) {
            const current =
                skip === 0
                    ? GitUri.fromFile(fileName, repoPath, ref)
                    : (await this.getPreviousUri(repoPath, uri, undefined, skip - 1, undefined, firstParent))!;
            if (current === undefined || current.sha === GitService.deletedOrMissingSha) return undefined;

            return {
                current: current,
                previous: await this.getPreviousUri(repoPath, uri, undefined, skip, undefined, firstParent)
            };
        }

        // If we are at a commit, diff commit with previous
        const current =
            skip === 0
                ? GitUri.fromFile(fileName, repoPath, ref)
                : (await this.getPreviousUri(repoPath, uri, ref, skip - 1, undefined, firstParent))!;
        if (current === undefined || current.sha === GitService.deletedOrMissingSha) return undefined;

        return {
            current: current,
            previous: await this.getPreviousUri(repoPath, uri, ref, skip, undefined, firstParent)
        };
    }

    @log()
    async getPreviousLineDiffUris(
        repoPath: string,
        uri: Uri,
        editorLine: number,
        ref: string | undefined,
        skip: number = 0
    ): Promise<{ current: GitUri; previous: GitUri | undefined } | undefined> {
        if (ref === GitService.deletedOrMissingSha) return undefined;

        let fileName = GitUri.relativeTo(uri, repoPath);

        // If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
        if (ref === undefined || ref.length === 0) {
            // First, check the blame on the current line to see if there are any working/staged changes
            const gitUri = new GitUri(uri, repoPath);

            const document = await workspace.openTextDocument(uri);
            const blameLine = document.isDirty
                ? await this.getBlameForLineContents(gitUri, editorLine, document.getText())
                : await this.getBlameForLine(gitUri, editorLine);
            if (blameLine === undefined) return undefined;

            // If line is uncommitted, we need to dig deeper to figure out where to go (because blame can't be trusted)
            if (blameLine.commit.isUncommitted) {
                // If the document is dirty (unsaved), use the status to determine where to go
                if (document.isDirty) {
                    // Check the file status to see if there is anything staged
                    const status = await Container.git.getStatusForFile(repoPath, fileName);
                    if (status !== undefined) {
                        // If the file is staged, diff working with staged (index)
                        // If the file is not staged, diff working with HEAD
                        if (status.indexStatus !== undefined) {
                            // Diff working with staged
                            return {
                                current: GitUri.fromFile(fileName, repoPath, undefined),
                                previous: GitUri.fromFile(fileName, repoPath, GitService.uncommittedStagedSha)
                            };
                        }
                    }

                    // Diff working with HEAD (or prior if more skips)
                    return {
                        current: GitUri.fromFile(fileName, repoPath, undefined),
                        previous: await this.getPreviousUri(repoPath, uri, undefined, skip, editorLine)
                    };
                }

                // First, check if we have a diff in the working tree
                let hunkLine = await this.getDiffForLine(gitUri!, editorLine, undefined);
                if (hunkLine === undefined) {
                    // Next, check if we have a diff in the index (staged)
                    hunkLine = await this.getDiffForLine(
                        gitUri!,
                        editorLine,
                        undefined,
                        GitService.uncommittedStagedSha
                    );

                    if (hunkLine !== undefined) {
                        ref = GitService.uncommittedStagedSha;
                    }
                    else {
                        skip++;
                    }
                }
            }
            // If line is committed, diff with line ref with previous
            else {
                ref = blameLine.commit.sha;
                fileName = blameLine.commit.fileName || blameLine.commit.originalFileName || fileName;
                uri = GitUri.resolveToUri(fileName, repoPath);
                editorLine = blameLine.line.originalLine - 1;
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
        else if (GitService.isUncommittedStaged(ref)) {
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
        editorLine?: number,
        firstParent: boolean = false
    ): Promise<GitUri | undefined> {
        if (ref === GitService.deletedOrMissingSha) return undefined;

        const cc = Logger.getCorrelationContext();

        if (ref === GitService.uncommittedSha) {
            ref = undefined;
        }

        const fileName = GitUri.relativeTo(uri, repoPath);
        // TODO: Add caching
        let data;
        try {
            data = await Git.log__file(repoPath, fileName, ref, {
                maxCount: skip + 2,
                firstParent: firstParent,
                simple: true,
                startLine: editorLine !== undefined ? editorLine + 1 : undefined
            });
        }
        catch (ex) {
            // If the line count is invalid just fallback to the most recent commit
            if (
                (ref === undefined || GitService.isUncommittedStaged(ref)) &&
                GitErrors.invalidLineCount.test(ex.message)
            ) {
                if (ref === undefined) {
                    const status = await Container.git.getStatusForFile(repoPath, fileName);
                    if (status !== undefined && status.indexStatus !== undefined) {
                        return GitUri.fromFile(fileName, repoPath, GitService.uncommittedStagedSha);
                    }
                }

                ref = await Git.log__file_recent(repoPath, fileName);
                return GitUri.fromFile(fileName, repoPath, ref || GitService.deletedOrMissingSha);
            }

            Logger.error(ex, cc);
            throw ex;
        }
        if (data == null || data.length === 0) return undefined;

        const [previousRef, file] = GitLogParser.parseSimple(data, skip, ref);
        // If the previous ref matches the ref we asked for assume we are at the end of the history
        if (ref !== undefined && ref === previousRef) return undefined;

        return GitUri.fromFile(file || fileName, repoPath, previousRef || GitService.deletedOrMissingSha);
    }

    @log()
    async getIncomingActivity(
        repoPath: string,
        { maxCount, ...options }: { all?: boolean; branch?: string; maxCount?: number; since?: string } = {}
    ): Promise<GitReflog | undefined> {
        const cc = Logger.getCorrelationContext();

        try {
            const data = await Git.reflog(repoPath, options);
            if (data === undefined) return undefined;

            const reflog = GitReflogParser.parse(
                data,
                repoPath,
                reflogCommands,
                maxCount == null ? Container.config.advanced.maxListItems || 0 : maxCount
            );

            return reflog;
        }
        catch (ex) {
            Logger.error(ex, cc);
            return undefined;
        }
    }

    @log()
    async getRemotes(
        repoPath: string | undefined,
        options: { includeAll?: boolean; sort?: boolean } = {}
    ): Promise<GitRemote[]> {
        if (repoPath === undefined) return [];

        const repository = await this.getRepository(repoPath);
        const remotes = await (repository !== undefined
            ? repository.getRemotes({ sort: options.sort })
            : this.getRemotesCore(repoPath, undefined, { sort: options.sort }));

        if (options.includeAll) return remotes;

        return remotes.filter(r => r.provider !== undefined);
    }

    async getRemotesCore(
        repoPath: string | undefined,
        providers?: RemoteProviders,
        options: { sort?: boolean } = {}
    ): Promise<GitRemote[]> {
        if (repoPath === undefined) return [];

        providers =
            providers ||
            RemoteProviderFactory.loadProviders(
                configuration.get<RemotesConfig[] | null | undefined>(configuration.name('remotes').value, null)
            );

        try {
            const data = await Git.remote(repoPath);
            const remotes = GitRemoteParser.parse(data, repoPath, RemoteProviderFactory.factory(providers));
            if (remotes === undefined) return [];

            if (options.sort) {
                GitRemote.sort(remotes);
            }

            return remotes;
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
        if (GitUri.is(filePathOrUri)) return filePathOrUri.repoPath;

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
            return await Git.rev_parse__show_toplevel(isDirectory ? filePath : paths.dirname(filePath));
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

        return Repository.sort(repositories.filter(r => !r.closed));
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
            if (GitUri.is(repoPathOrUri)) {
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

        const data = await Git.stash__list(repoPath, {
            similarityThreshold: Container.config.advanced.similarityThreshold
        });
        const stash = GitStashParser.parse(data, repoPath);
        return stash;
    }

    @log()
    async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined> {
        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status__file(repoPath, fileName, porcelainVersion, {
            similarityThreshold: Container.config.advanced.similarityThreshold
        });
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        if (status === undefined || !status.files.length) return undefined;

        return status.files[0];
    }

    @log()
    async getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined> {
        if (repoPath === undefined) return undefined;

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status(repoPath, porcelainVersion, {
            similarityThreshold: Container.config.advanced.similarityThreshold
        });
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        return status;
    }

    @log()
    async getTags(
        repoPath: string | undefined,
        options: { filter?: (t: GitTag) => boolean; includeRefs?: boolean; sort?: boolean } = {}
    ): Promise<GitTag[]> {
        if (repoPath === undefined) return [];

        let tags: GitTag[] | undefined;
        try {
            if (options.includeRefs) {
                tags = this._tagsWithRefsCache.get(repoPath);
                if (tags !== undefined) return tags;

                const data = await Git.show_ref__tags(repoPath);
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
        finally {
            if (options.filter !== undefined) {
                tags = tags!.filter(options.filter);
            }

            if (options.sort) {
                GitTag.sort(tags!);
            }

            if (options.filter !== undefined) {
                // eslint-disable-next-line no-unsafe-finally
                return tags!;
            }
        }
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

        if (ref == null || ref.length === 0 || (Git.isUncommitted(ref) && !Git.isUncommittedStaged(ref))) {
            // Make sure the file exists in the repo
            let data = await Git.ls_files(repoPath!, fileName);
            if (data !== undefined) return GitUri.file(fileName);

            // Check if the file exists untracked
            data = await Git.ls_files(repoPath!, fileName, { untracked: true });
            if (data !== undefined) return GitUri.file(fileName);

            return undefined;
        }

        if (Git.isUncommittedStaged(ref)) {
            return GitUri.git(fileName, repoPath);
        }

        return GitUri.toRevisionUri(ref, fileName, repoPath!);
    }

    @log()
    async getWorkingUri(repoPath: string, uri: Uri) {
        let fileName = GitUri.relativeTo(uri, repoPath);

        let data;
        let ref;
        do {
            data = await Git.ls_files(repoPath, fileName);
            if (data !== undefined) {
                return GitUri.resolveToUri(data, repoPath);
            }

            // TODO: Add caching
            // Get the most recent commit for this file name
            ref = await Git.log__file_recent(repoPath, fileName, {
                similarityThreshold: Container.config.advanced.similarityThreshold
            });
            if (ref === undefined) return undefined;

            // Now check if that commit had any renames
            data = await Git.log__file(repoPath, '.', ref, {
                filters: ['R'],
                maxCount: 1,
                simple: true
            });
            if (data == null || data.length === 0) {
                return GitUri.resolveToUri(fileName, repoPath);
            }

            const [renamedRef, renamedFile] = GitLogParser.parseSimpleRenamed(data, fileName);
            if (renamedRef === undefined || renamedFile === undefined) {
                return GitUri.resolveToUri(fileName, repoPath);
            }

            ref = renamedRef;
            fileName = renamedFile;
        } while (true);
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
            (await Git.config__get('diff.guitool', repoPath, { local: true })) ||
            Git.config__get('diff.tool', repoPath, { local: true })
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
        return Git.difftool(repoPath, uri.fsPath, tool, opts);
    }

    @log()
    async openDirectoryDiff(repoPath: string, ref1: string, ref2?: string, tool?: string) {
        if (!tool) {
            const cc = Logger.getCorrelationContext();

            tool = await this.getDiffTool(repoPath);
            if (tool === undefined) throw new Error('No diff tool found');

            Logger.log(cc, `Using tool=${tool}`);
        }

        return Git.difftool__dir_diff(repoPath, tool, ref1, ref2);
    }

    @log()
    async resolveReference(repoPath: string, ref: string, uri?: Uri) {
        if (ref == null || ref.length === 0 || ref === GitService.deletedOrMissingSha) return ref;

        if (uri == null) {
            if (Git.isSha(ref) || !Git.isShaLike(ref) || ref.endsWith('^3')) return ref;

            return (await Git.rev_parse(repoPath, ref)) || ref;
        }

        const match = Git.shaParentRegex.exec(ref);
        if (match != null) {
            const previousUri = await Container.git.getPreviousUri(repoPath, uri, match[1]);
            if (previousUri !== undefined && previousUri.sha !== undefined) {
                return previousUri.sha;
            }
        }

        const ensuredRef = await Git.cat_file__resolve(
            repoPath,
            Strings.normalizePath(paths.relative(repoPath, uri.fsPath)),
            ref
        );
        if (ensuredRef === undefined) return ref;

        return ensuredRef;
    }

    @log()
    validateReference(repoPath: string, ref: string) {
        return Git.cat_file__validate(repoPath, ref);
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
        return Git.stash__apply(repoPath, stashName, deleteAfter);
    }

    @log()
    stashDelete(repoPath: string, stashName: string) {
        return Git.stash__delete(repoPath, stashName);
    }

    @log()
    stashSave(repoPath: string, message?: string, uris?: Uri[]) {
        if (uris === undefined) return Git.stash__save(repoPath, message);

        GitService.ensureGitVersion('2.13.2', 'Stashing individual files');

        const pathspecs = uris.map(u => Git.splitPath(u.fsPath, repoPath)[0]);
        return Git.stash__push(repoPath, pathspecs, message);
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

    static getEncoding(repoPath: string, fileName: string): string;
    static getEncoding(uri: Uri): string;
    static getEncoding(repoPathOrUri: string | Uri, fileName?: string): string {
        const uri = typeof repoPathOrUri === 'string' ? GitUri.resolveToUri(fileName!, repoPathOrUri) : repoPathOrUri;
        return Git.getEncoding(configuration.getAny<string>('files.encoding', uri));
    }

    static deletedOrMissingSha = Git.deletedOrMissingSha;
    static getGitPath = Git.getGitPath;
    static getGitVersion = Git.getGitVersion;
    static isSha = Git.isSha;
    static isShaLike = Git.isShaLike;
    static isShaParent = Git.isShaParent;
    static isUncommitted = Git.isUncommitted;
    static isUncommittedStaged = Git.isUncommittedStaged;
    static uncommittedSha = Git.uncommittedSha;
    static uncommittedStagedSha = Git.uncommittedStagedSha;

    static shortenSha(
        ref: string | undefined,
        {
            deletedOrMissing = '(deleted)',
            ...strings
        }: { deletedOrMissing?: string; uncommitted?: string; uncommittedStaged?: string; working?: string } = {}
    ) {
        if (ref === GitService.deletedOrMissingSha) return deletedOrMissing;

        return Git.shortenSha(ref, strings);
    }
}
