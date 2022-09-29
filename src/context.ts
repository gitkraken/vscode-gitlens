import { commands, EventEmitter } from 'vscode';
import type { ContextKeys } from './constants';
import { CoreCommands } from './constants';

const contextStorage = new Map<string, unknown>();

const _onDidChangeContext = new EventEmitter<
	ContextKeys | `${ContextKeys.ActionPrefix}${string}` | `${ContextKeys.KeyPrefix}${string}`
>();
export const onDidChangeContext = _onDidChangeContext.event;

export function getContext<T>(key: ContextKeys): T | undefined;
export function getContext<T>(key: ContextKeys, defaultValue: T): T;
export function getContext<T>(key: ContextKeys, defaultValue?: T): T | undefined {
	return (contextStorage.get(key) as T | undefined) ?? defaultValue;
}

export async function setContext(
	key: ContextKeys | `${ContextKeys.ActionPrefix}${string}` | `${ContextKeys.KeyPrefix}${string}`,
	value: unknown,
): Promise<void> {
	contextStorage.set(key, value);
	void (await commands.executeCommand(CoreCommands.SetContext, key, value));
	_onDidChangeContext.fire(key);
}
