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
import { ExplorerCommands } from './views/explorerCommands';
import { FileHistoryExplorer } from './views/fileHistoryExplorer';
import { LineHistoryExplorer } from './views/lineHistoryExplorer';
import { RepositoriesExplorer } from './views/repositoriesExplorer';
import { ResultsExplorer } from './views/resultsExplorer';
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

        if (config.repositoriesExplorer.enabled) {
            context.subscriptions.push((this._repositoriesExplorer = new RepositoriesExplorer()));
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('repositoriesExplorer')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push((this._repositoriesExplorer = new RepositoriesExplorer()));
                }
            });
        }

        if (config.fileHistoryExplorer.enabled) {
            context.subscriptions.push((this._fileHistoryExplorer = new FileHistoryExplorer()));
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('fileHistoryExplorer')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push((this._fileHistoryExplorer = new FileHistoryExplorer()));
                }
            });
        }

        if (config.lineHistoryExplorer.enabled) {
            context.subscriptions.push((this._lineHistoryExplorer = new LineHistoryExplorer()));
        }
        else {
            let disposable: Disposable;
            disposable = configuration.onDidChange(e => {
                if (configuration.changed(e, configuration.name('lineHistoryExplorer')('enabled').value)) {
                    disposable.dispose();
                    context.subscriptions.push((this._lineHistoryExplorer = new LineHistoryExplorer()));
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

    private static _explorerCommands: ExplorerCommands | undefined;
    static get explorerCommands() {
        if (this._explorerCommands === undefined) {
            this._context.subscriptions.push((this._explorerCommands = new ExplorerCommands()));
        }
        return this._explorerCommands;
    }

    private static _fileAnnotationController: FileAnnotationController;
    static get fileAnnotations() {
        return this._fileAnnotationController;
    }

    private static _fileHistoryExplorer: FileHistoryExplorer | undefined;
    static get fileHistoryExplorer() {
        if (this._fileHistoryExplorer === undefined) {
            this._context.subscriptions.push((this._fileHistoryExplorer = new FileHistoryExplorer()));
        }

        return this._fileHistoryExplorer;
    }

    private static _git: GitService;
    static get git() {
        return this._git;
    }

    private static _repositoriesExplorer: RepositoriesExplorer | undefined;
    static get repositoriesExplorer(): RepositoriesExplorer {
        return this._repositoriesExplorer!;
    }

    private static _keyboard: Keyboard;
    static get keyboard() {
        return this._keyboard;
    }

    private static _lineAnnotationController: LineAnnotationController;
    static get lineAnnotations() {
        return this._lineAnnotationController;
    }

    private static _lineHistoryExplorer: LineHistoryExplorer | undefined;
    static get lineHistoryExplorer() {
        if (this._lineHistoryExplorer === undefined) {
            this._context.subscriptions.push((this._lineHistoryExplorer = new LineHistoryExplorer()));
        }

        return this._lineHistoryExplorer;
    }

    private static _lineHoverController: LineHoverController;
    static get lineHovers() {
        return this._lineHoverController;
    }

    private static _lineTracker: GitLineTracker;
    static get lineTracker() {
        return this._lineTracker;
    }

    private static _resultsExplorer: ResultsExplorer | undefined;
    static get resultsExplorer() {
        if (this._resultsExplorer === undefined) {
            this._context.subscriptions.push((this._resultsExplorer = new ResultsExplorer()));
        }

        return this._resultsExplorer;
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
        if (mode.explorers != null) {
            config.repositoriesExplorer.enabled = mode.explorers;
        }
        if (mode.explorers != null) {
            config.fileHistoryExplorer.enabled = mode.explorers;
        }
        if (mode.hovers != null) {
            config.hovers.enabled = mode.hovers;
        }
        if (mode.statusBar != null) {
            config.statusBar.enabled = mode.statusBar;
        }

        return config;
    }
}
