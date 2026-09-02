/** Dependency-free git vocabulary shared by `packages/git`, the host, and the renderer kernel
 *  (`@gitkraken/commit-graph-ui`), which must not depend on `@gitlens/git`; it lives here for that reason. */

/** The branch id format `refRowIndex` and the WIP row's upstream lookup key are keyed on. */
export function getBranchId(repoPath: string, remote: boolean, name: string): string {
	return `${repoPath}|${remote ? 'remotes/' : 'heads/'}${name}`;
}

/** Returns the separator between a remote name and its branch name, including `remotes/` refs. */
export function getRemoteNameSlashIndex(name: string): number {
	return name.startsWith('remotes/') ? name.indexOf('/', 8) : name.indexOf('/');
}

export function getBranchNameWithoutRemote(name: string): string {
	return name.substring(getRemoteNameSlashIndex(name) + 1);
}

export function getRemoteNameFromBranchName(name: string): string {
	return name.substring(0, getRemoteNameSlashIndex(name));
}
