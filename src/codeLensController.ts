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
            configuration.onDidChange(this.onConfigurationChanged, this),
            this.gitContextTracker.onDidChangeBlameability(this.onBlameabilityChanged, this)
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
        if (initializing || configuration.changed(e, section, null)) {
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
                    this._providerDisposable = languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider);
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
        if (this._provider === undefined) return;

        // Don't reset if this was an editor change, because code lens will naturally be re-rendered
        if (e.blameable && e.reason !== BlameabilityChangeReason.EditorChanged) {
            Logger.log('Blameability changed; resetting CodeLens provider');
            this._provider.reset();
        }
    }

    toggleCodeLens(editor: TextEditor) {
        if (!this._canToggle) return;

        Logger.log(`toggleCodeLens()`);
        if (this._providerDisposable !== undefined) {
            this._providerDisposable.dispose();
            this._providerDisposable = undefined;

            return;
        }

        this._providerDisposable = languages.registerCodeLensProvider(GitCodeLensProvider.selector, new GitCodeLensProvider(this.context, this.git));
    }
}
