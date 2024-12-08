import { signal } from '@lit-labs/signals';
import { AsyncComputed } from 'signal-utils/async-computed';
import type { Deferrable } from '../../../../system/function';
import { debounce } from '../../../../system/function';

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
	private _debounce = 500;
	private _invalidate = signal(0);
	private _computed?: AsyncComputed<T>;
	private _state = signal<T | undefined>(undefined);
	get state() {
		this._run();
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
			debounce?: number;
		},
	) {
		if (options != null) {
			this._state.set(options.initial);

			if (options.debounce != null) {
				this._debounce = options.debounce;
			}

			if (options.autoRun === true) {
				this.run();
			}
		}
	}
	private _runCore() {
		this.computed.run();
	}

	private _runDebounced: Deferrable<() => void> | undefined;
	protected _run(immediate = false) {
		if (immediate) {
			this._runCore();
			return;
		}

		if (this._runDebounced == null) {
			this._runDebounced = debounce(this._runCore.bind(this), this._debounce);
		}

		this._runDebounced();
	}
	run(force = false) {
		if (force) {
			this.invalidate();
		}

		this._run();
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
