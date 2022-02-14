import { Disposable, Event } from 'vscode';

export function once<T>(event: Event<T>): Event<T> {
	return (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => {
		const result = event(
			e => {
				result.dispose();
				return listener.call(thisArgs, e);
			},
			null,
			disposables,
		);

		return result;
	};
}

export function promisify<T>(event: Event<T>): Promise<T> {
	return new Promise<T>(resolve => once(event)(resolve));
}

export function until<T>(event: Event<T>, predicate: (e: T) => boolean): Event<T> {
	return (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => {
		const result = event(
			e => {
				if (predicate(e)) {
					result.dispose();
				}
				return listener.call(thisArgs, e);
			},
			null,
			disposables,
		);

		return result;
	};
}
