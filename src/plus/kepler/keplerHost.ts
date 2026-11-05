/**
 * Names the machine a Kepler deep link is for, as the `host=` param.
 *
 * A path GitLens sends is on the machine its extension host runs on — the remote machine under
 * Remote-SSH/WSL — so the link must say which machine that is for Kepler to route it to a window
 * connected there. `env.remoteName` is only the kind (`ssh-remote`, `wsl`); the full authority
 * (`ssh-remote+devbox`) lives only on a workspace folder URI. A window connects to one remote, so
 * any of its remote folders carries it.
 *
 * Returns `undefined` when no remote authority can be found, which omits `host` and leaves routing
 * to Kepler.
 */
export function getKeplerHost(
	remoteName: string | undefined,
	folders: readonly { scheme: string; authority: string }[],
): string | undefined {
	if (remoteName == null) return 'local';

	return folders.find(f => f.scheme === 'vscode-remote')?.authority;
}
