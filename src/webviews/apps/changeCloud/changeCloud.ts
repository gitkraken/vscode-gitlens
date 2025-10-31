/*global*/
import './changeCloud.scss';
import { css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { ChangeCloudTerm, State } from '../../changeCloud/protocol';
import { SelectTermCommand } from '../../changeCloud/protocol';
import { GlAppHost } from '../shared/appHost';
import type { LoggerContext } from '../shared/contexts/logger';
import type { HostIpc } from '../shared/ipc';
import { ChangeCloudStateProvider } from './stateProvider';

@customElement('gl-change-cloud-app')
export class GlChangeCloudApp extends GlAppHost<State> {
	static override styles = [
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
			}

			.container {
				display: flex;
				flex-direction: column;
				height: 100%;
				padding: 2rem;
				gap: 2rem;
			}

			.cloud-container {
				flex: 1;
				display: flex;
				align-items: center;
				justify-content: center;
				position: relative;
				overflow: hidden;
				padding: 2rem;
			}

			.word-cloud {
				position: relative;
				width: 800px;
				height: 400px;
				max-width: 100%;
			}

			.cloud-term {
				position: absolute;
				cursor: pointer;
				transition: all 0.2s ease;
				user-select: none;
				padding: 0.25rem 0.5rem;
				border-radius: 4px;
				white-space: nowrap;
			}

			.cloud-term:hover {
				transform: scale(1.1);
				background-color: var(--vscode-list-hoverBackground);
			}

			.cloud-term.selected {
				background-color: var(--vscode-list-activeSelectionBackground);
				color: var(--vscode-list-activeSelectionForeground);
			}

			.cloud-term.business {
				color: var(--vscode-charts-blue);
			}

			.cloud-term.technical {
				color: var(--vscode-charts-green);
			}

			.info-panel {
				border-top: 1px solid var(--vscode-panel-border);
				padding: 1.5rem;
				min-height: 120px;
				background-color: var(--vscode-editor-background);
			}

			.info-title {
				font-size: 1.6rem;
				font-weight: 600;
				margin-bottom: 0.5rem;
			}

			.info-category {
				display: inline-block;
				padding: 0.4rem 0.8rem;
				border-radius: 3px;
				font-size: 1.1rem;
				margin-bottom: 0.5rem;
			}

			.info-category.business {
				background-color: var(--vscode-charts-blue);
				color: white;
			}

			.info-category.technical {
				background-color: var(--vscode-charts-green);
				color: white;
			}

			.info-reasoning {
				color: var(--vscode-descriptionForeground);
				line-height: 1.6;
				font-size: 1.2rem;
			}

			.summary-stats {
				display: flex;
				gap: 2rem;
				margin-top: 0.5rem;
				color: var(--vscode-descriptionForeground);
				font-size: 1.2rem;
			}

			.stat {
				display: flex;
				align-items: center;
				gap: 0.5rem;
			}

			.stat-value {
				font-weight: 600;
				color: var(--vscode-foreground);
				font-size: 1.4rem;
			}
		`,
	];

	@state()
	private selectedTerm: string | null = null;

	@state()
	private termPositions: Map<string, { x: number; y: number; width: number; height: number }> = new Map();

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): ChangeCloudStateProvider {
		return new ChangeCloudStateProvider(this, bootstrap, ipc, logger);
	}

	private handleTermClick(term: ChangeCloudTerm): void {
		if (this.selectedTerm === term.term) {
			this.selectedTerm = null;
		} else {
			this.selectedTerm = term.term;
		}
		this._ipc.sendCommand(SelectTermCommand, { term: this.selectedTerm });
	}

	private getTermFontSize(weight: number): string {
		const minSize = 1;
		const maxSize = 4;
		const normalizedWeight = (weight - 1) / 9;
		const size = minSize + normalizedWeight * (maxSize - minSize);
		return `${size}rem`;
	}

	private calculateWordCloudLayout(terms: { term: string; weight: number }[]): Map<string, { x: number; y: number }> {
		const positions = new Map<string, { x: number; y: number }>();
		const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
		const containerWidth = 800;
		const containerHeight = 400;
		const centerX = containerWidth / 2;
		const centerY = containerHeight / 2;
		const padding = 5;

		terms.forEach((term, index) => {
			const fontSize = this.getTermFontSizePixels(term.weight);
			const estimatedWidth = term.term.length * fontSize * 0.6 + padding * 2;
			const estimatedHeight = fontSize * 1.2 + padding * 2;

			let x = centerX;
			let y = centerY;
			let placedSuccessfully = false;
			let spiralRadius = 0;
			let spiralAngle = 0;

			if (index === 0) {
				x = centerX;
				y = centerY;
				placedSuccessfully = true;
			} else {
				for (let attempt = 0; attempt < 3000; attempt++) {
					spiralRadius = attempt * 0.8;
					spiralAngle = attempt * 0.15;
					x = centerX + spiralRadius * Math.cos(spiralAngle);
					y = centerY + spiralRadius * Math.sin(spiralAngle);

					const bounds = {
						x: x - estimatedWidth / 2,
						y: y - estimatedHeight / 2,
						width: estimatedWidth,
						height: estimatedHeight,
					};

					if (
						bounds.x < padding ||
						bounds.x + bounds.width > containerWidth - padding ||
						bounds.y < padding ||
						bounds.y + bounds.height > containerHeight - padding
					) {
						continue;
					}

					const hasCollision = placed.some(other => {
						return !(
							bounds.x + bounds.width < other.x ||
							bounds.x > other.x + other.width ||
							bounds.y + bounds.height < other.y ||
							bounds.y > other.y + other.height
						);
					});

					if (!hasCollision) {
						placedSuccessfully = true;
						break;
					}
				}
			}

			if (placedSuccessfully) {
				positions.set(term.term, { x: x, y: y });
				placed.push({
					x: x - estimatedWidth / 2,
					y: y - estimatedHeight / 2,
					width: estimatedWidth,
					height: estimatedHeight,
				});
			}
		});

		return positions;
	}

	private getTermFontSizePixels(weight: number): number {
		const minSize = 16;
		const maxSize = 64;
		const normalizedWeight = (weight - 1) / 9;
		return minSize + normalizedWeight * (maxSize - minSize);
	}

	private renderWordCloud(): unknown {
		if (!this.state?.data?.terms) {
			return html`<div class="cloud-container">
				<p>No data available</p>
			</div>`;
		}

		const sortedTerms = [...this.state.data.terms].sort((a, b) => b.weight - a.weight);
		const positions = this.calculateWordCloudLayout(sortedTerms);

		return html`
			<div class="cloud-container">
				<div class="word-cloud">
					${sortedTerms.map(term => {
						const position = positions.get(term.term);
						if (!position) return null;

						return html`
							<span
								class="cloud-term ${term.category} ${this.selectedTerm === term.term ? 'selected' : ''}"
								style="font-size: ${this.getTermFontSize(
									term.weight,
								)}; top: ${position.y}px; left: ${position.x}px; transform: translate(-50%, -50%)"
								@click=${() => this.handleTermClick(term)}
							>
								${term.term}
							</span>
						`;
					})}
				</div>
			</div>
		`;
	}

	private renderInfoPanel(): unknown {
		if (!this.state?.data) {
			return html`<div class="info-panel">
				<p>No data available</p>
			</div>`;
		}

		if (this.selectedTerm) {
			const term = this.state.data.terms.find(t => t.term === this.selectedTerm);
			if (term) {
				return html`
					<div class="info-panel">
						<div class="info-title">${term.term}</div>
						<div class="info-category ${term.category}">${term.category}</div>
						<div class="info-reasoning">${term.reasoning}</div>
					</div>
				`;
			}
		}

		return html`
			<div class="info-panel">
				<div class="info-title">Summary</div>
				<div class="info-reasoning">${this.state.data.summary}</div>
				<div class="summary-stats">
					<div class="stat">
						<span>Total Files:</span>
						<span class="stat-value">${this.state.data.total_files}</span>
					</div>
					<div class="stat">
						<span>Total Commits:</span>
						<span class="stat-value">${this.state.data.total_commits}</span>
					</div>
				</div>
			</div>
		`;
	}

	override render(): unknown {
		return html` <div class="container">${this.renderWordCloud()} ${this.renderInfoPanel()}</div> `;
	}
}
