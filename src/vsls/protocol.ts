'use strict';
import { GitCommandOptions } from '../git/git';

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
	path: string;
	root: boolean;
	closed: boolean;
}

export interface RepositoriesInFolderRequest {
	folderUri: string;
}

export interface RepositoriesInFolderResponse {
	repositories: RepositoryProxy[];
}

export const RepositoriesInFolderRequestType = new RequestType<
	RepositoriesInFolderRequest,
	RepositoriesInFolderResponse
>('repositories/inFolder');
