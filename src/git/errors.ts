export const enum StashApplyErrorReason {
	WorkingChanges = 1,
}

export class StashApplyError extends Error {
	constructor(
		message: string,
		public readonly reason: StashApplyErrorReason | undefined,
		public readonly original?: Error,
	) {
		super(message);

		Error.captureStackTrace?.(this, StashApplyError);
	}
}
