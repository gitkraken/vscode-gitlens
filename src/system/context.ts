import { EventEmitter } from 'vscode';
import type { ContextKeys } from '../constants';
import { executeCoreCommand } from './command';

const contextStorage = new Map<string, unknown>();

const _onDidChangeContext = new EventEmitter<ContextKeys>();
export const onDidChangeContext = _onDidChangeContext.event;

export function getContext<T>(key: ContextKeys): T | undefined;
export function getContext<T>(key: ContextKeys, defaultValue: T): T;
export function getContext<T>(key: ContextKeys, defaultValue?: T): T | undefined {
	return (contextStorage.get(key) as T | undefined) ?? defaultValue;
}

export async function setContext(key: ContextKeys, value: unknown): Promise<void> {
	contextStorage.set(key, value);
	void (await executeCoreCommand('setContext', key, value));
	_onDidChangeContext.fire(key);
}
