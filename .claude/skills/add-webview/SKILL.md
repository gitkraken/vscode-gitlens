---
name: add-webview
description: Create new webviews with RPC services, Lit app, and registration
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

Webviews talk to the host over a single stack: Supertalk RPC (`src/webviews/rpc/`) over the
namespaced binary postMessage pipe. There is no legacy message protocol. Read `docs/webview-architecture.md`
first; use `src/webviews/allowedSigners/` + `src/webviews/apps/allowedSigners/` as the smallest
end-to-end reference, and Timeline for the signals/persistence patterns.

## Files to Create

### 1. Protocol: `src/webviews/{name}/protocol.ts` — pure types

```typescript
import type { WebviewState } from '../protocol.js';

export interface State extends WebviewState<'gitlens.{name}'> {
	loading: boolean;
}

// Params/result types for your service methods live here too
export interface DoSomethingParams {
	id: string;
}
export interface DoSomethingResult {
	ok: boolean;
}
```

No message declarations and no `scope` const — methods/events are declared on the RPC service.

### 2. RPC service: `src/webviews/rpc/{name}Service.ts`

```typescript
import type { Container } from '../../container.js';
import type { DoSomethingParams, DoSomethingResult } from '../{name}/protocol.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createRpcEvent } from './eventVisibilityBuffer.js';
import type { RpcEventSubscription } from './services/types.js';
import type { SharedWebviewServices } from './services/common.js';

/** Fired when host-owned data changes — payload must be a complete snapshot (save-last buffered). */
export interface DidChangeDataEvent {
	items: string[];
}

/** The RPC-facing surface of {@link {Name}Service}. */
export interface {Name}ViewService {
	readonly onDataChange: RpcEventSubscription<DidChangeDataEvent>;

	doSomething(params: DoSomethingParams): Promise<DoSomethingResult>;
}

/** RPC services for the {Name} webview. */
export interface {Name}Services extends SharedWebviewServices {
	readonly {name}: {Name}ViewService;
}

export class {Name}Service implements {Name}ViewService {
	readonly onDataChanged: RpcEventSubscription<DidChangeDataEvent>;

	readonly #didDataChange = createRpcEvent<DidChangeDataEvent>('dataChanged', 'save-last');

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.onDataChanged = this.#didDataChange.subscribe(buffer, tracker);
	}

	fireDataChanged(event: DidChangeDataEvent): void {
		this.#didDataChange.fire(event);
	}

	async doSomething(params: DoSomethingParams): Promise<DoSomethingResult> {
		return { ok: true };
	}
}
```

Queries take an optional trailing `AbortSignal`; events are `save-last` so a hidden webview gets
the latest snapshot on show.

### 3. Provider: `src/webviews/{name}/{name}Webview.ts`

```typescript
import type { Container } from '../../container.js';
import type { WebviewHost, WebviewProvider } from '../webviewProvider.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../rpc/eventVisibilityBuffer.js';
import { createSharedServices } from '../rpc/services/common.js';
import { proxyServices } from '../rpc/services/proxy.js';
import type { State } from './protocol.js';
import type { {Name}Services } from '../rpc/{name}Service.js';
import { {Name}Service } from '../rpc/{name}Service.js';

export class {Name}WebviewProvider implements WebviewProvider<State, State> {
	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.{name}'>,
	) {}

	dispose(): void {}

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): {Name}Services {
		const shared = createSharedServices(
			this.container,
			this.host,
			context => {
				this._telemetryContext = context;
			},
			buffer,
			tracker,
		);

		this._service ??= new {Name}Service(this.container, buffer, tracker);

		return proxyServices({
			...shared,

			{name}: this._service,
		} satisfies {Name}Services);
	}

	includeBootstrap(): State {
		return {
			webviewId: this.host.id,
			webviewInstanceId: this.host.instanceId,
			timestamp: Date.now(),
			loading: false,
		};
	}
}
```

Prefer resource-shaped queries over a monolithic bootstrap; keep `includeBootstrap()` minimal.

### 4. Registration: `src/webviews/{name}/registration.ts`

```typescript
import { ViewColumn } from 'vscode';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController.js';
import type { State } from './protocol.js';

export type {Name}WebviewShowingArgs = [];

export function register{Name}WebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.{name}', {Name}WebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.{name}', State, State, {Name}WebviewShowingArgs>(
		{ id: 'gitlens.{name}' },
		{
			id: 'gitlens.{name}',
			fileName: '{name}.html',
			title: '{Title}',
			contextKeyPrefix: 'gitlens:webview:{name}',
			trackingFeature: '{name}Webview',
			type: '{name}',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: { retainContextWhenHidden: false },
		},
		async (container, host) => {
			const { {Name}WebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-{name}" */ './{name}Webview.js'),
			);
			return new {Name}WebviewProvider(container, host);
		},
	);
}
```

