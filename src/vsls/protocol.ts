'use strict';
import { GitCommandOptions } from '../git/git';

export class RequestType<TRequest, TResponse> {
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

export interface WorkspaceFileExistsRequest {
    fileName: string;
    repoPath: string;
    options: { ensureCase: boolean };
}

export interface WorkspaceFileExistsResponse {
    exists: boolean;
}

export const WorkspaceFileExistsRequestType = new RequestType<WorkspaceFileExistsRequest, WorkspaceFileExistsResponse>(
    'workspace/fileExists'
);
