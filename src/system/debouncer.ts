import type { Disposable } from 'vscode';
import type { Deferrable } from './function';
import { debounce } from './function';

interface Task<T> {
	(): T;
}

export class Debouncer<T = void> implements Disposable {
	private readonly deferrable: Deferrable<(task: Task<T | Promise<T>>) => Promise<T | undefined>>;

	constructor(public readonly delay: number) {
		this.deferrable = debounce(this.call.bind(this), delay);
	}

	dispose(): void {
		this.deferrable.cancel();
	}

	debounce(task: Task<T | Promise<T>>): Promise<T | undefined> {
		return Promise.resolve(this.deferrable(task));
	}

	private call(task: Task<T | Promise<T>>): Promise<T | undefined> {
		return Promise.resolve(task());
	}
}
