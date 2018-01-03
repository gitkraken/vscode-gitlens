'use strict';
import { ConfigurationChangeEvent, Disposable, ExtensionContext, languages, TextEditor } from 'vscode';
import { configuration, ICodeLensConfig } from './configuration';
import { CommandContext, setCommandContext } from './constants';
import { GitCodeLensProvider } from './gitCodeLensProvider';
import { BlameabilityChangeEvent, BlameabilityChangeReason, GitContextTracker, GitService } from './gitService';
import { Logger } from './logger';

export class CodeLensController extends Disposable {

    private _canToggle: boolean;
    private _disposable: Disposable | undefined;
    private _provider: GitCodeLensProvider | undefined;
    private _providerDisposable: Disposable | undefined;

    constructor(
        private readonly context: ExtensionContext,
        private readonly git: GitService,
        private readonly gitContextTracker: GitContextTracker
    ) {
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

            const cfg = configuration.get<ICodeLensConfig>(section);
            if (cfg.enabled && (cfg.recentChange.enabled || cfg.authors.enabled)) {
                if (this._provider !== undefined) {
                    this._provider.reset();
                }
                else {
                    this._provider = new GitCodeLensProvider(this.context, this.git);
                    this._providerDisposable = Disposable.from(
                        languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider),
                        this.gitContextTracker.onDidChangeBlameability(this.onBlameabilityChanged, this)
                    );
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

    private onBlameabilityChanged(e: BlameabilityChangeEvent) {
        // Only reset if we have saved, since the code lens won't naturally be re-rendered
        if (this._provider === undefined || !e.blameable || e.reason !== BlameabilityChangeReason.DocumentChanged) return;

        Logger.log('Blameability changed; resetting CodeLens provider');
        this._provider.reset();
    }

    toggleCodeLens(editor: TextEditor) {
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

        this._provider = new GitCodeLensProvider(this.context, this.git);
        this._providerDisposable = Disposable.from(
            languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider),
            this.gitContextTracker.onDidChangeBlameability(this.onBlameabilityChanged, this)
        );
    }
}
