interface RunErrorContext {
	message: string;
	cmd?: string | undefined;
	killed?: boolean | undefined;
	code?: string | number | null | undefined;
	signal?: NodeJS.Signals | undefined;
}

export class RunError extends Error {
	readonly cmd?: string | undefined;
	readonly killed?: boolean | undefined;
	readonly code?: string | number | undefined;
	readonly signal?: NodeJS.Signals | undefined;
	readonly stdout: string;
	readonly stderr: string;

	constructor(context: RunErrorContext, stdout: string, stderr: string) {
		super(context.message);

		this.cmd = context.cmd;
		this.killed = context.killed;
		this.code = context.code ?? undefined;
		this.signal = context.signal;
		this.stdout = stdout?.trim() ?? '';
		this.stderr = stderr?.trim() ?? '';

		this.name = 'RunError';
		Error.captureStackTrace?.(this, new.target);
	}
}

export class CancelledRunError extends RunError {
	constructor(cmd: string, killed: boolean, code?: number | string | undefined, signal: NodeJS.Signals = 'SIGTERM') {
		super(
			{ message: `Operation cancelled; command=${cmd}`, cmd: cmd, killed: killed, code: code, signal: signal },
			'',
			'',
		);

		this.name = 'CancelledRunError';
		Error.captureStackTrace?.(this, new.target);
	}
}
