import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type {
	GitRemoteProbeFailureReason,
	GitRemoteProbeResult,
	GitRemotesSubProvider,
} from '@gitlens/git/providers/remotes.js';
import { RemotesGitProviderBase } from '@gitlens/git/providers/shared/remotes.js';
import { createRemoteProviderMatcher } from '@gitlens/git/remotes/matcher.js';
import { sortRemotes } from '@gitlens/git/utils/sorting.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git } from '../exec/git.js';
import { parseGitRemotes } from '../parsers/remoteParser.js';

/** Long enough for a slow host to answer, short enough that a blackholed one doesn't stall the wizard */
const probeRemoteTimeoutMs = 5000;

/**
 * Keeps the probe from asking anyone for credentials: an empty `GIT_ASKPASS` stops git's askpass lookup
 * outright (it doesn't fall through to `core.askPass` or `SSH_ASKPASS`), so the editor's askpass can't
 * open a credential prompt over the wizard, and `GIT_TERMINAL_PROMPT=0` refuses the tty fallback.
 * Non-interactive credential helpers still run, so a stored credential still authenticates.
 */
const probeRemoteEnv: Record<string, string> = {
	GIT_ASKPASS: '',
	GIT_TERMINAL_PROMPT: '0',
	GCM_INTERACTIVE: 'NEVER',
	SSH_ASKPASS: '',
};

export function getProbeFailureReason(stderr: string): GitRemoteProbeFailureReason {
	if (/Could not resolve host|nodename nor servname|Name or service not known|No such host/i.test(stderr)) {
		return 'hostNotFound';
	}
	// Checked before auth: the probe forbids ssh's prompt to trust an unknown host, so a correct URL on a host
	// not yet in known_hosts fails here, and that isn't an authentication problem
	if (/Host key verification failed/i.test(stderr)) {
		return 'hostKeyUnverified';
	}
	// HTTP statuses are matched on git's own wording so digits elsewhere (e.g. a `/403/` URL path) don't count
	if (
		/could not read (?:Username|Password)|terminal prompts disabled|Authentication failed|Permission denied|returned error: 40[13]\b/i.test(
			stderr,
		)
	) {
		return 'authRequired';
	}
	if (
		/Repository not found|repository '.*' not found|does not appear to be a git repository|returned error: 404\b/i.test(
			stderr,
		)
	) {
		return 'notFound';
	}
	return 'other';
}

/** SSH's generic tail, which follows (and buries) the host's own explanation of the failure */
const genericProbeFailureLine =
	/^(?:fatal:\s*)?(?:Could not read from remote repository|Please make sure you have the correct access rights|and the repository exists)/;

/**
 * The line of stderr that names what went wrong most plainly: SSH's generic trailer is dropped first so the host's
 * message before it (e.g. `ERROR: Repository not found.`) can win; then the last `fatal:` line (prefix stripped),
 * else the last line. If only the generic trailer remains, it is used rather than returning nothing.
 */
export function getProbeFailureMessage(stderr: string): string | undefined {
	const lines = stderr
		.split(/\r?\n/)
		.map(l => l.trim())
		.filter(l => l.length);
	const specific = lines.filter(l => !genericProbeFailureLine.test(l));
	const candidates = specific.length ? specific : lines;
	const fatal = candidates.findLast(l => l.startsWith('fatal:'));
	return (fatal ?? candidates.at(-1))?.replace(/^fatal:\s*/, '') || undefined;
}

