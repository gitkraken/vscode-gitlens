'use strict';
import { Disposable, ExtensionContext, languages, workspace } from 'vscode';
import { AnnotationController } from './annotations/annotationController';
import { CodeLensController } from './codeLensController';
import { configuration, IConfig } from './configuration';
import { CurrentLineController } from './currentLineController';
import { DocumentTracker, GitDocumentState } from './trackers/documentTracker';
import { ExplorerCommands } from './views/explorerCommands';
import { GitContentProvider } from './gitContentProvider';
import { GitExplorer } from './views/gitExplorer';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { GitService } from './gitService';
import { Keyboard } from './keyboard';
import { ResultsExplorer } from './views/resultsExplorer';

export class Container {

    static initialize(context: ExtensionContext, config: IConfig) {
        this._context = context;
        this._config = config;

        context.subscriptions.push(this._tracker = new DocumentTracker<GitDocumentState>());
        context.subscriptions.push(this._git = new GitService());

        // Since there is a chicken/egg problem with the DocumentTracker and the GitService, initialize the tracker once the GitService is loaded
        this._tracker.initialize();

        context.subscriptions.push(this._annotationController = new AnnotationController());
        context.subscriptions.push(this._currentLineController = new CurrentLineController());
        context.subscriptions.push(this._codeLensController = new CodeLensController());
        context.subscriptions.push(this._keyboard = new Keyboard());

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

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider()));
        context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider()));
    }

    private static _annotationController: AnnotationController;
    static get annotations() {
        return this._annotationController;
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

    private static _git: GitService;
    static get git() {
        return this._git;
    }

    private static _gitExplorer: GitExplorer | undefined;
    static get gitExplorer(): GitExplorer {
        return this._gitExplorer!;
    }

    private static _keyboard: Keyboard;
    static get keyboard() {
        return this._keyboard;
    }

    private static _currentLineController: CurrentLineController;
    static get lineAnnotations() {
        return this._currentLineController;
    }

    private static _resultsExplorer: ResultsExplorer | undefined;
    static get resultsExplorer() {
        if (this._resultsExplorer === undefined) {
            this._context.subscriptions.push(this._resultsExplorer = new ResultsExplorer());
        }

        return this._resultsExplorer;
    }

    private static _tracker: DocumentTracker<GitDocumentState>;
    static get tracker() {
        return this._tracker;
    }

    static resetConfig() {
        this._config = undefined;
    }
}
