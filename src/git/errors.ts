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
