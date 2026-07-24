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
