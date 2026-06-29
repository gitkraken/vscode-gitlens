import { customElement } from 'lit/decorators.js';
import { convergingLoadingAnimationStyles } from './gl-converging-loading-animation.css.js';
import { ParticleLoadingAnimation } from './particleLoadingAnimation.js';

interface Layout {
	centerX: number;
	mouthHalfWidth: number;
	lensCenterY: number;
	lensHalfWidth: number;
	bucketCenterX: number;
	bucketTop: number;
	bucketHeight: number;
	bucketWidth: number;
}

// current (left) / incoming (right) / resolved (merged).
const colorVars: [string, string, string] = ['--vscode-charts-blue', '--vscode-charts-orange', '--vscode-charts-green'];
const colorFallbacks: [string, string, string] = ['#60a5fa', '#f0883e', '#4ade80'];

/** "Converging" loader: two side-streams (current = blue from the upper left, incoming = orange
 *  from the upper right) funnel down into a central lens, fuse to green, and fall into a single
 *  resolved bucket. The conceptual inverse of the categorizing loader (many→one, not one→many),
 *  sharing its lens/scanline vocabulary. Used by the AI conflict-resolution (resolve) mode. */
@customElement('gl-converging-loading-animation')
export class GlConvergingLoadingAnimation extends ParticleLoadingAnimation {
	static override styles = convergingLoadingAnimationStyles;

	private _layout?: Layout;
	private _colors: [string, string, string] = colorFallbacks;
	private _lensEl?: HTMLDivElement;
	private _bucketEl?: HTMLDivElement;
	/** Flips each spawn so particles alternate left/right — keeps the two sides balanced. */
	private _spawnSide = 0;

	protected override readColors(): void {
		const styles = getComputedStyle(this);
		const read = (name: string, fallback: string) => {
			const v = styles.getPropertyValue(name).trim();
			return v.length > 0 ? v : fallback;
		};
		this._colors = [
			read(colorVars[0], colorFallbacks[0]),
			read(colorVars[1], colorFallbacks[1]),
			read(colorVars[2], colorFallbacks[2]),
		];
	}

	protected override buildScaffold(): void {
		const lens = document.createElement('div');
		lens.className = 'lens';
		const scanline = document.createElement('div');
		scanline.className = 'lens__scanline';
		lens.appendChild(scanline);
		this.stageEl.appendChild(lens);
		this._lensEl = lens;

		const bucket = document.createElement('div');
		bucket.className = 'bucket';
		bucket.style.color = this._colors[2];
		this.stageEl.appendChild(bucket);
		this._bucketEl = bucket;
	}

	protected override relayout(): void {
		const rect = this.getBoundingClientRect();
		const width = rect.width;
		const height = rect.height;
		if (width < 10 || height < 10) {
			this._layout = undefined;
			this.toggleAttribute('data-ready', false);
			return;
		}

		const centerX = width / 2;
		// Wide top "mouth" narrowing to a smaller lens gives the funnel read.
		const mouthHalfWidth = Math.min(width * 0.42, 240);
		const lensHalfWidth = Math.min(width * 0.2, 110);
		const lensHeight = 32;
		const bucketWidth = Math.min(110, width * 0.22);
		const bucketHeight = Math.min(70, height * 0.18);
		const bucketTop = height - bucketHeight - Math.min(28, height * 0.06);
		const lensCenterY = Math.min(bucketTop - bucketHeight * 0.4, height * 0.66);

		this._layout = {
			centerX: centerX,
			mouthHalfWidth: mouthHalfWidth,
			lensCenterY: lensCenterY,
			lensHalfWidth: lensHalfWidth,
			bucketCenterX: centerX,
			bucketTop: bucketTop,
			bucketHeight: bucketHeight,
			bucketWidth: bucketWidth,
		};

		if (this._lensEl != null) {
			this._lensEl.style.left = `${centerX - lensHalfWidth}px`;
			this._lensEl.style.top = `${lensCenterY - lensHeight / 2}px`;
			this._lensEl.style.width = `${lensHalfWidth * 2}px`;
			this._lensEl.style.height = `${lensHeight}px`;
		}

		if (this._bucketEl != null) {
			this._bucketEl.style.left = `${centerX - bucketWidth / 2}px`;
			this._bucketEl.style.top = `${bucketTop}px`;
			this._bucketEl.style.width = `${bucketWidth}px`;
			this._bucketEl.style.height = `${bucketHeight}px`;
		}

		this.toggleAttribute('data-ready', true);
	}

