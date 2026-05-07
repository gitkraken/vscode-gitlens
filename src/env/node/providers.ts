import { basename, dirname, resolve } from 'path';
import type { Disposable } from 'vscode';
import { workspace } from 'vscode';
import { ClaudeCodeProvider } from '@gitlens/agents/providers/claudeCodeProvider.js';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitExecOptions, GitResult } from '@gitlens/git/exec.types.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import { Git } from '@gitlens/git-cli/exec/git.js';
import { findGitPath } from '@gitlens/git-cli/exec/locator.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { AgentSessionProvider } from '../../agents/provider.js';
import type { Container } from '../../container.js';
import type { GlGitProvider } from '../../git/gitProvider.js';
import type { RepositoryLocationProvider } from '../../git/location/repositorylocationProvider.js';
import {
	mcpRegistrationEnabled,
	supportsCursorMcpRegistration,
	supportsMcpExtensionRegistration,
} from '../../plus/gk/utils/-webview/mcp.utils.js';
import type { SharedGkStorageLocationProvider } from '../../plus/repos/sharedGkStorageLocationProvider.js';
import type { GkWorkspacesSharedStorageProvider } from '../../plus/workspaces/workspacesSharedStorageProvider.js';
import { configuration } from '../../system/-webview/configuration.js';
// import { GitHubGitProvider } from '../../plus/github/githubGitProvider';
import type { TelemetryService } from '../../telemetry/telemetry.js';
import { GlCliGitProvider } from './git/cliGitProvider.js';
import { VslsGitProvider } from './git/vslsGitProvider.js';
import { GkCliIntegrationProvider } from './gk/cli/integration.js';
import { runCLICommand } from './gk/cli/utils.js';
import { LocalRepositoryLocationProvider } from './gk/localRepositoryLocationProvider.js';
import { LocalSharedGkStorageLocationProvider } from './gk/localSharedGkStorageLocationProvider.js';
import { LocalGkWorkspacesSharedStorageProvider } from './gk/localWorkspacesSharedStorageProvider.js';

// Lightweight Git instance for VSLS host — only used for Live Share command proxying.
// The primary Git execution path is inside CliGitProvider (created by LocalGitProvider).
let vslsGitInstance: Git | undefined;
function ensureVslsGit() {
	if (vslsGitInstance == null) {
		const locator = () => findGitPath(configuration.getCore('git.path'));
		vslsGitInstance = new Git(locator, {
			isTrusted: () => workspace.isTrusted,
		});
	}
	return vslsGitInstance;
}

export function git(
	_container: Container,
	options: GitExecOptions,
	...args: any[]
): Promise<GitResult<string | Buffer>> {
	return ensureVslsGit().run(options, ...args);
}

export async function getSupportedGitProviders(
	container: Container,
	cache: Cache,
	register: (provider: GitProvider, canHandle: (repoPath: string) => boolean) => UnifiedDisposable,
): Promise<GlGitProvider[]> {
	const providers: GlGitProvider[] = [
		new GlCliGitProvider(container, cache, register),
		new VslsGitProvider(container, cache, register),
	];

	if (configuration.get('virtualRepositories.enabled')) {
		providers.push(
			new (
				await import(
					/* webpackChunkName: "integrations" */ '../../plus/integrations/providers/github/githubGitProvider.js'
				)
			).GlGitHubGitProvider(container, cache, register),
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

export { isClaudeAvailable } from './agents/detectClaude.js';

export async function getMcpProviders(container: Container): Promise<Disposable[] | undefined> {
	if (mcpRegistrationEnabled(container)) {
		if (supportsMcpExtensionRegistration()) {
			// Older versions of VS Code do not support the classes used in the MCP integration, so we need to dynamically import
			const mcpModule = await import(/* webpackChunkName: "mcp" */ './gk/mcp/vscodeIntegration.js');
			return [new mcpModule.VSCodeGkMcpProvider(container)];
		}

		if (supportsCursorMcpRegistration()) {
			const mcpModule = await import(/* webpackChunkName: "mcp-cursor" */ './gk/mcp/cursorIntegration.js');
			return [new mcpModule.CursorGkMcpProvider(container)];
		}
	}

	return undefined;
}

export function getAgentSessionProviders(container: Container): AgentSessionProvider[] {
	return [
		new ClaudeCodeProvider({
			ipc: container.ipc,
			onSessionStarted: provider =>
				container.telemetry.sendEvent('agents/session/started', { 'agent.provider': provider }),
			onSessionEnded: provider =>
				container.telemetry.sendEvent('agents/session/ended', { 'agent.provider': provider }),
			onPermissionResolved: info =>
				container.telemetry.sendEvent('agents/permission/resolved', {
					'agent.provider': info.provider,
					'permission.tool': info.tool,
					'permission.decision': info.decision,
				}),
			onBranchAgentActivity: cwd => {
				const repo = container.git.getRepository(cwd);
				if (repo != null) {
					queueMicrotask(() => repo.git.branches.onCurrentBranchAgentActivity?.());
				}
			},
			runCLICommand: (args, opts) => runCLICommand(args, opts),
			resolveGitInfo: async cwd => {
				const opts = { cwd: cwd, errors: 'ignore' as const, timeout: 5000 };
				const [branchResult, toplevelResult, commonDirResult, gitDirResult] = await Promise.all([
					git(container, opts, 'rev-parse', '--abbrev-ref', 'HEAD'),
					git(container, opts, 'rev-parse', '--show-toplevel'),
					git(container, opts, 'rev-parse', '--git-common-dir'),
					git(container, opts, 'rev-parse', '--git-dir'),
				]);

				const branch = String(branchResult.stdout).trim() || undefined;
				const toplevel = String(toplevelResult.stdout).trim() || undefined;
				const commonDir = String(commonDirResult.stdout).trim() || undefined;
				const gitDir = String(gitDirResult.stdout).trim() || undefined;

				if (toplevel == null) return undefined;

				const isWorktree = commonDir != null && gitDir != null && commonDir !== gitDir;
				return {
					branch: branch,
					repoRoot: isWorktree && commonDir ? dirname(resolve(cwd, commonDir)) : toplevel,
					isWorktree: isWorktree,
					worktreeName: isWorktree ? basename(toplevel) : undefined,
				};
			},
		}),
	];
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}
