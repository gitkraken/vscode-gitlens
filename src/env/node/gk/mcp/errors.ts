export const enum McpSetupErrorReason {
	WebUnsupported,
	VSCodeVersionUnsupported,
	CLIUnsupportedPlatform,
	CLILocalInstallFailed,
	CLIBinaryLocked,
	CLIUnknownError,
	InstallationFailed,
	UnsupportedHost,
	UnsupportedClient,
	UnexpectedOutput,
	Offline,
}

export class McpSetupError extends Error {
	readonly reason: McpSetupErrorReason;
	readonly telemetryReason: string;
	readonly source: string;
	readonly cliVersion?: string;
	readonly telemetryMessage?: string;

	constructor(
		reason: McpSetupErrorReason,
		message: string,
		telemetryReason: string,
		source: string,
		cliVersion?: string,
		telemetryMessage?: string,
	) {
		super(message);
		this.reason = reason;
		this.telemetryReason = telemetryReason;
		this.source = source;
		this.cliVersion = cliVersion;
		this.telemetryMessage = telemetryMessage;
		Error.captureStackTrace?.(this, new.target);
	}
}
