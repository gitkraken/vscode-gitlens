import type { GitCommandOptions } from '../git/commandOptions';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class RequestType<Request, Response> {
	constructor(public readonly name: string) {}
}

export interface GitCommandRequest {
	options: GitCommandOptions;
	args: any[];
}

export interface GitCommandResponse {
	data: string;
	isBuffer?: boolean;
}

export const GitCommandRequestType = new RequestType<GitCommandRequest, GitCommandResponse>('git');

export interface RepositoryProxy {
	folderUri: string;
	/** @deprecated */
	path?: string;
	root: boolean;
	closed: boolean;
}

export interface GetRepositoriesForUriRequest {
	folderUri: string;
}

export interface GetRepositoriesForUriResponse {
	repositories: RepositoryProxy[];
}

export const GetRepositoriesForUriRequestType = new RequestType<
	GetRepositoriesForUriRequest,
	GetRepositoriesForUriResponse
>('repositories/inFolder');
