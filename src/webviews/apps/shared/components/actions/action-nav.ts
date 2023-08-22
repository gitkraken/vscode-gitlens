import { css, customElement, FASTElement, html, observable, slotted } from '@microsoft/fast-element';
import '../code-icon';

const template = html<ActionNav>`<template role="navigation"><slot ${slotted('actionNodes')}></slot></template>`;

const styles = css`
	:host {
		display: flex;
		align-items: center;
		user-select: none;
	}
`;

@customElement({ name: 'action-nav', template: template, styles: styles })
export class ActionNav extends FASTElement {
	@observable
	actionNodes?: HTMLElement[];

	actionNodesDisposer?: () => void;
	actionNodesChanged(_oldValue?: HTMLElement[], newValue?: HTMLElement[]) {
		this.actionNodesDisposer?.();

		if (!newValue?.length) {
			return;
		}

		const handleKeydown = this.handleKeydown.bind(this);
		const nodeEvents = newValue
			?.filter(node => node.nodeType === 1)
			.map((node, i) => {
				node.setAttribute('tabindex', i === 0 ? '0' : '-1');
				node.addEventListener('keydown', handleKeydown, false);
				return {
					dispose: () => {
						node?.removeEventListener('keydown', handleKeydown, false);
					},
				};
			});

		this.actionNodesDisposer = () => {
			nodeEvents?.forEach(({ dispose }) => dispose());
		};
	}

	override disconnectedCallback() {
		this.actionNodesDisposer?.();
	}

	handleKeydown(e: KeyboardEvent) {
		if (!e.target || this.actionNodes == null || this.actionNodes.length < 2) return;
		const target = e.target as HTMLElement;

		let $next: HTMLElement | null = null;
		if (e.key === 'ArrowLeft') {
			$next = target.previousElementSibling as HTMLElement;
			if ($next == null) {
				const filteredNodes = this.actionNodes.filter(node => node.nodeType === 1);
				$next = filteredNodes[filteredNodes.length - 1] ?? null;
			}
		} else if (e.key === 'ArrowRight') {
			$next = target.nextElementSibling as HTMLElement;
			if ($next == null) {
				$next = this.actionNodes.find(node => node.nodeType === 1) ?? null;
			}
		}
		if ($next == null || $next === target) {
			return;
		}
		target.setAttribute('tabindex', '-1');
		$next.setAttribute('tabindex', '0');
		$next.focus();
	}
}
