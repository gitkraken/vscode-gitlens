'use strict';
import { Disposable, ExtensionContext, languages, workspace } from 'vscode';
import { FileAnnotationController } from './annotations/fileAnnotationController';
import { CodeLensController } from './codeLensController';
import { configuration, IConfig } from './configuration';
import { LineAnnotationController } from './annotations/lineAnnotationController';
import { LineHoverController } from './annotations/lineHoverController';
import { ExplorerCommands } from './views/explorerCommands';
import { GitContentProvider } from './gitContentProvider';
import { GitDocumentTracker } from './trackers/gitDocumentTracker';
import { GitExplorer } from './views/gitExplorer';
import { GitLineTracker } from './trackers/gitLineTracker';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { GitService } from './gitService';
import { HistoryExplorer } from './views/historyExplorer';
import { Keyboard } from './keyboard';
import { PageProvider } from './pageProvider';
import { ResultsExplorer } from './views/resultsExplorer';
import { StatusBarController } from './statusBarController';

export class Container {

    static initialize(context: ExtensionContext, config: IConfig) {
        this._context = context;
        this._config = config;

        context.subscriptions.push(this._lineTracker = new GitLineTracker());
        context.subscriptions.push(this._tracker = new GitDocumentTracker());
        context.subscriptions.push(this._git = new GitService());

        // Since there is a bit of a chicken & egg problem with the DocumentTracker and the GitService, initialize the tracker once the GitService is loaded
        this._tracker.initialize();

        context.subscriptions.push(this._fileAnnotationController = new FileAnnotationController());
        context.subscriptions.push(this._lineAnnotationController = new LineAnnotationController());
        context.subscriptions.push(this._lineHoverController = new LineHoverController());
        context.subscriptions.push(this._statusBarController = new StatusBarController());
        context.subscriptions.push(this._codeLensController = new CodeLensController());
        context.subscriptions.push(this._keyboard = new Keyboard());
        context.subscriptions.push(this._pageProvider = new PageProvider());

        if (config.gitExplorer.enabled) {
            context.subscriptions.push(this._gitExplorer = new GitExplorer());
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('gitExplorer')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push(this._gitExplorer = new GitExplorer());
                }
            });
        }

        if (config.historyExplorer.enabled) {
            context.subscriptions.push(this._historyExplorer = new HistoryExplorer());
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('historyExplorer')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push(this._historyExplorer = new HistoryExplorer());
                }
            });
        }

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider()));
        context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider()));
    }

    private static _codeLensController: CodeLensController;
    static get codeLens() {
        return this._codeLensController;
    }

    private static _config: IConfig | undefined;
    static get config() {
        if (this._config === undefined) {
            this._config = configuration.get<IConfig>();
        }
        return this._config;
    }

    private static _context: ExtensionContext;
    static get context() {
        return this._context;
    }

    private static _explorerCommands: ExplorerCommands | undefined;
    static get explorerCommands() {
        if (this._explorerCommands === undefined) {
            this._context.subscriptions.push(this._explorerCommands = new ExplorerCommands());
        }
        return this._explorerCommands;
    }

    private static _fileAnnotationController: FileAnnotationController;
    static get fileAnnotations() {
        return this._fileAnnotationController;
    }

    private static _git: GitService;
    static get git() {
        return this._git;
    }

    private static _gitExplorer: GitExplorer | undefined;
    static get gitExplorer(): GitExplorer {
        return this._gitExplorer!;
    }

    private static _historyExplorer: HistoryExplorer | undefined;
    static get historyExplorer() {
        if (this._historyExplorer === undefined) {
            this._context.subscriptions.push(this._historyExplorer = new HistoryExplorer());
        }

        return this._historyExplorer;
    }

    private static _keyboard: Keyboard;
    static get keyboard() {
        return this._keyboard;
    }

    private static _lineAnnotationController: LineAnnotationController;
    static get lineAnnotations() {
        return this._lineAnnotationController;
    }

    private static _lineHoverController: LineHoverController;
    static get lineHovers() {
        return this._lineHoverController;
    }

    private static _lineTracker: GitLineTracker;
    static get lineTracker() {
        return this._lineTracker;
    }

    private static _pageProvider: PageProvider;
    static get pages() {
        return this._pageProvider;
    }

    private static _resultsExplorer: ResultsExplorer | undefined;
    static get resultsExplorer() {
        if (this._resultsExplorer === undefined) {
            this._context.subscriptions.push(this._resultsExplorer = new ResultsExplorer());
        }

        return this._resultsExplorer;
    }

    private static _statusBarController: StatusBarController;
    static get statusBar() {
        return this._statusBarController;
    }

    private static _tracker: GitDocumentTracker;
    static get tracker() {
        return this._tracker;
    }

    static resetConfig() {
        this._config = undefined;
    }
}
