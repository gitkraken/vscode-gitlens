import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../../constants.integrations.js';
import { equalsIgnoreCase } from '../../../../system/string.js';

export interface GitHostParsedIssueUrl {
	type: 'gitHost';
	integrationId:
		| GitCloudHostIntegrationId.GitHub
		| GitCloudHostIntegrationId.GitLab
		| GitCloudHostIntegrationId.Bitbucket
		| GitCloudHostIntegrationId.AzureDevOps
		| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
		| GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
	domain: string;
	owner: string;
	repo: string;
	issueId: string;
}

export interface IssueProviderParsedIssueUrl {
	type: 'issueProvider';
	integrationId: IssuesCloudHostIntegrationId.Jira | IssuesCloudHostIntegrationId.Linear;
	domain: string;
	issueId: string;
}

export type ParsedIssueUrl = GitHostParsedIssueUrl | IssueProviderParsedIssueUrl;

const azureDevOpsHostRegex = /^dev\.azure\.com$/i;
const vstsHostRegex = /\.visualstudio\.com$/i;

/**
 * Parses an issue URL into its components, identifying the provider and extracting
 * the owner/repo/issueId or org/issueKey as appropriate.
 *
 * Returns `undefined` if the URL cannot be parsed or doesn't match a known provider pattern.
 */
export function parseIssueUrl(url: string): ParsedIssueUrl | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	const { hostname, pathname } = parsed;

	// GitHub: https://github.com/{owner}/{repo}/issues/{id}
	if (equalsIgnoreCase(hostname, 'github.com')) {
		return parseGitHubIssueUrl(hostname, pathname, GitCloudHostIntegrationId.GitHub);
	}

	// GitLab: https://gitlab.com/{owner}/{repo}/-/issues/{id}
	if (equalsIgnoreCase(hostname, 'gitlab.com')) {
		return parseGitLabIssueUrl(hostname, pathname, GitCloudHostIntegrationId.GitLab);
	}

	// Bitbucket: https://bitbucket.org/{owner}/{repo}/issues/{id}
	if (hostname.toLowerCase() === 'bitbucket.org') {
		return parseBitbucketIssueUrl(hostname, pathname);
	}

	// Azure DevOps: https://dev.azure.com/{org}/{project}/_workitems/edit/{id}
	if (azureDevOpsHostRegex.test(hostname)) {
		return parseAzureDevOpsIssueUrl(hostname, pathname);
	}

	// VSTS (legacy Azure DevOps): https://{org}.visualstudio.com/{project}/_workitems/edit/{id}
	if (vstsHostRegex.test(hostname)) {
		return parseVstsIssueUrl(hostname, pathname);
	}

	// Jira: https://{org}.atlassian.net/browse/{KEY-123}
	if (hostname.endsWith('.atlassian.net')) {
		return parseJiraIssueUrl(hostname, pathname);
	}

	// Linear: https://linear.app/{workspace}/issue/{KEY-123}
	if (hostname.toLowerCase() === 'linear.app') {
		return parseLinearIssueUrl(hostname, pathname);
	}

	// Try self-hosted GitHub Enterprise pattern: {domain}/{owner}/{repo}/issues/{id}
	const gheResult = parseGitHubIssueUrl(hostname, pathname, GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);
	if (gheResult != null) return gheResult;

	// Try self-hosted GitLab pattern: {domain}/{owner}/{repo}/-/issues/{id}
	const gitlabResult = parseGitLabIssueUrl(hostname, pathname, GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted);
	if (gitlabResult != null) return gitlabResult;

	return undefined;
}

// GitHub: /{owner}/{repo}/issues/{id}
const githubIssuePathRegex = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

function parseGitHubIssueUrl(
	domain: string,
	pathname: string,
	integrationId: GitCloudHostIntegrationId.GitHub | GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
): GitHostParsedIssueUrl | undefined {
	const match = githubIssuePathRegex.exec(pathname);
	if (match == null) return undefined;

	const [, owner, repo, issueId] = match;
	return {
		type: 'gitHost',
		integrationId: integrationId,
		domain: domain,
		owner: owner,
		repo: repo,
		issueId: issueId,
	};
}

