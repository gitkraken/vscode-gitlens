import { LitElement } from 'lit';

export type GlEvents<Prefix extends string = ''> = Record<`gl-${Prefix}${string}`, CustomEvent>;
type GlEventsUnwrapped<Events extends GlEvents> = {
	[P in Extract<keyof Events, `gl-${string}`>]: UnwrapCustomEvent<Events[P]>;
};

export abstract class GlElement<Events extends GlEvents = GlEvents> extends LitElement {
	fireEvent<T extends keyof GlEventsUnwrapped<Events>>(
		name: T,
		detail?: GlEventsUnwrapped<Events>[T] | undefined,
	): boolean {
		return this.dispatchEvent(new CustomEvent<GlEventsUnwrapped<Events>[T]>(name, { detail: detail }));
	}
}
