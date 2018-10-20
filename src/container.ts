'use strict';
import { Disposable, ExtensionContext } from 'vscode';
import { FileAnnotationController } from './annotations/fileAnnotationController';
import { LineAnnotationController } from './annotations/lineAnnotationController';
import { GitCodeLensController } from './codelens/codeLensController';
import { Config, configuration } from './configuration';
import { GitFileSystemProvider } from './git/fsProvider';
import { GitService } from './git/gitService';
import { LineHoverController } from './hovers/lineHoverController';
import { Keyboard } from './keyboard';
import { StatusBarController } from './statusbar/statusBarController';
import { GitDocumentTracker } from './trackers/gitDocumentTracker';
import { GitLineTracker } from './trackers/gitLineTracker';
import { FileHistoryView } from './views/fileHistoryView';
import { LineHistoryView } from './views/lineHistoryView';
import { RepositoriesView } from './views/repositoriesView';
import { ResultsView } from './views/resultsView';
import { ViewCommands } from './views/viewCommands';
import { SettingsEditor } from './webviews/settingsEditor';
import { WelcomeEditor } from './webviews/welcomeEditor';

export class Container {
    static initialize(context: ExtensionContext, config: Config) {
        this._context = context;
        this._config = Container.applyMode(config);

        context.subscriptions.push((this._lineTracker = new GitLineTracker()));
        context.subscriptions.push((this._tracker = new GitDocumentTracker()));
        context.subscriptions.push((this._git = new GitService()));

        // Since there is a bit of a chicken & egg problem with the DocumentTracker and the GitService, initialize the tracker once the GitService is loaded
        this._tracker.initialize();

        context.subscriptions.push((this._fileAnnotationController = new FileAnnotationController()));
        context.subscriptions.push((this._lineAnnotationController = new LineAnnotationController()));
        context.subscriptions.push((this._lineHoverController = new LineHoverController()));
        context.subscriptions.push((this._statusBarController = new StatusBarController()));
        context.subscriptions.push((this._codeLensController = new GitCodeLensController()));
        context.subscriptions.push((this._keyboard = new Keyboard()));
        context.subscriptions.push((this._settingsEditor = new SettingsEditor()));
        context.subscriptions.push((this._welcomeEditor = new WelcomeEditor()));

        if (config.views.repositories.enabled) {
            context.subscriptions.push((this._repositoriesView = new RepositoriesView()));
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('views')('repositories')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push((this._repositoriesView = new RepositoriesView()));
                }
            });
        }

        if (config.views.fileHistory.enabled) {
            context.subscriptions.push((this._fileHistoryView = new FileHistoryView()));
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('views')('fileHistory')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push((this._fileHistoryView = new FileHistoryView()));
                }
            });
        }

        if (config.views.lineHistory.enabled) {
            context.subscriptions.push((this._lineHistoryView = new LineHistoryView()));
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('views')('lineHistory')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push((this._lineHistoryView = new LineHistoryView()));
                }
            });
        }

        context.subscriptions.push(new GitFileSystemProvider());
    }

    private static _codeLensController: GitCodeLensController;
    static get codeLens() {
        return this._codeLensController;
    }

    private static _config: Config | undefined;
    static get config() {
        if (this._config === undefined) {
            this._config = Container.applyMode(configuration.get<Config>());
        }
        return this._config;
    }

    private static _context: ExtensionContext;
    static get context() {
        return this._context;
    }

    private static _fileAnnotationController: FileAnnotationController;
    static get fileAnnotations() {
        return this._fileAnnotationController;
    }

    private static _fileHistoryView: FileHistoryView | undefined;
    static get fileHistoryView() {
        if (this._fileHistoryView === undefined) {
            this._context.subscriptions.push((this._fileHistoryView = new FileHistoryView()));
        }

        return this._fileHistoryView;
    }

    private static _git: GitService;
    static get git() {
        return this._git;
    }

    private static _repositoriesView: RepositoriesView | undefined;
    static get repositoriesView(): RepositoriesView {
        return this._repositoriesView!;
    }

    private static _keyboard: Keyboard;
    static get keyboard() {
        return this._keyboard;
    }

    private static _lineAnnotationController: LineAnnotationController;
    static get lineAnnotations() {
        return this._lineAnnotationController;
    }

    private static _lineHistoryView: LineHistoryView | undefined;
    static get lineHistoryView() {
        if (this._lineHistoryView === undefined) {
            this._context.subscriptions.push((this._lineHistoryView = new LineHistoryView()));
        }

        return this._lineHistoryView;
    }

    private static _lineHoverController: LineHoverController;
    static get lineHovers() {
        return this._lineHoverController;
    }

    private static _lineTracker: GitLineTracker;
    static get lineTracker() {
        return this._lineTracker;
    }

    private static _resultsView: ResultsView | undefined;
    static get resultsView() {
        if (this._resultsView === undefined) {
            this._context.subscriptions.push((this._resultsView = new ResultsView()));
        }

        return this._resultsView;
    }

    private static _settingsEditor: SettingsEditor;
    static get settingsEditor() {
        return this._settingsEditor;
    }

    private static _statusBarController: StatusBarController;
    static get statusBar() {
        return this._statusBarController;
    }

    private static _tracker: GitDocumentTracker;
    static get tracker() {
        return this._tracker;
    }

    private static _viewCommands: ViewCommands | undefined;
    static get viewCommands() {
        if (this._viewCommands === undefined) {
            this._context.subscriptions.push((this._viewCommands = new ViewCommands()));
        }
        return this._viewCommands;
    }

    private static _welcomeEditor: WelcomeEditor;
    static get welcomeEditor() {
        return this._welcomeEditor;
    }

    static resetConfig() {
        this._config = undefined;
    }

    private static applyMode(config: Config) {
        if (!config.mode.active) return config;

        const mode = config.modes[config.mode.active];
        if (mode == null) return config;

        if (mode.codeLens != null) {
            config.codeLens.enabled = mode.codeLens;
        }
        if (mode.currentLine != null) {
            config.currentLine.enabled = mode.currentLine;
        }
        if (mode.hovers != null) {
            config.hovers.enabled = mode.hovers;
        }
        if (mode.statusBar != null) {
            config.statusBar.enabled = mode.statusBar;
        }
        if (mode.views != null) {
            config.views.fileHistory.enabled = mode.views;
        }
        if (mode.views != null) {
            config.views.lineHistory.enabled = mode.views;
        }
        if (mode.views != null) {
            config.views.repositories.enabled = mode.views;
        }
        // if (mode.views != null) {
        //     config.views.results.enabled = mode.views;
        // }

        return config;
    }
}
