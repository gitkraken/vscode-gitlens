'use strict';
import { commands, ConfigurationTarget, Disposable, Event, EventEmitter, TextDocument, TextDocumentContentProvider, Uri, ViewColumn, workspace } from 'vscode';
import { Container } from './container';
import { configuration } from './configuration';
import { Logger } from './logger';

const settingsUri = Uri.parse('gitlens://authority/settings');
const welcomeUri = Uri.parse('gitlens://authority/welcome');

export class PageProvider extends Disposable implements TextDocumentContentProvider {

    private readonly _onDidChange = new EventEmitter<Uri>();
    get onDidChange(): Event<Uri> {
        return this._onDidChange.event;
    }

    private readonly _disposable: Disposable;
    private _scope: Map<string, 'user' | 'workspace'> = new Map();

    constructor() {
        super(() => this.dispose());

        this._disposable = Disposable.from(
            workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
            workspace.registerTextDocumentContentProvider(settingsUri.scheme, this),
            commands.registerCommand('gitlens.showSettingsPage', this.showSettings, this),
            commands.registerCommand('gitlens.showWelcomePage', this.showWelcome, this),
            commands.registerCommand('gitlens.saveSettings', this.save, this)
        );
    }

    dispose() {
        this._disposable.dispose();
    }

    private onTextDocumentClosed(e: TextDocument) {
        this._scope.delete(e.uri.toString());
    }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        const doc = await workspace.openTextDocument(Uri.file(Container.context.asAbsolutePath(`${uri.path}.html`)));

        let text = doc.getText().replace(/{{root}}/g, Uri.file(Container.context.asAbsolutePath('.')).toString());
        if (text.includes('\'{{data}}\'')) {
            text = text.replace(/'{{data}}'/g, JSON.stringify({
                config: Container.config,
                scope: this.getScope(uri),
                scopes: this.getAvailableScopes(),
                uri: uri.toString()
            }));
        }

        return text;
    }

    private getAvailableScopes(): ['user' | 'workspace', string][] {
        const scopes: ['user' | 'workspace', string][] = [['user', 'User Settings']];
        if (workspace.workspaceFolders !== undefined && workspace.workspaceFolders.length) {
            scopes.push(['workspace', 'Workspace Settings']);
        }
        return scopes;
    }

    private getScope(uri: Uri): 'user' | 'workspace' {
        return this._scope.get(uri.toString()) || 'user';
    }

    refresh(uri ?: Uri) {
        Logger.log('PageProvider.refresh');

        this._onDidChange.fire(uri || settingsUri);
    }

    async save(options: { changes: { [key: string]: any }, scope: 'user' | 'workspace', uri: string }) {
        Logger.log(`PageProvider.save: options=${JSON.stringify(options)}`);

        this._scope.set(options.uri, options.scope);
        const target = options.scope === 'workspace'
            ? ConfigurationTarget.Workspace
            : ConfigurationTarget.Global;

        for (const key in options.changes) {
            const inspect = await configuration.inspect(key)!;
            if (inspect.defaultValue === options.changes[key]) {
                await configuration.update(key, undefined, target);
            }
            else {
                await configuration.update(key, options.changes[key], target);
            }
        }
    }

    async showSettings() {
        return await commands.executeCommand('vscode.previewHtml', settingsUri, ViewColumn.Active, 'GitLens Settings');
    }

    async showWelcome() {
        return await commands.executeCommand('vscode.previewHtml', welcomeUri, ViewColumn.Active, 'Welcome to GitLens');
    }
}
