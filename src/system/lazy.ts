/** Provides lazy initialization support */
export class Lazy<T> {
	private _value?: T;
	private _initialized: boolean = false;

	/**
	 * Creates a new instance of Lazy<T> that uses the specified initialization function.
	 * @param valueProvider The initialization function that is used to produce the value when it is needed.
	 */
	constructor(private readonly valueProvider: () => T) {}

	/** Gets the lazily initialized value of the current Lazy<T> instance */
	get value(): T {
		if (!this._initialized) {
			this._value = this.valueProvider();
			this._initialized = true;
		}

		return this._value!;
	}
}

/** Creates a new lazy value with the specified initialization function */
export function lazy<T>(valueProvider: () => T): Lazy<T> {
	return new Lazy<T>(valueProvider);
}
