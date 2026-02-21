---
name: add-webview
description: Create new webviews with IPC protocol, Lit app, and registration
---

# /add-webview - Create New Webview

Scaffold a new webview with all required boilerplate.

## Usage

```
/add-webview [name]
```

## Information Needed

1. **Webview name** — camelCase (e.g., `myFeature`)
2. **Display title** — e.g., "My Feature"
3. **Type** — `view` (sidebar) or `panel` (editor panel)
4. **Pro feature** — Yes/No (affects file location)

## Files to Create

### 1. Protocol: `src/webviews/{name}/protocol.ts`

```typescript
import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcCommand, IpcNotification, IpcRequest } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export const scope: IpcScope = '{name}';

export interface State extends WebviewState<'gitlens.views.{name}'> {
	loading: boolean;
}

// Commands (fire-and-forget)
export interface DoSomethingParams {
	id: string;
}
export const DoSomethingCommand = new IpcCommand<DoSomethingParams>(scope, 'doSomething');

// Requests (with response)
export interface GetDataParams {
	filter?: string;
}
export interface GetDataResponse {
	items: unknown[];
}
export const GetDataRequest = new IpcRequest<GetDataParams, GetDataResponse>(scope, 'getData');

// Notifications (host → webview)
export interface DidChangeDataParams {
	items: unknown[];
}
export const DidChangeDataNotification = new IpcNotification<DidChangeDataParams>(scope, 'data/didChange');
```

### 2. Provider: `src/webviews/{name}/{name}Webview.ts`

```typescript
import type { Disposable } from 'vscode';
import type { Container } from '../../container.js';
import type { WebviewHost, WebviewProvider } from '../webviewProvider.js';
import { ipcCommand, ipcRequest } from '../ipc/handlerRegistry.js';
import type { IpcParams, IpcResponse } from '../ipc/models/ipc.js';
import type { State } from './protocol.js';
import { DoSomethingCommand, GetDataRequest, DidChangeDataNotification } from './protocol.js';

export class {Name}WebviewProvider implements WebviewProvider<State, State>, Disposable {
    constructor(
        private readonly container: Container,
        private readonly host: WebviewHost<'gitlens.views.{name}'>,
    ) {}

    dispose(): void {}

    async includeBootstrap(): Promise<State> {
        return {
            webviewId: this.host.id,
            webviewInstanceId: this.host.instanceId,
            loading: false,
        };
    }

    @ipcCommand(DoSomethingCommand)
    private async onDoSomething(params: IpcParams<typeof DoSomethingCommand>): Promise<void> {
        // Handle command
    }

    @ipcRequest(GetDataRequest)
    private async onGetData(params: IpcParams<typeof GetDataRequest>): Promise<IpcResponse<typeof GetDataRequest>> {
        return { items: [] };
    }
}
```

### 3. Registration: `src/webviews/{name}/registration.ts`

```typescript
import type { WebviewsController } from '../webviewsController.js';
import type { WebviewViewProxy } from '../webviewProxy.js';
import type { State } from './protocol.js';

export type {Name}WebviewShowingArgs = [];

export function register{Name}WebviewView(
    controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.{name}', {Name}WebviewShowingArgs, State> {
    return controller.registerWebviewView<'gitlens.views.{name}', State, State, {Name}WebviewShowingArgs>(
        {
            id: 'gitlens.views.{name}',
            fileName: '{name}.html',
            title: '{Title}',
            contextKeyPrefix: 'gitlens:webviewView:{name}',
            trackingFeature: '{name}View',
            type: '{name}',
            plusFeature: false,
            webviewHostOptions: { retainContextWhenHidden: true },
        },
        async (container, host) => {
            const { {Name}WebviewProvider } = await import(
                /* webpackChunkName: "webview-{name}" */ './{name}Webview.js'
            );
            return new {Name}WebviewProvider(container, host);
        },
    );
}
```

### 4. App: `src/webviews/apps/{name}/{name}.ts`

```typescript
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { GlAppHost } from '../shared/appHost.js';
import type { HostIpc } from '../shared/ipc.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { State } from '../../{name}/protocol.js';
import { {Name}StateProvider } from './stateProvider.js';
import { styles } from './{name}.css.js';

@customElement('gl-{name}-app')
export class Gl{Name}App extends GlAppHost<State, {Name}StateProvider> {
    static override styles = styles;

    protected override createStateProvider(
        bootstrap: string, ipc: HostIpc, logger: LoggerContext,
    ): {Name}StateProvider {
        return new {Name}StateProvider(this, bootstrap, ipc, logger);
    }

    override render() {
        return html`<div class="{name}"><h1>{Title}</h1></div>`;
    }
}
```

### 5. State Provider: `src/webviews/apps/{name}/stateProvider.ts`

```typescript
import type { Disposable } from 'vscode';
import type { StateProvider } from '../shared/stateProviderBase.js';
import type { HostIpc } from '../shared/ipc.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { State } from '../../{name}/protocol.js';

export class {Name}StateProvider implements StateProvider<State>, Disposable {
    readonly state: State;

    constructor(
        private readonly host: Gl{Name}App,
        bootstrap: string,
        private readonly ipc: HostIpc,
        private readonly logger: LoggerContext,
    ) {
        this.state = JSON.parse(bootstrap);
    }

    dispose(): void {}
}
```

### 6. Styles: `src/webviews/apps/{name}/{name}.css.ts`

```typescript
import { css } from 'lit';

export const styles = css`
    :host { display: block; height: 100%; }
    .{name} { padding: 1rem; }
`;
```

## Additional Steps

7. **Webpack entry** — Add to `getWebviewsConfigs()` in `webpack.config.mjs`
8. **Register** in `src/webviews/webviewsController.ts`
9. **View ID** — Add to `src/constants.views.ts`
10. **Build** — `pnpm run build:webviews`

## File Locations

| Component         | Community                   | Pro                              |
| ----------------- | --------------------------- | -------------------------------- |
| Protocol/Provider | `src/webviews/{name}/`      | `src/webviews/plus/{name}/`      |
| App               | `src/webviews/apps/{name}/` | `src/webviews/apps/plus/{name}/` |
