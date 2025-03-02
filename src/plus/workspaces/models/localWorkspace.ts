import type { Disposable } from 'vscode';
import type { Container } from '../../../container';
import type { WorkspaceRepositoriesByName, WorkspaceType } from './workspaces';

export class LocalWorkspace {
	readonly type = 'local' satisfies WorkspaceType;

	private _localPath: string | undefined;
	private _repositoriesByName: WorkspaceRepositoriesByName | undefined;
	private _disposable: Disposable;

	constructor(
		public readonly container: Container,
		public readonly id: string,
		public readonly name: string,
		private readonly repositoryDescriptors: LocalWorkspaceRepositoryDescriptor[],
		public readonly current: boolean,
		localPath?: string,
	) {
		this._localPath = localPath;
		this._disposable = this.container.git.onDidChangeRepositories(this.resetRepositoriesByName, this);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	get shared(): boolean {
		return false;
	}

	get localPath(): string | undefined {
		return this._localPath;
	}

	resetRepositoriesByName(): void {
		this._repositoriesByName = undefined;
	}

	async getRepositoriesByName(options?: { force?: boolean }): Promise<WorkspaceRepositoriesByName> {
		if (this._repositoriesByName == null || options?.force) {
			this._repositoriesByName = await this.container.workspaces.resolveWorkspaceRepositoriesByName(this.id, {
				resolveFromPath: true,
				usePathMapping: true,
			});
		}

		return this._repositoriesByName;
	}

	getRepositoryDescriptors(): Promise<LocalWorkspaceRepositoryDescriptor[]> {
		return Promise.resolve(this.repositoryDescriptors);
	}

	getRepositoryDescriptor(name: string): Promise<LocalWorkspaceRepositoryDescriptor | undefined> {
		return Promise.resolve(this.repositoryDescriptors.find(r => r.name === name));
	}

	setLocalPath(localPath: string | undefined): void {
		this._localPath = localPath;
	}
}

export interface LocalWorkspaceDescriptor {
	localId: string;
	profileId: string;
	name: string;
	description: string;
	repositories: LocalWorkspaceRepositoryPath[];
	version: number;
}

export interface LocalWorkspaceRepositoryDescriptor extends LocalWorkspaceRepositoryPath {
	id?: undefined;
	name: string;
	workspaceId: string;
}

interface LocalWorkspaceRepositoryPath {
	localPath: string;
}

export type LocalWorkspaceData = Record<string, LocalWorkspaceDescriptor>;

export interface LocalWorkspaceFileData {
	workspaces: LocalWorkspaceData;
}
