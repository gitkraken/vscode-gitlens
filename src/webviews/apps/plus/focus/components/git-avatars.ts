import { css, customElement, FASTElement, html, observable, repeat, volatile, when } from '@microsoft/fast-element';

import '../../../shared/components/avatars/avatar-item';
import '../../../shared/components/avatars/avatar-stack';

const template = html<GitAvatars>`
	<avatar-stack>
		${repeat(
			x => x.avatarItems,
			html<AvatarShape>`<avatar-item media="${x => x.avatarUrl}" title="${x => x.name}"></avatar-item>`,
		)}
		${when(
			x => x.avatarPlusItems != null,
			html<GitAvatars>`<avatar-item title="${x => x.avatarPlusLabel}"
				>+${x => x.avatarPlusItems?.length}</avatar-item
			>`,
		)}
	</avatar-stack>
`;

const styles = css``;

interface AvatarShape {
	name: string;
	avatarUrl: string;
	url: string;
}

@customElement({
	name: 'git-avatars',
	template: template,
	styles: styles,
})
export class GitAvatars extends FASTElement {
	@observable
	avatars: AvatarShape[] = [];

	@volatile
	get avatarItems(): AvatarShape[] {
		if (this.avatars.length <= 3) {
			return this.avatars;
		}
		return this.avatars.slice(0, 2);
	}

	@volatile
	get avatarPlusItems(): AvatarShape[] | undefined {
		const len = this.avatars.length;
		if (len <= 3) {
			return undefined;
		}
		return this.avatars.slice(2);
	}

	@volatile
	get avatarPlusLabel(): string | undefined {
		if (this.avatarPlusItems == null) {
			return undefined;
		}
		const len = this.avatarPlusItems.length;
		return this.avatarPlusItems.reduce(
			(all, current, i) => `${all}, ${len === i - 1 ? 'and ' : ''}${current.name}`,
			'',
		);
	}
}
