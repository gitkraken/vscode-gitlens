import { QuickPickItem } from 'vscode';
import { QuickPickItemOfT } from './common';

export type FlagsQuickPickItem<T> = QuickPickItemOfT<T[]>;
export namespace FlagsQuickPickItem {
	export function create<T>(flags: T[], item: T[], options: QuickPickItem) {
		return { ...options, item: item, picked: hasFlags(flags, item) };
	}
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
