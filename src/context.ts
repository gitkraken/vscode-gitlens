import { commands, EventEmitter } from 'vscode';
import type { ContextKeys } from './constants';
import { CoreCommands } from './constants';
import type { WebviewIds } from './webviews/webviewBase';
import type { WebviewViewIds } from './webviews/webviewViewBase';

const contextStorage = new Map<string, unknown>();

type WebviewContextKeys =
	| `${ContextKeys.WebviewPrefix}${WebviewIds}:active`
	| `${ContextKeys.WebviewPrefix}${WebviewIds}:focus`
	| `${ContextKeys.WebviewPrefix}${WebviewIds}:inputFocus`
	| `${ContextKeys.WebviewPrefix}rebaseEditor:active`
	| `${ContextKeys.WebviewPrefix}rebaseEditor:focus`
	| `${ContextKeys.WebviewPrefix}rebaseEditor:inputFocus`;

type WebviewViewContextKeys =
	| `${ContextKeys.WebviewViewPrefix}${WebviewViewIds}:focus`
	| `${ContextKeys.WebviewViewPrefix}${WebviewViewIds}:inputFocus`;

type AllContextKeys =
	| ContextKeys
	| WebviewContextKeys
	| WebviewViewContextKeys
	| `${ContextKeys.ActionPrefix}${string}`
	| `${ContextKeys.KeyPrefix}${string}`;

const _onDidChangeContext = new EventEmitter<AllContextKeys>();
export const onDidChangeContext = _onDidChangeContext.event;

export function getContext<T>(key: AllContextKeys): T | undefined;
export function getContext<T>(key: AllContextKeys, defaultValue: T): T;
export function getContext<T>(key: AllContextKeys, defaultValue?: T): T | undefined {
	return (contextStorage.get(key) as T | undefined) ?? defaultValue;
}

export async function setContext(key: AllContextKeys, value: unknown): Promise<void> {
	contextStorage.set(key, value);
	void (await commands.executeCommand(CoreCommands.SetContext, key, value));
	_onDidChangeContext.fire(key);
}
