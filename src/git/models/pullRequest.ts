'use strict';
import { ColorThemeKind, ThemeColor, ThemeIcon, window } from 'vscode';
import { configuration, DateStyle } from '../../configuration';
import { Colors } from '../../constants';
import { Dates, memoize } from '../../system';
import { RemoteProviderReference } from './remoteProvider';

export const PullRequestDateFormatting = {
	dateFormat: undefined! as string | null,
	dateStyle: undefined! as DateStyle,

	reset: () => {
		PullRequestDateFormatting.dateFormat = configuration.get('defaultDateFormat');
		PullRequestDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	},
};

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
		return PullRequestDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(PullRequestDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize()
	private get dateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.mergedDate ?? this.closedDate ?? this.date);
	}

	@memoize<PullRequest['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.dateFormatter.format(format);
	}

	formatDateFromNow() {
		return this.dateFormatter.fromNow();
	}

	@memoize()
	private get closedDateFormatter(): Dates.DateFormatter | undefined {
		return this.closedDate === undefined ? undefined : Dates.getFormatter(this.closedDate);
	}

	@memoize<PullRequest['formatClosedDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatClosedDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.closedDateFormatter?.format(format) ?? '';
	}

	formatClosedDateFromNow() {
		return this.closedDateFormatter?.fromNow() ?? '';
	}

	@memoize()
	private get mergedDateFormatter(): Dates.DateFormatter | undefined {
		return this.mergedDate === undefined ? undefined : Dates.getFormatter(this.mergedDate);
	}

	@memoize<PullRequest['formatMergedDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatMergedDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.mergedDateFormatter?.format(format) ?? '';
	}

	formatMergedDateFromNow() {
		return this.mergedDateFormatter?.fromNow() ?? '';
	}

	@memoize()
	private get updatedDateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.date);
	}

	@memoize<PullRequest['formatUpdatedDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatUpdatedDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.updatedDateFormatter.format(format);
	}

	formatUpdatedDateFromNow() {
		return this.updatedDateFormatter.fromNow();
	}
}
