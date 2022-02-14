import { ColorThemeKind, ThemeColor, ThemeIcon, window } from 'vscode';
import { DateStyle } from '../../configuration';
import { Colors } from '../../constants';
import { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { RemoteProviderReference } from './remoteProvider';

export const enum PullRequestState {
	Open = 'Open',
	Closed = 'Closed',
	Merged = 'Merged',
}

export class PullRequest {
	static is(pr: any): pr is PullRequest {
		return pr instanceof PullRequest;
	}

	static getMarkdownIcon(pullRequest: PullRequest): string {
		switch (pullRequest.state) {
			case PullRequestState.Open:
				return `<span style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
				};">$(git-pull-request)</span>`;
			case PullRequestState.Closed:
				return `<span style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#f85149' : '#cf222e'
				};">$(git-pull-request-closed)</span>`;
			case PullRequestState.Merged:
				return `<span style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
				};">$(git-merge)</span>`;
			default:
				return '$(git-pull-request)';
		}
	}

	static getThemeIcon(pullRequest: PullRequest): ThemeIcon {
		switch (pullRequest.state) {
			case PullRequestState.Open:
				return new ThemeIcon('git-pull-request', new ThemeColor(Colors.OpenPullRequestIconColor));
			case PullRequestState.Closed:
				return new ThemeIcon('git-pull-request-closed', new ThemeColor(Colors.ClosedPullRequestIconColor));
			case PullRequestState.Merged:
				return new ThemeIcon('git-merge', new ThemeColor(Colors.MergedPullRequestIconColor));
			default:
				return new ThemeIcon('git-pull-request');
		}
	}

	constructor(
		public readonly provider: RemoteProviderReference,
		public readonly author: {
			readonly name: string;
			readonly avatarUrl: string;
			readonly url: string;
		},
		public readonly id: string,
		public readonly title: string,
		public readonly url: string,
		public readonly state: PullRequestState,
		public readonly date: Date,
		public readonly closedDate?: Date,
		public readonly mergedDate?: Date,
	) {}

	get formattedDate(): string {
		return Container.instance.PullRequestDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(Container.instance.PullRequestDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize<PullRequest['formatDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatDate(format?: string | null) {
		return formatDate(this.mergedDate ?? this.closedDate ?? this.date, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatDateFromNow() {
		return fromNow(this.mergedDate ?? this.closedDate ?? this.date);
	}

	@memoize<PullRequest['formatClosedDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatClosedDate(format?: string | null) {
		if (this.closedDate == null) return '';
		return formatDate(this.closedDate, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatClosedDateFromNow() {
		if (this.closedDate == null) return '';
		return fromNow(this.closedDate);
	}

	@memoize<PullRequest['formatMergedDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatMergedDate(format?: string | null) {
		if (this.mergedDate == null) return '';
		return formatDate(this.mergedDate, format ?? 'MMMM Do, YYYY h:mma') ?? '';
	}

	formatMergedDateFromNow() {
		if (this.mergedDate == null) return '';
		return fromNow(this.mergedDate);
	}

	@memoize<PullRequest['formatUpdatedDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatUpdatedDate(format?: string | null) {
		return formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma') ?? '';
	}

	formatUpdatedDateFromNow() {
		return fromNow(this.date);
	}
}
