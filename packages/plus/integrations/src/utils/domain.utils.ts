/** Extracts the host from a domain expressed as either a URL or a bare host. */
export function hostFromDomain(domain: string | undefined): string | undefined {
	const value = domain?.trim();
	if (!value) return undefined;

	if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
		try {
			return new URL(value).host || undefined;
		} catch {
			return undefined;
		}
	}

	try {
		return new URL(`https://${value}`).host || undefined;
	} catch {
		return undefined;
	}
}

/** Whether two URL-or-host domain values identify the same normalized host and port. */
export function areDomainsOnSameHost(first: string | undefined, second: string | undefined): boolean {
	const firstHost = hostFromDomain(first);
	const secondHost = hostFromDomain(second);
	return firstHost != null && secondHost != null && firstHost === secondHost;
}

/**
 * Whether two URL-or-host domain values name the same machine, ignoring the port. For comparing an SSH remote
 * against a web address: an SSH port says nothing about the port the host serves its web UI and API on.
 */
export function areDomainsOnSameHostname(first: string | undefined, second: string | undefined): boolean {
	const firstHost = hostFromDomain(first);
	const secondHost = hostFromDomain(second);
	if (firstHost == null || secondHost == null) return false;

	return new URL(`https://${firstHost}`).hostname === new URL(`https://${secondHost}`).hostname;
}

/**
 * Builds the API base URL for a self-managed host from a domain expressed as either a URL or a bare host.
 *
 * Distinct from {@link hostFromDomain}, which exists to collapse a domain to the identity the connection is
 * keyed by and therefore DROPS the path. An instance mounted below a context path — Jira Data Center's
 * `/jira`, a reverse-proxied GitLab or Bitbucket — has to be addressed at that path, so the value a request
 * is built from must keep it. Callers pass the session's own domain (the unnormalized one the backend
 * stored) rather than the integration's host-keyed `domain`, and fall back to the latter.
 */
export function baseUrlFromDomain(domain: string | undefined, protocol: string | undefined): string | undefined {
	const value = domain?.trim();
	if (!value) return undefined;

	const scheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(value) ? undefined : (protocol ?? 'https:');
	try {
		const url = new URL(scheme == null ? value : `${scheme}//${value}`);
		return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
	} catch {
		return undefined;
	}
}

/**
 * Whether two configured addresses point at the same place, comparing them the way a request would.
 *
 * Both sides are run through {@link baseUrlFromDomain} first, so the shapes a domain legitimately arrives in
 * — a bare host, a full URL, a trailing slash — compare equal, while a genuinely different context path does
 * not. Two absent values are the same address (neither names a path); one absent is not, since that is a
 * connection gaining or losing one.
 */
export function sameConfiguredBaseUrl(first: string | undefined, second: string | undefined): boolean {
	if (!first?.trim() && !second?.trim()) return true;

	const firstUrl = baseUrlFromDomain(first, undefined);
	const secondUrl = baseUrlFromDomain(second, undefined);
	return firstUrl != null && secondUrl != null && firstUrl === secondUrl;
}

/** Decodes one percent-encoded URL path segment, keeping a malformed one as written. */
export function decodePathSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
