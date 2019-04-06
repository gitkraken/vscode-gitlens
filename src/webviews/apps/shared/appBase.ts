'use strict';
/*global window document*/
import { AppBootstrap, IpcCommandParamsOf, IpcCommandType, IpcMessage } from '../../protocol';
import { initializeAndWatchThemeColors } from './theme';

interface VsCodeApi {
    postMessage(msg: {}): void;
    setState(state: {}): void;
    getState(): {};
}

declare function acquireVsCodeApi(): VsCodeApi;

let ipcSequence = 0;

export abstract class App<TBootstrap extends AppBootstrap> {
    private readonly _api: VsCodeApi;

    constructor(protected readonly appName: string, protected readonly bootstrap: TBootstrap) {
        this.log(`${this.appName}.ctor`);

        this._api = acquireVsCodeApi();
        initializeAndWatchThemeColors();

        this.log(`${this.appName}.initializing`);

        this.onInitialize();
        this.onBind(this);

        window.addEventListener('message', this.onMessageReceived.bind(this));

        this.onInitialized();

        setTimeout(() => {
            document.body.classList.remove('preload');
        }, 500);
    }

    protected onInitialize() {
        // virtual
    }
    protected onInitialized() {
        // virtual
    }
    protected onBind(me: this) {
        // virtual
    }
    protected onMessageReceived(e: MessageEvent) {
        // virtual
    }

    protected log(message: string) {
        console.log(message);
    }

    protected sendCommand<CT extends IpcCommandType>(type: CT, params: IpcCommandParamsOf<CT>): void {
        return this.postMessage({ id: this.nextIpcId(), method: type.method, params: params });
    }

    private nextIpcId() {
        if (ipcSequence === Number.MAX_SAFE_INTEGER) {
            ipcSequence = 1;
        }
        else {
            ipcSequence++;
        }

        return `webview:${ipcSequence}`;
    }

    private postMessage(e: IpcMessage) {
        this._api.postMessage(e);
    }
}
