const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

export type Counter = { readonly current: number; next(): number };

export function getScopedCounter(): Counter {
	let counter = 0;
	return {
		get current() {
			return counter;
		},
		next: function () {
			if (counter === maxSmallIntegerV8) {
				counter = 0;
			}
			return ++counter;
		},
	};
}
