import { attr, css, customElement, FASTElement, html, when } from '@microsoft/fast-element';
import '../code-icon';
import '../formatted-date';

const template = html<CommitIdentity>`
	<template>
		<a class="avatar" href="${x => (x.email ? `mailto:${x.email}` : '#')}">
			${when(
				x => x.showAvatar,
				html<CommitIdentity>`<img class="thumb" lazy src="${x => x.avatarUrl}" alt="${x => x.name}" />`,
			)}
			${when(x => !x.showAvatar, html<CommitIdentity>`<code-icon icon="person" size="32"></code-icon>`)}
		</a>
		<a class="name" href="${x => (x.email ? `mailto:${x.email}` : '#')}">${x => x.name}</a>
		<span class="date"
			>${x => x.actionLabel} <formatted-date date=${x => x.date} format="${x => x.dateFormat}"></formatted-date
		></span>
	</template>
`;

const styles = css`
	:host {
		display: grid;
		gap: 0rem 1rem;
		justify-content: start;
	}
	a {
		color: var(--color-link-foreground);
		text-decoration: none;
	}
	.avatar {
		grid-column: 1;
		grid-row: 1 / 3;
		width: 36px;
	}
	.thumb {
		width: 100%;
		height: auto;
		border-radius: 0.4rem;
	}
	.name {
		grid-column: 2;
		grid-row: 1;
		font-size: 1.5rem;
	}
	.date {
		grid-column: 2;
		grid-row: 2;
		font-size: 1.3rem;
	}
`;

@customElement({ name: 'commit-identity', template: template, styles: styles })
export class CommitIdentity extends FASTElement {
	@attr({ mode: 'reflect' })
	name = '';

	@attr({ mode: 'reflect' })
	email = '';

	@attr({ mode: 'reflect' })
	date = '';

	@attr({ mode: 'reflect' })
	avatarUrl = 'https://www.gravatar.com/avatar/?s=64&d=robohash';

	@attr({ mode: 'boolean' })
	showAvatar = false;

	@attr({ mode: 'reflect' })
	dateFormat = 'MMMM Do, YYYY h:mma';

	@attr({ mode: 'boolean' })
	committer = false;

	@attr({ mode: 'reflect' })
	actionLabel = 'committed';
}
