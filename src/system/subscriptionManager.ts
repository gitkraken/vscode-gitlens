type Status = 'started' | 'paused' | 'stopped';

export class SubscriptionManager<T> {
	private _status: Status = 'stopped';
	get status(): Status {
		return this._status;
	}

	private _subscription: { dispose: () => void } | undefined;

	constructor(
		public readonly source: T,
		private readonly subscribe: (source: T) => { dispose: () => void },
	) {}

	dispose(): void {
		this.stop();
	}

	start(): void {
		if (this._subscription != null && this._status === 'started') return;

		this._subscription = this.subscribe(this.source);
		this._status = 'started';
	}

	pause(): void {
		this.stop('paused');
	}

	resume(): void {
		this.start();
	}

	private stop(status?: Status): void {
		this._subscription?.dispose();
		this._subscription = undefined;
		this._status = status ?? 'stopped';
	}
}