export class RemotesGitSubProvider extends RemotesGitProviderBase implements GitRemotesSubProvider {
	constructor(
		context: GitServiceContext,
		private readonly git: Git,
		cache: Cache,
		provider: CliGitProviderInternal,
	) {
		super(context, cache, provider);
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getRemotes(
		repoPath: string | undefined,
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const scope = getScopedLogger();

		let remotes = await this.cache.getRemotes(
			repoPath,
			async (commonPath, cacheable, signal) => {
				// Prefer the aggregate signal from the cache; fall back to the caller's cancellation.
				signal ??= cancellation;
				const configs = await this.context.remotes?.getCustomProviders?.(repoPath);
				const remoteProviderMatcher = createRemoteProviderMatcher(configs, this.context.remotes);

				try {
					const result = await this.git.run(
						{
							cwd: repoPath,
							cancellation: signal,
							caching: { cache: this.cache.gitResults, commonPath: commonPath },
						},
						'remote',
						'-v',
					);

					// Fetch default remote name from GK config before parsing so it's set at construction time
					const defaultName = await this.provider.config.getGkConfig?.(repoPath, 'gk.defaultRemote');
					const remotes = parseGitRemotes(result.stdout, commonPath, remoteProviderMatcher, defaultName);

					return remotes;
				} catch (ex) {
					cacheable.invalidate();
					scope?.error(ex);
					return [];
				}
			},
			cancellation,
		);

		if (options?.filter != null) {
			remotes = remotes.filter(options.filter);
		}

		if (options?.sort) {
			sortRemotes(remotes);
		}

		return remotes;
	}

	@gate()
	@debug()
	async addRemote(repoPath: string, name: string, url: string, options?: { fetch?: boolean }): Promise<void> {
		if (!options?.fetch) {
			await this.git.run({ cwd: repoPath }, 'remote', 'add', name, url);
			this.context.hooks?.cache?.onReset?.(repoPath, 'remotes');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'remotes']);
			return;
		}

		try {
			await this.git.run({ cwd: repoPath }, 'remote', 'add', '-f', name, url);
		} finally {
			// Reset even on failure: `remote add -f` keeps the remote when only its fetch fails, and a
			// caller checking whether the remote now exists must not read the pre-add cache.
			// A fetch creates the remote's tracking branches, which the branch, ref and history caches hold
			this.context.hooks?.cache?.onReset?.(repoPath, 'remotes', 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'remotes']);
		}
	}

	@gate()
	@debug()
	async addRemoteWithResult(
		repoPath: string,
		name: string,
		url: string,
		options?: { fetch?: boolean },
	): Promise<GitRemote | undefined> {
		await this.addRemote(repoPath, name, url, options);
		const [remote] = await this.getRemotes(repoPath, { filter: r => r.url === url });
		return remote;
	}

	// The URL is left out of the log — it can carry credentials (`https://<token>@host/...`)
	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async probeRemote(repoPath: string, url: string, cancellation?: AbortSignal): Promise<GitRemoteProbeResult> {
		// A leading `-` would be parsed as an option rather than the repository to query
		if (url.startsWith('-')) return { reachable: false, reason: 'other' };

		const timeoutSignal = AbortSignal.timeout(probeRemoteTimeoutMs);
		const signal = cancellation != null ? AbortSignal.any([cancellation, timeoutSignal]) : timeoutSignal;

		const result = await this.git.run(
			{ cwd: repoPath, cancellation: signal, errors: 'ignore', env: probeRemoteEnv, priority: 'interactive' },
			// No `--exit-code`: a freshly created, empty repository advertises no HEAD but is a valid remote
			'ls-remote',
			url,
			'HEAD',
		);

		const { completion } = result;
		if (completion.status === 'exited' && completion.code === 0) return { reachable: true };

		if (completion.status === 'cancelled') {
			if (cancellation?.aborted) throw new CancellationError(completion.error, 'aborted');

			return { reachable: false, reason: 'timeout' };
		}

		// A run that never exited (spawn failure, missing binary, queue rejection) says nothing about the remote;
		// throw so callers treat it as unprobed rather than unreachable
		if (completion.status === 'failed') {
			if (cancellation?.aborted) throw new CancellationError(completion.error, 'aborted');

			throw completion.error;
		}

		// Under `errors: 'ignore'` a non-zero exit resolves with its stderr; a run that never exited has none
		const stderr = typeof result.stderr === 'string' ? result.stderr : '';
		return {
			reachable: false,
			reason: getProbeFailureReason(stderr),
			message: getProbeFailureMessage(stderr),
		};
	}

	@gate()
	@debug()
	async pruneRemote(repoPath: string, name: string): Promise<void> {
		try {
			await this.git.run({ cwd: repoPath }, 'remote', 'prune', name);
		} finally {
			this.context.hooks?.cache?.onReset?.(repoPath, 'remotes', 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['remotes']);
		}
	}

	@gate()
	@debug()
	async removeRemote(repoPath: string, name: string): Promise<void> {
		try {
			await this.git.run({ cwd: repoPath }, 'remote', 'remove', name);
		} finally {
			// Removing a remote deletes its tracking branches too
			this.context.hooks?.cache?.onReset?.(repoPath, 'remotes', 'branches');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['config', 'remotes']);
		}
	}
}
