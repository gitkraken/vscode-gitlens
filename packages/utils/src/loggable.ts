export interface Loggable {
	toLoggable(): string;
}

export function isLoggable(o: unknown): o is Loggable {
	return o != null && typeof o === 'object' && 'toLoggable' in o && typeof (o as Loggable).toLoggable === 'function';
}
