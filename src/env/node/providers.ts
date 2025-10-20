import type { Disposable, McpServerDefinitionProvider } from 'vscode';
import type { Container } from '../../container';
import type { GitCommandOptions } from '../../git/commandOptions';
import type { GitProvider } from '../../git/gitProvider';
import type { RepositoryLocationProvider } from '../../git/location/repositorylocationProvider';
import { mcpExtensionRegistrationAllowed } from '../../plus/gk/utils/-webview/mcp.utils';
import type { SharedGkStorageLocationProvider } from '../../plus/repos/sharedGkStorageLocationProvider';
import type { GkWorkspacesSharedStorageProvider } from '../../plus/workspaces/workspacesSharedStorageProvider';
import { configuration } from '../../system/-webview/configuration';
// import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import type { TelemetryService } from '../../telemetry/telemetry';
import type { GitResult } from './git/git';
import { Git } from './git/git';
import { LocalGitProvider } from './git/localGitProvider';
import { VslsGit, VslsGitProvider } from './git/vslsGitProvider';
import { GkCliIntegrationProvider } from './gk/cli/integration';
import { LocalRepositoryLocationProvider } from './gk/localRepositoryLocationProvider';
import { LocalSharedGkStorageLocationProvider } from './gk/localSharedGkStorageLocationProvider';
import { LocalGkWorkspacesSharedStorageProvider } from './gk/localWorkspacesSharedStorageProvider';

let gitInstance: Git | undefined;
function ensureGit(container: Container) {
	gitInstance ??= new Git(container);
	return gitInstance;
}

export function git(
	container: Container,
	options: GitCommandOptions,
	...args: any[]
): Promise<GitResult<string | Buffer>> {
	return ensureGit(container).exec(options, ...args);
}

export async function getSupportedGitProviders(container: Container): Promise<GitProvider[]> {
	const git = ensureGit(container);

	const providers: GitProvider[] = [
		new LocalGitProvider(container, git),
		new VslsGitProvider(container, new VslsGit(container, git)),
	];

	if (configuration.get('virtualRepositories.enabled')) {
		providers.push(
			new (
				await import(
					/* webpackChunkName: "integrations" */ '../../plus/integrations/providers/github/githubGitProvider'
				)
			).GitHubGitProvider(container),
		);
	}

	return providers;
}

export function getSharedGKStorageLocationProvider(container: Container): SharedGkStorageLocationProvider {
	return new LocalSharedGkStorageLocationProvider(container);
}

export function getSupportedRepositoryLocationProvider(
	container: Container,
	sharedStorage: SharedGkStorageLocationProvider,
): RepositoryLocationProvider {
	return new LocalRepositoryLocationProvider(container, sharedStorage);
}

export function getSupportedWorkspacesStorageProvider(
	container: Container,
	sharedStorage: SharedGkStorageLocationProvider,
): GkWorkspacesSharedStorageProvider {
	return new LocalGkWorkspacesSharedStorageProvider(container, sharedStorage);
}

export function getGkCliIntegrationProvider(container: Container): GkCliIntegrationProvider {
	return new GkCliIntegrationProvider(container);
}

export async function getMcpProviders(
	container: Container,
): Promise<(McpServerDefinitionProvider & Disposable)[] | undefined> {
	if (!mcpExtensionRegistrationAllowed()) return undefined;

	// Older versions of VS Code do not support the classes used in the MCP integration, so we need to dynamically import
	const mcpModule = await import(/* webpackChunkName: "mcp" */ './gk/mcp/integration');

	return [new mcpModule.GkMcpProvider(container)];
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}