For a sidebar view use `registerWebviewView` / `WebviewViewsProxy` instead (see any view's
`registration.ts`), then register it in `src/container.ts`.

### 5. App: `src/webviews/apps/{name}/{name}.ts`

```typescript
import type { Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import type { State } from '../../{name}/protocol.js';
import type { {Name}Services } from '../../rpc/{name}Service.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import { getHost } from '../shared/host/context.js';
import { RpcController } from '../shared/rpc/rpcController.js';
import { create{Name}State } from './state.js';
import { styles } from './{name}.css.js';

@customElement('gl-{name}-app')
export class Gl{Name}App extends SignalWatcherWebviewApp {
	static override styles = styles;

	@property({ type: String, noAccessor: true })
	private context!: string;

	private _host = getHost();
	private _state = create{Name}State();

	private _eventsSubscription?: Subscription;
	private _service?: Awaited<Remote<{Name}Services>['{name}']>;

	protected override readonly _rpc = new RpcController<{Name}Services>(this, {
		rpcOptions: {
			webviewId: () => this._webview?.webviewId,
			webviewInstanceId: () => this._webview?.webviewInstanceId,
			endpoint: () => this._host.createEndpoint(),
		},
		onReady: services => this._onRpcReady(services),
	});

	override connectedCallback(): void {
		super.connectedCallback?.();

		// One-shot bootstrap attribute: cache-then-clear, safe across startup remounts
		const context = this.consumeOneShotAttribute(this.context);
		this.context = undefined!;
		this.initWebviewContext(context);

		const metadata = JSON.parse(fromBase64ToString(context)) as State;
		this._state.loading.set(metadata.loading);
	}

	override disconnectedCallback(): void {
		this._eventsSubscription?.unsubscribe();
		this._eventsSubscription = undefined;
		this._service = undefined;

		this._state.resetAll();

		super.disconnectedCallback?.();
	}

	private async _onRpcReady(services: Remote<{Name}Services>): Promise<void> {
		const service = await services.{name};
		this._service = service;

		// Subscribe FIRST, before fetching — subscriptions are re-armed per handshake and
		// save-last events re-emit the latest snapshot on connect.
		this._eventsSubscription?.unsubscribe();
		this._eventsSubscription = subscribe<{Name}Services>(this._rpc.connection!, async remoteServices => {
			(await remoteServices.{name}).onDataChanged(() => {
				/* update signals */
			});
		});
	}
}
```

Readiness needs no message — each mount's session announces itself over RPC and `_onRpcReady`
runs against the fresh connection. Focus/visibility arrive via window CustomEvents dispatched by
`RpcController`; override `onWebviewFocusChanged`/`onWebviewVisibilityChanged` if needed.

### 6. State: `src/webviews/apps/{name}/state.ts`

```typescript
import { createSignalGroup } from '../shared/state/signals.js';

export function create{Name}State() {
	const { signal, resetAll } = createSignalGroup();

	const loading = signal(false);

	return {
		loading: loading,
		resetAll: resetAll,
	};
}
```

Use `createStateGroup()` + `persisted()` instead of plain signals for navigation/UI state that
must survive hide/show (see `docs/webview-architecture.md`, "State groups and persistence").

### 7. Styles: `src/webviews/apps/{name}/{name}.css.ts`

```typescript
import { css } from 'lit';

export const styles = css`
    :host { display: block; height: 100%; }
    .{name} { padding: 1rem; }
`;
```

## Accessibility

For accessibility requirements when creating or modifying webview components, see `docs/accessibility.md`.

## Additional Steps

8. **Webpack entry** — Add to `getWebviewsConfigs()` in `webpack.config.mjs`
9. **Register** in `src/container.ts` (call your `register{Name}Webview*` function)
10. **View ID** — Add to `src/constants.views.ts`
11. **Build** — `pnpm run build:webviews`

## File Locations

| Component         | Community                   | Pro                              |
| ----------------- | --------------------------- | -------------------------------- |
| Protocol/Provider | `src/webviews/{name}/`      | `src/webviews/plus/{name}/`      |
| RPC service       | `src/webviews/rpc/`         |                                  |
| App               | `src/webviews/apps/{name}/` | `src/webviews/apps/plus/{name}/` |
