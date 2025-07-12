import { EventEmitter } from 'vscode';
import type { ContextKeys } from '../../constants.context';
import { executeCoreCommand } from './command';

const contextStorage = new Map<keyof ContextKeys, unknown>();

const _onDidChangeContext = new EventEmitter<keyof ContextKeys>();
export const onDidChangeContext = _onDidChangeContext.event;

export function getContext<T extends keyof ContextKeys>(key: T): ContextKeys[T] | undefined;
export function getContext<T extends keyof ContextKeys>(key: T, defaultValue: ContextKeys[T]): ContextKeys[T];
export function getContext<T extends keyof ContextKeys>(
	key: T,
	defaultValue?: ContextKeys[T],
): ContextKeys[T] | undefined {
	return (contextStorage.get(key) as ContextKeys[T] | undefined) ?? defaultValue;
}

export async function setContext<T extends keyof ContextKeys>(
	key: T,
	value: ContextKeys[T] | undefined,
): Promise<void> {
	if (contextStorage.get(key) === value) return;

	if (value == null) {
		contextStorage.delete(key);
	} else {
		contextStorage.set(key, value);
	}
	void (await executeCoreCommand('setContext', key, value ?? undefined));
	_onDidChangeContext.fire(key);
}
