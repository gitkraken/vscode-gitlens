/* oxlint-disable no-template-curly-in-string -- GitLens format tokens are literal template syntax */
import slug from 'slug';
import { l10n } from 'vscode';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { TokenOptions } from '@gitlens/utils/string.js';
import { getTokensFromTemplate } from '@gitlens/utils/string.js';

const defaultBranchNameFormat = '${id}-${title}';

// The same prefix/suffix/width grammar offered by the Settings format editor, restricted to issue tokens.
const branchNameTokenRegex = /^\$\{(?:'[^']*'|[^\w'|{}]*)?(?:id|title)(?:\|\d*[?-]?)?(?:'[^']*'|[^\w'|{}]*)?\}$/;

type BranchNameIssue = Pick<IssueShape, 'id' | 'title'>;

// Width applies to the slugged value only (not the prefix/suffix) and truncates without an ellipsis or padding,
// since both would be mangled by the normalization below
function renderToken(value: string, options: TokenOptions): string {
	if (options.truncateTo != null) {
		value = value.slice(0, options.truncateTo).replace(/-+$/, '');
	}

	if (!value) return '';

	return `${options.prefix ?? ''}${value}${options.suffix ?? ''}`;
}

export function createBranchNameFromIssue(issue: BranchNameIssue, format?: string): string {
	const template = format?.trim() ? format : defaultBranchNameFormat;

	let valid = true;
	let rendered = '';
	let lastEnd = 0;
	for (const token of getTokensFromTemplate(template)) {
		if (!branchNameTokenRegex.test(template.slice(token.start, token.end))) {
			valid = false;
			break;
		}

		rendered += template.slice(lastEnd, token.start);
		rendered += renderToken(
			token.key === 'id' ? slug(issue.id, { lower: false }) : slug(issue.title),
			token.options,
		);
		lastEnd = token.end;
	}

	const tail = template.slice(lastEnd);
	if (!valid || tail.includes('${')) {
		throw new Error(l10n.t('Invalid branch name format. Use the {0} and {1} tokens.', '${id}', '${title}'));
	}

	rendered += tail;

	// Keep intentional slash-separated prefixes and valid literal characters. Token data is slugged separately.
	let name = rendered
		.replace(/@\{|\.\.+/g, '-')
		// oxlint-disable-next-line no-control-regex -- Git forbids control characters in ref names
		.replace(/[\s\x00-\x1f\x7f~^:?*[\]\\{}]+/g, '-')
		.split('/')
		.map(part => part.replace(/^[.-]+/, '').replace(/(?:\.lock|[.-])+$/g, ''))
		.filter(Boolean)
		.join('/');
	if (!name || name === '@') {
		throw new Error(l10n.t('The branch name format produces an empty or invalid branch name.'));
	}

	if (name === 'HEAD') {
		name = 'HEAD-branch';
	}

	return name;
}
