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
