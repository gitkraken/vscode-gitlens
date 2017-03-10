'use strict';
import { Disposable, workspace } from 'vscode';
import { Logger } from './logger';

interface ConfigurationInspection {
    key: string;
    defaultValue?: string;
    globalValue?: string;
    workspaceValue?: string;
}

enum SettingLocation {
    workspace,
    global,
    default
}

class RenderWhitespaceConfiguration {

    constructor(public inspection: ConfigurationInspection) { }

    get location(): SettingLocation {
        if (this.inspection.workspaceValue) return SettingLocation.workspace;
        if (this.inspection.globalValue) return SettingLocation.global;
        return SettingLocation.default;
    }

    get overrideRequired() {
        return this.value != null && this.value !== 'none';
    }

    get value(): string {
        return this.inspection.workspaceValue || this.inspection.globalValue || this.inspection.defaultValue;
    }

    update(replacement: ConfigurationInspection): boolean {
        let override = false;

        switch (this.location) {
            case SettingLocation.workspace:
                this.inspection.defaultValue = replacement.defaultValue;
                this.inspection.globalValue = replacement.globalValue;
                if (replacement.workspaceValue !== 'none') {
                    this.inspection.workspaceValue = replacement.workspaceValue;
                    override = true;
                }
                break;
            case SettingLocation.global:
                this.inspection.defaultValue = replacement.defaultValue;
                this.inspection.workspaceValue = replacement.workspaceValue;
                if (replacement.globalValue !== 'none') {
                    this.inspection.globalValue = replacement.globalValue;
                    override = true;
                }
                break;
            case SettingLocation.default:
                this.inspection.globalValue = replacement.globalValue;
                this.inspection.workspaceValue = replacement.workspaceValue;
                if (replacement.defaultValue !== 'none') {
                    this.inspection.defaultValue = replacement.defaultValue;
                    override = true;
                }
                break;
        }

        return override;
    }
}

export class WhitespaceController extends Disposable {

    private _configuration: RenderWhitespaceConfiguration;
    private _count: number = 0;
    private _disposable: Disposable;
    private _disposed: boolean = false;

    constructor() {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));

        this._disposable = Disposable.from(...subscriptions);

        this._onConfigurationChanged();
    }

    async dispose() {
        this._disposed = true;
        if (this._count !== 0) {
            await this._restoreWhitespace();
            this._count = 0;
        }
    }

    private _onConfigurationChanged() {
        if (this._disposed) return;

        const inspection = workspace.getConfiguration('editor').inspect<string>('renderWhitespace');

        if (!this._count) {
            this._configuration = new RenderWhitespaceConfiguration(inspection);
            return;
        }

        if (this._configuration.update(inspection)) {
            // Since we were currently overriding whitespace, re-override
            setTimeout(() => this._overrideWhitespace(), 1);
        }
    }

    async override() {
        if (this._disposed) return;

        Logger.log(`Request whitespace override; count=${this._count}`);
        this._count++;
        if (this._count === 1 && this._configuration.overrideRequired) {
            // Override whitespace (turn off)
            await this._overrideWhitespace();
            // Add a delay to give the editor time to turn off the whitespace
            await new Promise((resolve, reject) => setTimeout(resolve, 250));
        }
    }

    private async _overrideWhitespace() {
        Logger.log(`Override whitespace`);
        const config = workspace.getConfiguration('editor');
        return config.update('renderWhitespace', 'none', this._configuration.location === SettingLocation.global);
    }

    async restore() {
        if (this._disposed || this._count === 0) return;

        Logger.log(`Request whitespace restore; count=${this._count}`);
        this._count--;
        if (this._count === 0 && this._configuration.overrideRequired) {
            // restore whitespace
            await this._restoreWhitespace();
        }
    }

    private async _restoreWhitespace() {
        Logger.log(`Restore whitespace`);
        const config = workspace.getConfiguration('editor');
        return config.update('renderWhitespace',
            this._configuration.location === SettingLocation.default
                ? undefined
                : this._configuration.value,
            this._configuration.location === SettingLocation.global);
    }
}