import { Signal, signal } from '@lit-labs/signals';
import { AsyncComputed } from 'signal-utils/async-computed';
import { signalObject } from 'signal-utils/object';
import type { Deferrable } from '../../../../system/function/debounce';
import { debounce } from '../../../../system/function/debounce';

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
): R | undefined => {
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
	get state(): T | undefined {
		this._run();
		return this._state.get();
	}

	get computed(): AsyncComputed<T> {
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
	protected _run(immediate = false): void {
		if (immediate) {
			this._runCore();
			return;
		}

		if (this._runDebounced == null) {
			this._runDebounced = debounce(this._runCore.bind(this), this._debounce);
		}

		this._runDebounced();
	}
	run(force = false): void {
		if (force) {
			this.invalidate();
		}

		this._run();
	}

	invalidate(): void {
		this._invalidate.set(Date.now());
	}

	render(config: {
		initial?: () => R;
		pending?: () => R;
		complete?: (value: T | undefined) => R;
		error?: (error: unknown) => R;
	}): R | undefined {
		return renderAsyncComputed(this.computed, config);
	}
}

export function signalState<T>(initialValue?: T, options?: { afterChange?: (target: any, value: T) => void }) {
	return (target: any, _fieldName: string, targetFields: { get?: () => T; set?: (v: T) => void }) => {
		if (targetFields.get && targetFields.set) {
			const signal = new Signal.State(initialValue);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return {
				get: function () {
					return signal.get();
				},
				set: function (value: T) {
					signal.set(value);
					options?.afterChange?.(target, value);
				},
			} as any;
		}
		throw new Error(`@signal can only be used on accessors or getters`);
	};
}

export const signalObjectState = <T extends Record<PropertyKey, unknown> | undefined>(
	initialValue?: T,
	options?: { afterChange?: (target: any, value: T) => void },
) => {
	return (target: any, _fieldName: string, targetFields: { get?: () => T; set?: (v: T) => void }) => {
		if (targetFields.get && targetFields.set) {
			const signal = signalObject(initialValue);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return {
				get: function () {
					// Don't return {...signal} for optimization purpose
					return signal;
				},
				set: function (value: any) {
					for (const [k, v] of Object.entries(value)) {
						signal[k] = v;
					}
					options?.afterChange?.(target, value);
				},
			} as any;
		}
		throw new Error(`@signal can only be used on accessors or getters`);
	};
};
