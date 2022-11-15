import { commands, EventEmitter } from 'vscode';
import type { ContextKeys } from './constants';
import { CoreCommands } from './constants';

const contextStorage = new Map<string, unknown>();

type WebviewContextKeys =
	| `${ContextKeys.WebviewPrefix}${string}:active`
	| `${ContextKeys.WebviewPrefix}${string}:focus`
	| `${ContextKeys.WebviewPrefix}${string}:inputFocus`;

type WebviewViewContextKeys =
	| `${ContextKeys.WebviewViewPrefix}${string}:focus`
	| `${ContextKeys.WebviewViewPrefix}${string}:inputFocus`;

type AllContextKeys =
	| ContextKeys
	| WebviewContextKeys
	| WebviewViewContextKeys
	| `${ContextKeys.ActionPrefix}${string}`
	| `${ContextKeys.KeyPrefix}${string}`;

const _onDidChangeContext = new EventEmitter<AllContextKeys>();
export const onDidChangeContext = _onDidChangeContext.event;

export function getContext<T>(key: ContextKeys): T | undefined;
export function getContext<T>(key: ContextKeys, defaultValue: T): T;
export function getContext<T>(key: ContextKeys, defaultValue?: T): T | undefined {
	return (contextStorage.get(key) as T | undefined) ?? defaultValue;
}

export async function setContext(key: AllContextKeys, value: unknown): Promise<void> {
	contextStorage.set(key, value);
	void (await commands.executeCommand(CoreCommands.SetContext, key, value));
	_onDidChangeContext.fire(key);
}
