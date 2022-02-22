export function throttle(callback: (this: any, ...args: any[]) => any, limit: number) {
	let waiting = false;
	let pending = false;
	return function (this: any, ...args: any[]) {
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
