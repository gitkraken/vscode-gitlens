'use strict';
import { Uri } from 'vscode';
import { GitProviderId, GitProviderService } from './gitProviderService';

export class ProviderNotFoundError extends Error {
	readonly id: GitProviderId;

	constructor(id: GitProviderId);
	constructor(uri: Uri);
	constructor(idOrUri: GitProviderId | Uri);
	constructor(idOrUri: GitProviderId | Uri) {
		const id = typeof idOrUri === 'string' ? idOrUri : GitProviderService.getProviderId(idOrUri);
		super(`No provider registered with ${id}`);

		this.id = id;
		Error.captureStackTrace?.(this, ProviderNotFoundError);
	}
}

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
