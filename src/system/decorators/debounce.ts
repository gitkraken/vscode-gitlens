import type { DebounceOptions } from '../function/debounce';
import { debounce as _debounce } from '../function/debounce';

export function debounce<F extends (...args: any[]) => ReturnType<F>>(wait: number, options?: DebounceOptions<F>) {
	return (_target: any, key: string, descriptor: PropertyDescriptor & Record<string, any>): PropertyDescriptor => {
		if (typeof descriptor.value !== 'function') {
			throw new Error(`@debounce can only be used on methods, not on ${typeof descriptor.value}`);
		}

		const original = descriptor.value;

		// Replace the descriptor value with a function that creates a debounced version
		// of the original method for each instance
		descriptor.value = function (...args: any[]) {
			// Instance-specific storage key
			const debounceKey = `__debounced_${key}`;

			// Create the debounced function if it doesn't exist on this instance
			this[debounceKey] ??= _debounce(
				(...innerArgs: any[]) => original.apply(this, innerArgs) as ReturnType<F>,
				wait,
				options,
			);

			// Call the per-instance debounced function
			return this[debounceKey](...args) as ReturnType<F>;
		};

		return descriptor;
	};
}
