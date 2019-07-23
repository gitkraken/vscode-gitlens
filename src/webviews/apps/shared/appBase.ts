'use strict';
/*global window document*/
import { IpcCommandParamsOf, IpcCommandType, IpcMessage, ReadyCommandType } from '../../protocol';
import { initializeAndWatchThemeColors } from './theme';

interface VsCodeApi {
    postMessage(msg: {}): void;
    setState(state: {}): void;
    getState(): {};
}

declare function acquireVsCodeApi(): VsCodeApi;

let ipcSequence = 0;

export abstract class App<TState> {
    private readonly _api: VsCodeApi;
    protected state: TState;

    constructor(protected readonly appName: string, state: TState) {
        this.log(`${this.appName}.ctor`);

        this._api = acquireVsCodeApi();
        initializeAndWatchThemeColors();

        this.state = state;
        setTimeout(() => {
            this.log(`${this.appName}.initializing`);

            if (this.onInitialize !== undefined) {
                this.onInitialize();
            }
            if (this.onBind !== undefined) {
                this.onBind(this);
            }

            if (this.onMessageReceived !== undefined) {
                window.addEventListener('message', this.onMessageReceived.bind(this));
            }

            this.sendCommand(ReadyCommandType, {});

            if (this.onInitialized !== undefined) {
                this.onInitialized();
            }

            setTimeout(() => {
                document.body.classList.remove('preload');
            }, 500);
        }, 0);
    }

    protected onInitialize?(): void;
    protected onBind?(me: this): void;
    protected onInitialized?(): void;
    protected onMessageReceived?(e: MessageEvent): void;

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