	protected override async spawnParticle(): Promise<void> {
		if (this._layout == null) return;

		const layout = this._layout;
		const fromLeft = (this._spawnSide = 1 - this._spawnSide) === 0;
		const sideSign = fromLeft ? -1 : 1;
		const sideColor = fromLeft ? this._colors[0] : this._colors[1];

		const particle = document.createElement('div');
		particle.className = 'particle';
		particle.style.background = sideColor;
		this.stageEl.appendChild(particle);

		try {
			// Phase 1: funnel down from the wide top toward the lens
			const startX = layout.centerX + sideSign * layout.mouthHalfWidth * (0.4 + Math.random() * 0.6);
			const startY = -16 + (Math.random() - 0.5) * 20;
			// Keep each side on its own half of the lens so the streams meet at the seam without crossing.
			const lensX = layout.centerX + sideSign * layout.lensHalfWidth * (0.15 + Math.random() * 0.85);
			const lensY = layout.lensCenterY;
			const midX = startX + (lensX - startX) * 0.5;
			const midY = startY + (lensY - startY) * 0.5;

			await this.runAnimation(
				particle,
				[
					{ transform: `translate(${startX}px, ${startY}px)`, opacity: 0 },
					{ transform: `translate(${midX}px, ${midY}px)`, opacity: 0.7 },
					{ transform: `translate(${lensX}px, ${lensY}px)`, opacity: 0.85 },
				],
				{ duration: 1100 + Math.random() * 600, easing: 'ease-in', fill: 'forwards' },
			);

			// Merge at the lens: the two sides fuse — recolor to resolved green with a glow.
			const merged = this._colors[2];
			particle.classList.add('particle--merged');
			particle.style.background = merged;
			particle.style.boxShadow = `0 0 1.2rem ${merged}`;

			// Phase 2: small jitter/pulse while merging
			await this.runAnimation(
				particle,
				[
					{ transform: `translate(${lensX}px, ${lensY}px) scale(1)` },
					{
						transform: `translate(${lensX + (Math.random() - 0.5) * 8}px, ${
							lensY + (Math.random() - 0.5) * 8
						}px) scale(1.3)`,
					},
					{ transform: `translate(${lensX}px, ${lensY}px) scale(1)` },
				],
				{ duration: 300, fill: 'forwards' },
			);

			// Phase 3: fall down into the single bucket
			const targetX = layout.bucketCenterX + (Math.random() - 0.5) * layout.bucketWidth * 0.4;
			const targetY = layout.bucketTop + layout.bucketHeight * 0.55;
			await this.runAnimation(
				particle,
				[
					{ transform: `translate(${lensX}px, ${lensY}px)`, opacity: 0.85 },
					{
						transform: `translate(${lensX + (targetX - lensX) * 0.4}px, ${
							lensY + (targetY - lensY) * 0.6
						}px)`,
						opacity: 0.9,
					},
					{ transform: `translate(${targetX}px, ${targetY}px)`, opacity: 1 },
				],
				{ duration: 600 + Math.random() * 200, easing: 'ease-in-out', fill: 'forwards' },
			);

			// Phase 4: splash & fade
			await this.runAnimation(
				particle,
				[
					{ transform: `translate(${targetX}px, ${targetY}px) scale(1)`, opacity: 1 },
					{
						transform: `translate(${targetX}px, ${targetY + 8}px) scale(2.4)`,
						opacity: 0,
					},
				],
				{ duration: 280, fill: 'forwards' },
			);
		} catch {
			// Animation cancelled (component disconnected) — fall through to cleanup.
		} finally {
			particle.remove();
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-converging-loading-animation': GlConvergingLoadingAnimation;
	}
}
