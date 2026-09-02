/** Dependency-free git-hosting vocabulary shared by `packages/git`, the host, and the renderer kernel
 *  (`@gitkraken/commit-graph-ui`); lives here because none of them may depend on `@gitlens/git`. */

/** Mirrors `GkProviderId`'s members (this package can't import `@gitlens/git`); drift fails the build
 *  there via a type assertion in `models/repositoryIdentities.ts`. */
export type HostingServiceType =
	| 'github'
	| 'githubEnterprise'
	| 'gitlab'
	| 'gitlabSelfHosted'
	| 'bitbucket'
	| 'bitbucketServer'
	| 'azureDevops';
