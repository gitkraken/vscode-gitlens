export function serialize(): (target: any, key: string, descriptor: PropertyDescriptor) => void {
	return (_target: any, key: string, descriptor: PropertyDescriptor) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn === undefined) throw new Error('Not supported');

		const serializeKey = `$serialize$${key}`;

		descriptor.value = function (this: any, ...args: any[]) {
			if (!Object.prototype.hasOwnProperty.call(this, serializeKey)) {
				Object.defineProperty(this, serializeKey, {
					configurable: false,
					enumerable: false,
					writable: true,
					value: undefined,
				});
			}

			let promise: Promise<any> | undefined = this[serializeKey];
			// eslint-disable-next-line no-return-await, @typescript-eslint/no-unsafe-return
			const run = async () => await fn.apply(this, args);
			if (promise == null) {
				promise = run();
			} else {
				promise = promise.then(run, run);
			}

			this[serializeKey] = promise;
			return promise;
		};
	};
}
