/** Provides lazy initialization support */
export class Lazy<T> {
	private _evaluated: boolean = false;
	get evaluated(): boolean {
		return this._evaluated;
	}

	private _exception: Error | undefined;
	private _value?: T;

	/**
	 * Creates a new instance of Lazy<T> that uses the specified initialization function.
	 * @param valueProvider The initialization function that is used to produce the value when it is needed.
	 */
	constructor(private readonly valueProvider: () => T) {}

	/** Gets the lazily initialized value of the current Lazy<T> instance */
	get value(): T {
		if (!this._evaluated) {
			try {
				this._value = this.valueProvider();
			} catch (ex) {
				this._exception = ex;
				throw ex;
			} finally {
				this._evaluated = true;
			}
		}

		if (this._exception) throw this._exception;

		return this._value!;
	}
}

/** Creates a new lazy value with the specified initialization function */
export function lazy<T>(valueProvider: () => T): Lazy<T> {
	return new Lazy<T>(valueProvider);
}