// GitLab: /{owner}/{repo}/-/issues/{id}
// Note: GitLab supports nested groups, so owner can contain slashes
const gitlabIssuePathRegex = /^\/(.+)\/-\/issues\/(\d+)\/?$/;

function parseGitLabIssueUrl(
	domain: string,
	pathname: string,
	integrationId: GitCloudHostIntegrationId.GitLab | GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
): GitHostParsedIssueUrl | undefined {
	const match = gitlabIssuePathRegex.exec(pathname);
	if (match == null) return undefined;

	const [, fullPath, issueId] = match;
	// GitLab path is namespace/project, where namespace can be nested groups
	const lastSlash = fullPath.lastIndexOf('/');
	if (lastSlash === -1) return undefined;

	const owner = fullPath.substring(0, lastSlash);
	const repo = fullPath.substring(lastSlash + 1);
	return {
		type: 'gitHost',
		integrationId: integrationId,
		domain: domain,
		owner: owner,
		repo: repo,
		issueId: issueId,
	};
}

// Bitbucket: /{owner}/{repo}/issues/{id}
const bitbucketIssuePathRegex = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

function parseBitbucketIssueUrl(domain: string, pathname: string): GitHostParsedIssueUrl | undefined {
	const match = bitbucketIssuePathRegex.exec(pathname);
	if (match == null) return undefined;

	const [, owner, repo, issueId] = match;
	return {
		type: 'gitHost',
		integrationId: GitCloudHostIntegrationId.Bitbucket,
		domain: domain,
		owner: owner,
		repo: repo,
		issueId: issueId,
	};
}

// Azure DevOps: /{org}/{project}/_workitems/edit/{id}
const azureDevOpsIssuePathRegex = /^\/([^/]+)\/([^/]+)\/_workitems\/edit\/(\d+)\/?$/;

function parseAzureDevOpsIssueUrl(domain: string, pathname: string): GitHostParsedIssueUrl | undefined {
	const match = azureDevOpsIssuePathRegex.exec(pathname);
	if (match == null) return undefined;

	const [, owner, project, issueId] = match;
	return {
		type: 'gitHost',
		integrationId: GitCloudHostIntegrationId.AzureDevOps,
		domain: domain,
		owner: owner,
		repo: project,
		issueId: issueId,
	};
}

// VSTS (legacy): /{project}/_workitems/edit/{id}  (org is in subdomain)
const vstsIssuePathRegex = /^\/([^/]+)\/_workitems\/edit\/(\d+)\/?$/;

function parseVstsIssueUrl(domain: string, pathname: string): GitHostParsedIssueUrl | undefined {
	const match = vstsIssuePathRegex.exec(pathname);
	if (match == null) return undefined;

	// For VSTS, the org is the subdomain: {org}.visualstudio.com
	const owner = domain.split('.')[0];
	const [, project, issueId] = match;
	return {
		type: 'gitHost',
		integrationId: GitCloudHostIntegrationId.AzureDevOps,
		domain: domain,
		owner: owner,
		repo: project,
		issueId: issueId,
	};
}

// Jira: /browse/{KEY-123}
const jiraIssuePathRegex = /^\/browse\/([A-Z][A-Z0-9_]+-\d+)\/?$/;

function parseJiraIssueUrl(domain: string, pathname: string): IssueProviderParsedIssueUrl | undefined {
	const match = jiraIssuePathRegex.exec(pathname);
	if (match == null) return undefined;

	const [, issueKey] = match;
	return {
		type: 'issueProvider',
		integrationId: IssuesCloudHostIntegrationId.Jira,
		domain: domain,
		issueId: issueKey,
	};
}

// Linear: /{workspace}/issue/{KEY-123}
const linearIssuePathRegex = /^\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)\/?$/;

function parseLinearIssueUrl(domain: string, pathname: string): IssueProviderParsedIssueUrl | undefined {
	const match = linearIssuePathRegex.exec(pathname);
	if (match == null) return undefined;

	const [, issueKey] = match;
	return {
		type: 'issueProvider',
		integrationId: IssuesCloudHostIntegrationId.Linear,
		domain: domain,
		issueId: issueKey,
	};
}
