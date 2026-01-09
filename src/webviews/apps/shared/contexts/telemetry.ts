import { createContext } from '@lit/context';
import type { TelemetrySendEventParams } from '../../../protocol.js';
import { TelemetrySendEventCommand } from '../../../protocol.js';
import type { Disposable } from '../events.js';
import type { HostIpc } from '../ipc.js';

export class TelemetryContext implements Disposable {
	private readonly ipc: HostIpc;
	private readonly disposables: Disposable[] = [];

	constructor(ipc: HostIpc) {
		this.ipc = ipc;
	}

	sendEvent(detail: TelemetrySendEventParams): void {
		this.ipc.sendCommand(TelemetrySendEventCommand, detail);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

export const telemetryContext = createContext<unknown>('telemetry');
