import { signal } from '@lit-labs/signals';
import { AsyncComputed } from 'signal-utils/async-computed';

export const renderAsyncComputed = <T, R = unknown>(
	v: AsyncComputed<T>,
	{
		initial,
		pending,
		complete,
		error,
	}: {
		initial?: () => R;
		pending?: () => R;
		complete?: (value: T | undefined) => R;
		error?: (error: unknown) => R;
	},
) => {
	switch (v.status) {
		case 'initial':
			return initial?.();
		case 'pending':
			return pending?.();
		case 'complete':
			return complete?.(v.value);
		case 'error':
			return error?.(v.error);
	}
};

export class AsyncComputedState<T, R = unknown> {
	private _invalidate = signal(0);
	private _computed?: AsyncComputed<T>;
	private _state = signal<T | undefined>(undefined);
	get state() {
		this.computed.run();
		return this._state.get();
	}

	get computed() {
		if (this._computed == null) {
			const initial = this._state.get();
			this._computed = new AsyncComputed(
				async (abortSignal: AbortSignal) => {
					this._invalidate.get();

					const state = await this._fetch(abortSignal);
					this._state.set(state);

					return state;
				},
				initial ? { initialValue: initial } : undefined,
			);
		}

		return this._computed;
	}

	constructor(
		private _fetch: (abortSignal: AbortSignal) => Promise<T>,
		options?: {
			autoRun?: boolean;
			initial?: T;
		},
	) {
		if (options != null) {
			this._state.set(options.initial);

			if (options.autoRun === true) {
				this.run();
			}
		}
	}
	run(force = false) {
		if (force) {
			this.invalidate();
		}
		this.computed.run();
	}

	invalidate() {
		this._invalidate.set(Date.now());
	}

	render(config: {
		initial?: () => R;
		pending?: () => R;
		complete?: (value: T | undefined) => R;
		error?: (error: unknown) => R;
	}) {
		return renderAsyncComputed(this.computed, config);
	}
}
