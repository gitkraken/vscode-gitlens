import { attr, css, customElement, FASTElement, html, repeat, volatile, when } from '@microsoft/fast-element';
import type { TextDocumentShowOptions } from 'vscode';
import { numberConverter } from '../converters/number-converter';
import '../code-icon';

declare global {
	interface HTMLElementEventMap {
		selected: CustomEvent;
	}
}

export interface ListItemSelectedDetail {
	tree: boolean;
	branch: boolean;
	expanded: boolean;
	level: number;
}

const template = html<ListItem>`
	<template
		role="treeitem"
		aria-expanded="${x => (x.expanded === true ? 'true' : 'false')}"
		aria-hidden="${x => x.isHidden}"
	>
		<button id="item" class="item" type="button" @click="${(x, c) => x.onItemClick(c.event)}">
			${repeat(
				x => x.treeLeaves,
				html<ListItem>`<span class="node node--connector"><code-icon name="blank"></code-icon></span>`,
			)}
			${when(
				x => x.branch,
				html<ListItem>`<span class="node"
					><code-icon
						class="branch"
						icon="${x => (x.expanded ? 'chevron-down' : 'chevron-right')}"
					></code-icon
				></span>`,
			)}
			<span class="icon"><slot name="icon"></slot></span>
			<span class="text">
				<span class="main"><slot></slot></span>
				<span class="description"><slot name="description"></slot></span>
			</span>
		</button>
		<nav class="actions"><slot name="actions"></slot></nav>
	</template>
`;

const styles = css`
	:host {
		box-sizing: border-box;
		padding-left: var(--gitlens-gutter-width);
		padding-right: var(--gitlens-scrollbar-gutter-width);
		padding-top: 0.1rem;
		padding-bottom: 0.1rem;
		line-height: 2.2rem;
		height: 2.2rem;

		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		font-size: var(--vscode-font-size);
		color: var(--vscode-sideBar-foreground);
	}

	:host(:hover) {
		color: var(--vscode-list-hoverForeground);
		background-color: var(--vscode-list-hoverBackground);
	}

	:host([active]) {
		color: var(--vscode-list-inactiveSelectionForeground);
		background-color: var(--vscode-list-inactiveSelectionBackground);
	}

	:host(:focus-within) {
		outline: 1px solid var(--vscode-list-focusOutline);
		outline-offset: -0.1rem;
		color: var(--vscode-list-activeSelectionForeground);
		background-color: var(--vscode-list-activeSelectionBackground);
	}

	:host([aria-hidden='true']) {
		display: none;
	}

	* {
		box-sizing: border-box;
	}

	.item {
		appearance: none;
		display: flex;
		flex-direction: row;
		justify-content: flex-start;
		gap: 0.6rem;
		width: 100%;
		padding: 0;
		text-decoration: none;
		color: inherit;
		background: none;
		border: none;
		outline: none;
		cursor: pointer;
		min-width: 0;
	}

	.icon {
		display: inline-block;
		width: 1.6rem;
		text-align: center;
	}

	slot[name='icon']::slotted(*) {
		width: 1.6rem;
		aspect-ratio: 1;
		vertical-align: text-bottom;
	}

	.node {
		display: inline-block;
		width: 1.6rem;
		text-align: center;
	}

	.node--connector {
		position: relative;
	}
	.node--connector::before {
		content: '';
		position: absolute;
		height: 2.2rem;
		border-left: 1px solid transparent;
		top: 50%;
		transform: translate(-50%, -50%);
		left: 0.8rem;
		width: 0.1rem;
		transition: border-color 0.1s linear;
		opacity: 0.4;
	}

	:host-context(.indentGuides-always) .node--connector::before,
	:host-context(.indentGuides-onHover:focus-within) .node--connector::before,
	:host-context(.indentGuides-onHover:hover) .node--connector::before {
		border-color: var(--vscode-tree-indentGuidesStroke);
	}

	.text {
		overflow: hidden;
		white-space: nowrap;
		text-align: left;
		text-overflow: ellipsis;
		flex: 1;
	}

	.description {
		opacity: 0.7;
		margin-left: 0.3rem;
	}

	.actions {
		flex: none;
		user-select: none;
		color: var(--vscode-icon-foreground);
	}

	:host(:focus-within) .actions {
		color: var(--vscode-list-activeSelectionIconForeground);
	}

	:host(:not(:hover):not(:focus-within)) .actions {
		display: none;
	}

	slot[name='actions']::slotted(*) {
		display: flex;
		align-items: center;
	}
`;

@customElement({ name: 'list-item', template: template, styles: styles })
export class ListItem extends FASTElement {
	@attr({ mode: 'boolean' })
	tree = false;

	@attr({ mode: 'boolean' })
	branch = false;

	@attr({ mode: 'boolean' })
	expanded = true;

	@attr({ mode: 'boolean' })
	parentexpanded = true;

	@attr({ converter: numberConverter })
	level = 1;

	@attr({ mode: 'boolean' })
	active = false;

	@volatile
	get treeLeaves() {
		const length = this.level - 1;
		if (length < 1) return [];

		return Array.from({ length: length }, (_, i) => i + 1);
	}

	@volatile
	get isHidden(): 'true' | 'false' {
		if (this.parentexpanded === false || (!this.branch && !this.expanded)) {
			return 'true';
		}

		return 'false';
	}

	onItemClick(_e: Event) {
		this.select();
	}

	select(_showOptions?: TextDocumentShowOptions, quiet = false) {
		this.$emit('select');

		// TODO: this needs to be implemented
		if (this.branch) {
			this.expanded = !this.expanded;
		}

		this.active = true;
		if (!quiet) {
			window.requestAnimationFrame(() => {
				this.$emit('selected', {
					tree: this.tree,
					branch: this.branch,
					expanded: this.expanded,
					level: this.level,
				});
			});
		}
	}

	deselect() {
		this.active = false;
	}

	override focus(options?: FocusOptions | undefined): void {
		this.shadowRoot?.getElementById('item')?.focus(options);
	}
}
