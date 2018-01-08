'use strict';
import { ExtensionContext } from 'vscode';
import { AnnotationController } from './annotations/annotationController';
import { CodeLensController } from './codeLensController';
import { configuration, IConfig } from './configuration';
import { CurrentLineController } from './currentLineController';
import { DocumentTracker, GitDocumentState } from './trackers/documentTracker';
import { ExplorerCommands } from './views/explorerCommands';
import { GitExplorer } from './views/gitExplorer';
import { GitService } from './gitService';
import { Keyboard } from './keyboard';
import { ResultsExplorer } from './views/resultsExplorer';

export class Container {

    static initialize(context: ExtensionContext, config: IConfig) {
        Container._context = context;
        Container._config = config;

        context.subscriptions.push(Container._tracker = new DocumentTracker<GitDocumentState>());
        context.subscriptions.push(Container._git = new GitService());
        context.subscriptions.push(Container._annotationController = new AnnotationController());
        context.subscriptions.push(Container._currentLineController = new CurrentLineController());
        context.subscriptions.push(Container._codeLensController = new CodeLensController());
        context.subscriptions.push(Container._explorerCommands = new ExplorerCommands());
        context.subscriptions.push(Container._keyboard = new Keyboard());

        Container._gitExplorer = new GitExplorer();
        Container._resultsExplorer = new ResultsExplorer();
    }

    private static _annotationController: AnnotationController;
    static get annotations() {
        return Container._annotationController;
    }

    private static _codeLensController: CodeLensController;
    static get codeLens() {
        return Container._codeLensController;
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
        return Container._context;
    }

    private static _explorerCommands: ExplorerCommands;
    static get explorerCommands() {
        return Container._explorerCommands;
    }

    private static _git: GitService;
    static get git() {
        return Container._git;
    }

    private static _gitExplorer: GitExplorer;
    static get gitExplorer() {
        return Container._gitExplorer;
    }

    private static _keyboard: Keyboard;
    static get keyboard() {
        return Container._keyboard;
    }

    private static _currentLineController: CurrentLineController;
    static get lineAnnotations() {
        return Container._currentLineController;
    }

    private static _resultsExplorer: ResultsExplorer;
    static get resultsExplorer() {
        return Container._resultsExplorer;
    }

    private static _tracker: DocumentTracker<GitDocumentState>;
    static get tracker() {
        return Container._tracker;
    }

    static resetConfig() {
        this._config = undefined;
    }
}
