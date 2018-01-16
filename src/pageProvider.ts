'use strict';
import { commands, ConfigurationTarget, Disposable, Event, EventEmitter, TextDocumentContentProvider, Uri, ViewColumn, workspace } from 'vscode';
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

    constructor() {
        super(() => this.dispose());

        this._disposable = Disposable.from(
            workspace.registerTextDocumentContentProvider(settingsUri.scheme, this),
            commands.registerCommand('gitlens.showSettingsPage', this.showSettings, this),
            commands.registerCommand('gitlens.showWelcomePage', this.showWelcome, this),
            commands.registerCommand('gitlens.saveSettings', this.save, this)
        );
    }

    dispose() {
        this._disposable.dispose();
    }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        const doc = await workspace.openTextDocument(Uri.file(Container.context.asAbsolutePath(`${uri.path}.html`)));

        let text = doc.getText()
            .replace(/{{root}}/g, Uri.file(Container.context.asAbsolutePath('.')).toString());

        if (text.includes('\'{{config}}\'')) {
            text = text.replace(/'{{config}}'/g, JSON.stringify(Container.config));
        }

        return text;
    }

    refresh(uri?: Uri) {
        Logger.log('PageProvider.refresh');

        this._onDidChange.fire(uri || settingsUri);
    }

    async save(changes: { [key: string]: any }) {
        Logger.log(`PageProvider.save: changes=${JSON.stringify(changes)}`);

        for (const key in changes) {
            await configuration.update(key, changes[key], ConfigurationTarget.Global);
        }
    }

    async showSettings() {
        return await commands.executeCommand('vscode.previewHtml', settingsUri, ViewColumn.Active, 'GitLens Settings');
    }

    async showWelcome() {
        return await commands.executeCommand('vscode.previewHtml', welcomeUri, ViewColumn.Active, 'Welcome to GitLens');
    }
}
