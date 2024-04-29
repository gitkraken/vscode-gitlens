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
}
