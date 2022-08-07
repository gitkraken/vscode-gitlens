import type { CancellationToken, Disposable } from 'vscode';
import { CancellationTokenSource } from 'vscode';

export class TimedCancellationSource implements CancellationTokenSource, Disposable {
	private readonly cancellation = new CancellationTokenSource();
	private readonly timer: ReturnType<typeof setTimeout>;

	constructor(timeout: number) {
		this.timer = setTimeout(() => this.cancellation.cancel(), timeout);
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.cancellation.dispose();
	}

	cancel(): void {
		clearTimeout(this.timer);
		this.cancellation.cancel();
	}

	get token(): CancellationToken {
		return this.cancellation.token;
	}
}
