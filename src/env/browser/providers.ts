import type { Disposable } from 'vscode';
import type { Container } from '../../container.js';
import type { GitExecOptions, GitResult } from '../../git/execTypes.js';
// Force import of GitHub since dynamic imports are not supported in the WebWorker ExtensionHost
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GitProvider } from '../../git/gitProvider.js';
import type { RepositoryLocationProvider } from '../../git/location/repositorylocationProvider.js';
import { GitHubGitProvider } from '../../plus/integrations/providers/github/githubGitProvider.js';
import type { SharedGkStorageLocationProvider } from '../../plus/repos/sharedGkStorageLocationProvider.js';
import type { GkWorkspacesSharedStorageProvider } from '../../plus/workspaces/workspacesSharedStorageProvider.js';
import type { TelemetryService } from '../../telemetry/telemetry.js';

export function git(
	_container: Container,
	_options: GitExecOptions,
	..._args: any[]
): Promise<GitResult<string | Buffer>> {
	return Promise.resolve({ stdout: '', exitCode: 0 });
}

export function getSupportedGitProviders(container: Container): Promise<GitProvider[]> {
	return Promise.resolve([new GitHubGitProvider(container)]);
}

export function getSharedGKStorageLocationProvider(_container: Container): SharedGkStorageLocationProvider | undefined {
	return undefined;
}

export function getSupportedRepositoryLocationProvider(
	_container: Container,
	_sharedStorage: SharedGkStorageLocationProvider | undefined,
): RepositoryLocationProvider | undefined {
	return undefined;
}

export function getSupportedWorkspacesStorageProvider(
	_container: Container,
	_sharedStorage: SharedGkStorageLocationProvider | undefined,
): GkWorkspacesSharedStorageProvider | undefined {
	return undefined;
}

export function getGkCliIntegrationProvider(_container: Container): undefined {
	return undefined;
}

export function getMcpProviders(_container: Container): Promise<Disposable[] | undefined> {
	return Promise.resolve(undefined);
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}
