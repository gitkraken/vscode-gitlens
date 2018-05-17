'use strict';
import { ConfigurationChangeEvent, Disposable, languages } from 'vscode';
import { configuration } from './configuration';
import { CommandContext, setCommandContext } from './constants';
import { Container } from './container';
import { DocumentBlameStateChangeEvent, DocumentDirtyIdleTriggerEvent, GitDocumentState } from './trackers/gitDocumentTracker';
import { GitCodeLensProvider } from './gitCodeLensProvider';
import { Logger } from './logger';

export class CodeLensController extends Disposable {

    private _canToggle: boolean = false;
    private _disposable: Disposable | undefined;
    private _provider: GitCodeLensProvider | undefined;
    private _providerDisposable: Disposable | undefined;

    constructor() {
        super(() => this.dispose());

        this._disposable = Disposable.from(
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this._providerDisposable && this._providerDisposable.dispose();
        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const section = configuration.name('codeLens').value;
        if (initializing || configuration.changed(e, section, null) ||
            configuration.changed(e, configuration.name('defaultDateStyle').value) ||
            configuration.changed(e, configuration.name('defaultDateFormat').value)) {
            if (!initializing) {
                Logger.log('CodeLens config changed; resetting CodeLens provider');
            }

            const cfg = Container.config.codeLens;
            if (cfg.enabled && (cfg.recentChange.enabled || cfg.authors.enabled)) {
                if (this._provider !== undefined) {
                    this._provider.reset();
                }
                else {
                    this.createProvider();
                }
            }
            else {
                if (this._providerDisposable !== undefined) {
                    this._providerDisposable.dispose();
                    this._providerDisposable = undefined;
                }
                this._provider = undefined;
            }

            this._canToggle = cfg.recentChange.enabled || cfg.authors.enabled;
            setCommandContext(CommandContext.CanToggleCodeLens, this._canToggle);
        }
    }

    private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
        // Only reset if we have saved, since the code lens won't naturally be re-rendered
        if (this._provider === undefined || !e.blameable) return;

        Logger.log('Blame state changed; resetting CodeLens provider');
        this._provider.reset('saved');
    }

    private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
        if (this._provider === undefined || !e.document.isBlameable) return;

        const maxLines = Container.config.advanced.blame.sizeThresholdAfterEdit;
        if (maxLines > 0 && e.document.lineCount > maxLines) return;

        Logger.log('Dirty idle triggered; resetting CodeLens provider');
        this._provider.reset('idle');
    }

    toggleCodeLens() {
        if (!this._canToggle) return;

        Logger.log(`toggleCodeLens()`);
        if (this._provider !== undefined) {
            if (this._providerDisposable !== undefined) {
                this._providerDisposable.dispose();
                this._providerDisposable = undefined;
            }

            this._provider = undefined;

            return;
        }

        this.createProvider();
    }

    private createProvider() {
        this._provider = new GitCodeLensProvider(Container.context, Container.git, Container.tracker);
        this._providerDisposable = Disposable.from(
            languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider),
            Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
            Container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this)
        );
    }
}
