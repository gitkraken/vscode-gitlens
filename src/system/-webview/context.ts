import { EventEmitter } from 'vscode';
import type { ContextKeys } from '../../constants.context.js';
import { maybeStartLoggableScope } from '../logger.scope.js';
import { executeCoreCommand } from './command.js';

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
	using scope = maybeStartLoggableScope(
		`Context.setContext(${key}, ${value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' ? value : `<value:${typeof value}>`})`,
		{ level: 'trace', onlyExit: true },
	);

	if (contextStorage.get(key) === value) {
		scope?.addExitInfo('ignored; value unchanged');
		return;
	}

	if (value == null) {
		contextStorage.delete(key);
	} else {
		contextStorage.set(key, value);
	}
	void (await executeCoreCommand('setContext', key, value ?? undefined));
	_onDidChangeContext.fire(key);
}

export async function addToContextDelimitedString<T extends keyof ContextKeys>(
	key: T,
	values: ContextKeys[T] extends string ? string[] : never,
	delimiter: string = '|',
): Promise<void> {
	const current = getContext(key);
	const currentArray = typeof current === 'string' && current.length > 0 ? current.split(delimiter) : [];

	if (currentArray.length === 0) {
		return setContext(key, values.join(delimiter) as ContextKeys[T]);
	}

	const merged = [...new Set([...currentArray, ...values])];
	return setContext(key, merged.join(delimiter) as ContextKeys[T]);
}

export async function removeFromContextDelimitedString<T extends keyof ContextKeys>(
	key: T,
	values: ContextKeys[T] extends string ? string[] : never,
	delimiter: string = '|',
): Promise<void> {
	const current = getContext(key);
	if (typeof current !== 'string' || current.length === 0 || values.length === 0) {
		return;
	}

	const currentArray = current.split(delimiter);
	const filtered = currentArray.filter(v => !values.includes(v));

	if (filtered.length === 0) {
		return setContext(key, undefined);
	}

	return setContext(key, filtered.join(delimiter) as ContextKeys[T]);
}

export function includesContextDelimitedString<T extends keyof ContextKeys>(
	key: T,
	value: ContextKeys[T] extends string ? string : never,
	delimiter: string = '|',
): boolean {
	const current = getContext(key);
	if (typeof current !== 'string' || current.length === 0) return false;

	return current.split(delimiter).includes(value);
}
