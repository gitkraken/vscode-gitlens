import type {
	Issue,
	IssueRepositoryIdentityDescriptor,
	IssueShape,
	IssueSortField,
	IssueSorting,
} from '../models/issue.js';

/**
 * How each sort field is read off an {@link IssueShape}, for the reads that MERGE several provider queries and so
 * have to order the union themselves instead of letting the provider do it.
 *
 * Only the fields the shape actually carries appear. `priority`, `dueDate` and `resolved` are absent because
 * `IssueOrPullRequest`/`IssueShape` doesn't model them: a provider may well order by them server-side on a
 * single-query read, but a merged one cannot — which is exactly what {@link getIssueComparator} returning
 * `undefined` lets its caller refuse, instead of concatenating unordered runs and calling them sorted.
 */
const issueSortValues: Partial<Record<IssueSortField, (issue: IssueShape) => number | Date | string | undefined>> = {
	created: i => i.createdDate,
	updated: i => i.updatedDate,
	closed: i => i.closedDate,
	comments: i => i.commentsCount,
	reactions: i => i.thumbsUpCount,
	title: i => i.title,
};

/**
 * A comparator for one sort key over normalized issues, or `undefined` when the field isn't derivable from an
 * {@link IssueShape} — the signal that the key is only honorable on a SINGLE-origin read, where the provider
 * already ordered the page.
 *
 * `@gitkraken/provider-apis` carries a twin of this over its own `Issue` shape (`src/issueSort.ts`), which it uses
 * for the merges it performs itself. It is not importable — the SDK does not export it, and it takes a different
 * shape — so the two are separate implementations of one rule, and the rule below is the part that must not drift.
 *
 * Missing values sort LAST in both directions. That is deliberately not the same as negating the descending
 * comparator (which would float them to the front when ascending), and it is why they're partitioned before any
 * arithmetic rather than mapped to an infinite sentinel: two missing values have to compare equal, and
 * `-Infinity - -Infinity` is `NaN`, which makes the comparator inconsistent and the resulting order
 * implementation-defined.
 *
 * Note it orders whatever it is handed. Sorting a page that was already capped does not make it the top N.
 */
export function getIssueComparator(sort: IssueSorting): ((a: IssueShape, b: IssueShape) => number) | undefined {
	// The union's shape guarantees both halves, so this needs no validation — only the cast tsc can't infer.
	const [field, direction] = sort.split(':') as [IssueSortField, 'asc' | 'desc'];
	const getValue = issueSortValues[field];
	if (getValue == null) return undefined;

	return (a, b) => {
		const left = toComparable(getValue(a));
		const right = toComparable(getValue(b));
		if (left == null || right == null) {
			if (left == null && right == null) return 0;
			return left == null ? 1 : -1;
		}

		const ordered = left < right ? -1 : left > right ? 1 : 0;
		return direction === 'asc' ? ordered : -ordered;
	};
}

function toComparable(value: number | Date | string | undefined): number | string | undefined {
	return value instanceof Date ? value.getTime() : value;
}

export function getRepositoryIdentityForIssue(issue: IssueShape | Issue): IssueRepositoryIdentityDescriptor {
	if (issue.repository == null) throw new Error('Missing repository');

	return {
		remote: {
			url: issue.repository.url,
			domain: issue.provider.domain,
		},
		name: `${issue.repository.owner}/${issue.repository.repo}`,
		provider: {
			id: issue.provider.id,
			domain: issue.provider.domain,
			repoDomain: issue.repository.owner,
			repoName: issue.repository.repo,
			repoOwnerDomain: issue.repository.owner,
		},
	};
}

export function serializeIssue(value: IssueShape): IssueShape {
	const serialized: IssueShape = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		nodeId: value.nodeId,
		issueType: value.issueType,
		title: value.title,
		url: value.url,
		createdDate: value.createdDate,
		updatedDate: value.updatedDate,
		closedDate: value.closedDate,
		closed: value.closed,
		state: value.state,
		author:
			value.author == null
				? undefined
				: {
						id: value.author.id,
						name: value.author.name,
						avatarUrl: value.author.avatarUrl,
						url: value.author.url,
					},
		repository:
			value.repository == null
				? undefined
				: {
						owner: value.repository.owner,
						repo: value.repository.repo,
						url: value.repository.url,
					},
		project:
			value.project == null
				? undefined
				: {
						id: value.project.id,
						name: value.project.name,
						resourceId: value.project.resourceId,
						resourceName: value.project.resourceName,
					},
		assignees: value.assignees.map(assignee => ({
			id: assignee.id,
			name: assignee.name,
			avatarUrl: assignee.avatarUrl,
			url: assignee.url,
		})),
		labels:
			value.labels == null
				? undefined
				: value.labels.map(label => ({
						color: label.color,
						name: label.name,
					})),
		commentsCount: value.commentsCount,
		thumbsUpCount: value.thumbsUpCount,
		body: value.body,
	};
	return serialized;
}
