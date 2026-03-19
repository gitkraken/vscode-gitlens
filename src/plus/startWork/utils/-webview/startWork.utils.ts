import slug from 'slug';
import type { IssueShape } from '@gitlens/git/models/issue.js';

export function createBranchNameFromIssue(issue: IssueShape): string {
	return `${slug(issue.id, { lower: false })}-${slug(issue.title)}`;
}
