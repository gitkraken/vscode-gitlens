import type { PropertyValues } from 'lit';
import { LitElement } from 'lit';

export type CustomEventType<T extends keyof GlobalEventHandlersEventMap> =
	GlobalEventHandlersEventMap[T] extends CustomEvent<infer D>
		? [D] extends [never]
			? CustomEvent<never>
			: [unknown] extends [D]
			  ? CustomEvent<unknown>
			  : CustomEvent<D>
		: never;
type CustomEventDetailType<T extends keyof GlobalEventHandlersEventMap> = CustomEventType<T>['detail'];

type RequiresDetail<T> = T extends CustomEvent<infer D> ? (D extends never | void | undefined ? never : T) : never;

type EventTypesWithRequiredDetail = {
	[K in keyof GlobalEventHandlersEventMap]: RequiresDetail<GlobalEventHandlersEventMap[K]> extends never ? never : K;
}[keyof GlobalEventHandlersEventMap];

type Observer = {
	method: (changedKeys: PropertyKey[]) => void;
	keys: PropertyKey[];
	afterFirstUpdate?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const observersForClass = new WeakMap<Function, Observer[]>();
export function observe<T extends GlElement>(keys: keyof T | (keyof T)[], options?: { afterFirstUpdate?: boolean }) {
	return function (target: T, _propertyKey: string, descriptor: PropertyDescriptor) {
		let observers = observersForClass.get(target.constructor);
		if (observers == null) {
			observersForClass.set(target.constructor, (observers = []));
		}
		observers.push({
			method: descriptor.value,
			keys: Array.isArray(keys) ? keys : [keys],
			afterFirstUpdate: options?.afterFirstUpdate ?? false,
		});
	};
}

// Use this when we switch to native decorators
// const observersForClass = new WeakMap<DecoratorMetadataObject, Array<Observer>>();
// export function observe<T extends GlElement>(keys: keyof T | (keyof T)[], options?: { afterFirstUpdate?: boolean }) {
// 	return <C, V extends (this: C, ...args: any) => any>(method: V, context: ClassMethodDecoratorContext<C, V>) => {
// 		let observers = observersForClass.get(context.metadata);
// 		if (observers === undefined) {
// 			observersForClass.set(context.metadata, (observers = []));
// 		}
// 		observers.push({
// 			method: method,
// 			keys: Array.isArray(keys) ? keys : [keys],
// 			afterFirstUpdate: options?.afterFirstUpdate ?? false,
// 		});
// 	};
// }

export abstract class GlElement extends LitElement {
	emit<T extends EventTypesWithRequiredDetail>(
		name: T,
		detail: CustomEventDetailType<T>,
		options?: Omit<CustomEventInit<CustomEventDetailType<T>>, 'detail'>,
	): CustomEventType<T>;
	emit<T extends keyof GlobalEventHandlersEventMap>(
		name: T,
		detail?: CustomEventDetailType<T>,
		options?: Omit<CustomEventInit<CustomEventDetailType<T>>, 'detail'>,
	): CustomEventType<T>;
	emit<T extends keyof GlobalEventHandlersEventMap>(
		name: T,
		detail: CustomEventDetailType<T>,
		options?: Omit<CustomEventInit<CustomEventDetailType<T>>, 'detail'>,
	): CustomEventType<T> {
		const event = new CustomEvent(name, {
			bubbles: true,
			cancelable: false,
			composed: true,
			...options,
			detail: detail,
		});

		this.dispatchEvent(event);

		return event as CustomEventType<T>;
	}

	override update(changedProperties: PropertyValues) {
		// Use this line when we switch to native decorators
		// const meta = (this.constructor as typeof GlElement)[Symbol.metadata];
		const observers = observersForClass.get(this.constructor); //meta);
		if (observers != null) {
			for (const { keys, method, afterFirstUpdate } of observers) {
				if (afterFirstUpdate && !this.hasUpdated) {
					continue;
				}

				const changedKeys = keys.filter(p => changedProperties.has(p));
				if (changedKeys.length) {
					method.call(this, changedKeys);
				}
			}
		}
		super.update(changedProperties);
	}
}
