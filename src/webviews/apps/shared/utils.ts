export function throttle(callback: (this: unknown, ...args: unknown[]) => unknown, limit: number) {
	let waiting = false;
	let pending = false;
	return function (this: unknown, ...args: unknown[]) {
		if (waiting) {
			pending = true;
			return;
		}

		callback.apply(this, args);
		waiting = true;

		setTimeout(() => {
			waiting = false;
			if (pending) {
				callback.apply(this, args);
				pending = false;
			}
		}, limit);
	};
}
