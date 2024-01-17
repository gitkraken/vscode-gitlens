import type { QuickPickItem } from 'vscode';
import type { QuickPickItemOfT } from './common';

export type FlagsQuickPickItem<T, Context = void> = QuickPickItemOfT<T[]> & { context: Context };

export function createFlagsQuickPickItem<T>(flags: T[], item: T[], options: QuickPickItem): FlagsQuickPickItem<T>;
export function createFlagsQuickPickItem<T, Context>(
	flags: T[],
	item: T[],
	options: QuickPickItem,
	context: Context,
): FlagsQuickPickItem<T, Context>;
export function createFlagsQuickPickItem<T, Context = void>(
	flags: T[],
	item: T[],
	options: QuickPickItem,
	context?: Context,
): any {
	return { ...options, item: item, picked: options.picked ?? hasFlags(flags, item), context: context };
}

function hasFlags<T>(flags: T[], has?: T | T[]): boolean {
	if (has === undefined) {
		return flags.length === 0;
	}
	if (!Array.isArray(has)) {
		return flags.includes(has);
	}

	return has.length === 0 ? flags.length === 0 : has.every(f => flags.includes(f));
}
