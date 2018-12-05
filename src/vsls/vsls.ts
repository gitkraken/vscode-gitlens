'use strict';
import { Disposable, workspace } from 'vscode';
import { getApi, LiveShare, Role, SessionChangeEvent } from 'vsls';
import { CommandContext, DocumentSchemes, setCommandContext } from '../constants';
import { Container } from '../container';
import { Logger } from './../logger';
import { VslsGuestService } from './guest';
import { VslsHostService } from './host';

export const vslsUriPrefixRegex = /^[\/|\\]~(?:\d+?|external)(?:[\/|\\]|$)/;
export const vslsUriRootRegex = /^[\/|\\]~(?:\d+?|external)$/;

export class VslsController implements Disposable {
    private _disposable: Disposable | undefined;
    private _guest: VslsGuestService | undefined;
    private _host: VslsHostService | undefined;

    private _onReady: (() => void) | undefined;
    private _waitForReady: Promise<void> | undefined;

    constructor() {
        void this.initialize();
    }

    dispose() {
        this._disposable && this._disposable.dispose();
        if (this._host !== undefined) {
            this._host.dispose();
        }

        if (this._guest !== undefined) {
            this._guest.dispose();
        }
    }

    private async initialize() {
        try {
            // If we have a vsls: workspace open, we might be a guest, so wait until live share transitions into a mode
            if (
                workspace.workspaceFolders !== undefined &&
                workspace.workspaceFolders.some(f => f.uri.scheme === DocumentSchemes.Vsls)
            ) {
                setCommandContext(CommandContext.Readonly, true);
                this._waitForReady = new Promise(resolve => (this._onReady = resolve));
            }

            const api = await getApi();
            if (api == null) {
                // Tear it down if we can't talk to live share
                if (this._onReady !== undefined) {
                    this._onReady();
                    this._waitForReady = undefined;
                }
                return;
            }

            this._disposable = Disposable.from(
                api.onDidChangeSession(e => this.onLiveShareSessionChanged(api, e), this)
            );
        }
        catch (ex) {
            debugger;
            Logger.error(ex);
            return;
        }
    }

    get isMaybeGuest() {
        return this._guest !== undefined || this._waitForReady !== undefined;
    }

    async guest() {
        if (this._waitForReady !== undefined) {
            await this._waitForReady;
            this._waitForReady = undefined;
        }

        return this._guest;
    }

    host() {
        return this._host;
    }

    private async onLiveShareSessionChanged(api: LiveShare, e: SessionChangeEvent) {
        if (this._host !== undefined) {
            this._host.dispose();
        }

        if (this._guest !== undefined) {
            this._guest.dispose();
        }

        switch (e.session.role) {
            case Role.Host:
                setCommandContext(CommandContext.Readonly, undefined);
                if (Container.config.liveshare.allowGuestAccess) {
                    this._host = await VslsHostService.share(api);
                }
                break;
            case Role.Guest:
                setCommandContext(CommandContext.Readonly, true);
                this._guest = await VslsGuestService.connect(api);
                break;

            default:
                setCommandContext(CommandContext.Readonly, undefined);
                break;
        }

        if (this._onReady !== undefined) {
            this._onReady();
            this._onReady = undefined;
        }
    }
}
