/* oxlint-disable no-template-curly-in-string -- GitLens format tokens are literal template syntax */
import * as l10n from '@vscode/l10n';
import slug from 'slug';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import { Formatter } from '@gitlens/utils/formatter.js';
import { getTokensFromTemplate } from '@gitlens/utils/string.js';

export const defaultBranchNameFormat = '${id}-${title}';

// The same prefix/suffix/width grammar offered by the Settings format editor, restricted to issue tokens.
const branchNameTokenRegex = /^\$\{(?:'[^']*'|[^\w'|{}]*)?(?:id|title)(?:\|\d*[?-]?)?(?:'[^']*'|[^\w'|{}]*)?\}$/;

type BranchNameIssue = Pick<IssueShape, 'id' | 'title'>;

class BranchNameFormatter extends Formatter<BranchNameIssue> {
	static fromTemplate(template: string, issue: BranchNameIssue): string {
		return this.fromTemplateCore(BranchNameFormatter, template, issue);
	}

	get id(): string {
		return this._padOrTruncate(slug(this._item.id, { lower: false }), this._options.tokenOptions.id);
	}

	get title(): string {
		return this._padOrTruncate(slug(this._item.title), this._options.tokenOptions.title);
	}
}

export function createBranchNameFromIssue(issue: BranchNameIssue, format?: string): string {
	const template = format?.trim() ? format : defaultBranchNameFormat;
	const tokens = getTokensFromTemplate(template);
	let position = 0;
	for (const token of tokens) {
		if (
			template.slice(position, token.start).includes('${') ||
			!branchNameTokenRegex.test(template.slice(token.start, token.end))
		) {
			throw new Error(l10n.t('Invalid branch name format. Use the {0} and {1} tokens.', '${id}', '${title}'));
		}

		position = token.end;
	}

	if (template.slice(position).includes('${')) {
		throw new Error(l10n.t('Invalid branch name format. Use the {0} and {1} tokens.', '${id}', '${title}'));
	}

	// Keep intentional slash-separated prefixes and valid literal characters. Token data is slugged separately.
	let name = BranchNameFormatter.fromTemplate(template, issue)
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
