'use strict';
import { Disposable, ExtensionContext, workspace } from 'vscode';
import { Logger } from './logger';

enum SettingLocation {
    workspace,
    global,
    default
}

export default class WhitespaceController extends Disposable {

    private _count: number = 0;
    private _disposable: Disposable;
    private _ignoreNextConfigChange: boolean = false;
    private _renderWhitespace: string;
    private _renderWhitespaceLocation: SettingLocation = SettingLocation.default;
    private _requiresOverride: boolean;

    constructor(context: ExtensionContext) {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));

        this._disposable = Disposable.from(...subscriptions);

        this._onConfigurationChanged();
    }

    dispose() {
        if (this._count !== 0) {
            this._restoreWhitespace();
        }
    }

    private _onConfigurationChanged() {
        if (this._ignoreNextConfigChange) {
            this._ignoreNextConfigChange = false;
            Logger.log(`Whitespace changed; ignored`);

            return;
        }

        const config = workspace.getConfiguration('editor');
        const inspection = config.inspect<string>('renderWhitespace');

        if (inspection.workspaceValue) {
            this._renderWhitespace = inspection.workspaceValue;
            this._renderWhitespaceLocation = SettingLocation.workspace;
        }
        else if (inspection.globalValue) {
            this._renderWhitespace = inspection.globalValue;
            this._renderWhitespaceLocation = SettingLocation.global;
        }
        else {
            this._renderWhitespace = inspection.defaultValue;
            this._renderWhitespaceLocation = SettingLocation.default;
        }

        Logger.log(`Whitespace changed; renderWhitespace=${this._renderWhitespace}, location=${this._renderWhitespaceLocation}`);
        this._requiresOverride = !(this._renderWhitespace == null || this._renderWhitespace === 'none');
        if (this._requiresOverride) {
            if (this._count !== 0) {
                // Since we were currently overriding whitespace, re-override
                this._overrideWhitespace();
            }
        }
    }

    override() {
        Logger.log(`Request whitespace override; count=${this._count}`);
        if (this._count === 0 && this._requiresOverride) {
            this._ignoreNextConfigChange = true;
            // Override whitespace (turn off)
            this._overrideWhitespace();
        }
        this._count++;
    }

    private _overrideWhitespace() {
        Logger.log(`Override whitespace`);
        const config = workspace.getConfiguration('editor');
        config.update('renderWhitespace', 'none', this._renderWhitespaceLocation === SettingLocation.global);
    }

    restore() {
        Logger.log(`Request whitespace restore; count=${this._count}`);
        this._count--;
        if (this._count === 0 && this._requiresOverride) {
            // restore whitespace
            this._restoreWhitespace();
        }
    }

    private _restoreWhitespace() {
        Logger.log(`Restore whitespace`);
        const config = workspace.getConfiguration('editor');
        config.update('renderWhitespace',
            this._renderWhitespaceLocation === SettingLocation.default
                ? undefined
                : this._renderWhitespace,
            this._renderWhitespaceLocation === SettingLocation.global);
    }
}