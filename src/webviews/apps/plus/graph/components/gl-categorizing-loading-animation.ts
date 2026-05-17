import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { categorizingLoadingAnimationStyles } from './gl-categorizing-loading-animation.css.js';

export type CategorizingLoadingVariant = 'compose' | 'review';

interface Layout {
	width: number;
	height: number;
	bucketCenters: [number, number, number];
	bucketTop: number;
	bucketHeight: number;
	lensCenterY: number;
	lensHalfWidth: number;
}

const maxParticles = 60;
const spawnMinMs = 80;
const spawnJitterMs = 90;
const initialBurst = 6;

const variantColorVars: Record<CategorizingLoadingVariant, [string, string, string]> = {
	compose: ['--vscode-charts-purple', '--vscode-charts-blue', '--vscode-charts-green'],
	review: ['--vscode-charts-green', '--vscode-charts-yellow', '--vscode-charts-red'],
};

const variantFallbacks: Record<CategorizingLoadingVariant, [string, string, string]> = {
	compose: ['#c084fc', '#60a5fa', '#4ade80'],
	review: ['#4ade80', '#facc15', '#ef4444'],
};

@customElement('gl-categorizing-loading-animation')
export class GlCategorizingLoadingAnimation extends LitElement {
	static override styles = categorizingLoadingAnimationStyles;

	/** Color palette to use. `compose` shows purple/blue/green (categorization),
	 *  `review` shows green/yellow/red (severity). Defaults to `compose`. */
	@property({ reflect: true })
	variant: CategorizingLoadingVariant = 'compose';

	@query('.stage') private stageEl!: HTMLDivElement;

	private readonly _animations = new Set<Animation>();
	private readonly _timers = new Set<ReturnType<typeof setTimeout>>();
	private _resizeObserver?: ResizeObserver;
	private _layout?: Layout;
	private _colors: [string, string, string] = variantFallbacks.compose;
	private _bucketEls: HTMLDivElement[] = [];
	private _lensEl?: HTMLDivElement;
	private _activeParticles = 0;
	private _running = false;
	private _scheduleRafId?: number;

	override render(): unknown {
		return html`<div class="stage" aria-hidden="true"></div>`;
	}

	override firstUpdated(): void {
		// Bail entirely if reduced motion — :host is `display: none` via CSS, but also skip
		// timer/observer setup so we don't burn cycles.
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		this.readColors();
		this.buildScaffold();

		this._resizeObserver = new ResizeObserver(() => this.scheduleRelayout());
		this._resizeObserver.observe(this);

		this.relayout();
		this.start();
	}

	override disconnectedCallback(): void {
		this.stop();
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		if (this._scheduleRafId != null) {
			cancelAnimationFrame(this._scheduleRafId);
			this._scheduleRafId = undefined;
		}
		super.disconnectedCallback?.();
	}

	private readColors(): void {
		const styles = getComputedStyle(this);
		const vars = variantColorVars[this.variant];
		const fallbacks = variantFallbacks[this.variant];
		const read = (name: string, fallback: string) => {
			const v = styles.getPropertyValue(name).trim();
			return v.length > 0 ? v : fallback;
		};
		this._colors = [read(vars[0], fallbacks[0]), read(vars[1], fallbacks[1]), read(vars[2], fallbacks[2])];
	}

	private buildScaffold(): void {
		const lens = document.createElement('div');
		lens.className = 'lens';
		const scanline = document.createElement('div');
		scanline.className = 'lens__scanline';
		lens.appendChild(scanline);
		this.stageEl.appendChild(lens);
		this._lensEl = lens;

		this._bucketEls = this._colors.map(color => {
			const bucket = document.createElement('div');
			bucket.className = 'bucket';
			bucket.style.color = color;
			this.stageEl.appendChild(bucket);
			return bucket;
		});
	}

	private scheduleRelayout(): void {
		if (this._scheduleRafId != null) return;

		this._scheduleRafId = requestAnimationFrame(() => {
			this._scheduleRafId = undefined;
			this.relayout();
		});
	}

	private relayout(): void {
		const rect = this.getBoundingClientRect();
		const width = rect.width;
		const height = rect.height;
		if (width < 10 || height < 10) {
			this._layout = undefined;
			return;
		}

		const bucketWidth = Math.min(110, width * 0.22);
		const bucketHeight = Math.min(70, height * 0.18);
		const bucketSpan = Math.min(width * 0.72, 480);
		const bucketStep = bucketSpan / 2;
		const centerX = width / 2;
		const bucketCenters: [number, number, number] = [centerX - bucketStep, centerX, centerX + bucketStep];
		const bucketTop = height - bucketHeight - Math.min(28, height * 0.06);
		const lensCenterY = Math.min(bucketTop - bucketHeight * 0.4, height * 0.66);
		const lensHalfWidth = Math.min(width * 0.42, 200);

		this._layout = {
			width: width,
			height: height,
			bucketCenters: bucketCenters,
			bucketTop: bucketTop,
			bucketHeight: bucketHeight,
			lensCenterY: lensCenterY,
			lensHalfWidth: lensHalfWidth,
		};

		this._bucketEls.forEach((el, i) => {
			el.style.left = `${bucketCenters[i] - bucketWidth / 2}px`;
			el.style.top = `${bucketTop}px`;
			el.style.width = `${bucketWidth}px`;
			el.style.height = `${bucketHeight}px`;
		});

		if (this._lensEl != null) {
			const lensHeight = 32;
			this._lensEl.style.left = `${centerX - lensHalfWidth}px`;
			this._lensEl.style.top = `${lensCenterY - lensHeight / 2}px`;
			this._lensEl.style.width = `${lensHalfWidth * 2}px`;
			this._lensEl.style.height = `${lensHeight}px`;
		}

		this.toggleAttribute('data-ready', true);
	}

	private start(): void {
		if (this._running) return;

		this._running = true;
		for (let i = 0; i < initialBurst; i++) {
			this.scheduleSpawn(i * 120);
		}
		this.scheduleSpawn(initialBurst * 120);
	}

	private stop(): void {
		this._running = false;
		for (const t of this._timers) {
			clearTimeout(t);
		}
		this._timers.clear();
		for (const a of this._animations) {
			try {
				a.cancel();
			} catch {
				// already finished/cancelled
			}
		}
		this._animations.clear();
	}

	private scheduleSpawn(delay: number): void {
		if (!this._running) return;

		const timer = setTimeout(() => {
			this._timers.delete(timer);
			if (!this._running) return;

			void this.spawnParticle();
			this.scheduleSpawn(spawnMinMs + Math.random() * spawnJitterMs);
		}, delay);
		this._timers.add(timer);
	}

	private async spawnParticle(): Promise<void> {
		if (this._layout == null) return;
		if (this._activeParticles >= maxParticles) return;

		const layout = this._layout;
		const particle = document.createElement('div');
		particle.className = 'particle';
		this.stageEl.appendChild(particle);
		this._activeParticles++;

		try {
			const startX = layout.width / 2 + (Math.random() - 0.5) * layout.width * 0.85;
			const startY = -20;
			const lensX = layout.width / 2 + (Math.random() - 0.5) * layout.lensHalfWidth * 1.6;
			const lensY = layout.lensCenterY;

			// Phase 1: chaotic drift down to the lens
			await this.runAnimation(
				particle,
				[
					{ transform: `translate(${startX}px, ${startY}px)`, opacity: 0 },
					{
						transform: `translate(${
							startX + (lensX - startX) / 2 + (Math.random() - 0.5) * 60
						}px, ${startY + (lensY - startY) / 2}px)`,
						opacity: 0.7,
					},
					{ transform: `translate(${lensX}px, ${lensY}px)`, opacity: 0.85 },
				],
				{ duration: 1200 + Math.random() * 600, easing: 'ease-in-out', fill: 'forwards' },
			);

			// Categorize: pick a bucket, swap to its color and a sharper look
			const colIdx = Math.floor(Math.random() * 3);
			const color = this._colors[colIdx];
			particle.classList.add('particle--categorized');
			particle.style.background = color;
			particle.style.boxShadow = `0 0 1.2rem ${color}`;

			// Phase 2: small jitter while categorizing
			await this.runAnimation(
				particle,
				[
					{ transform: `translate(${lensX}px, ${lensY}px) scale(1)` },
					{
						transform: `translate(${lensX + (Math.random() - 0.5) * 14}px, ${
							lensY + (Math.random() - 0.5) * 8
						}px) scale(1.3)`,
					},
					{ transform: `translate(${lensX}px, ${lensY}px) scale(1)` },
				],
				{ duration: 300, fill: 'forwards' },
			);

			// Phase 3: swoop down into a bucket
			const targetX = layout.bucketCenters[colIdx] + (Math.random() - 0.5) * 60;
			const targetY = layout.bucketTop + layout.bucketHeight * 0.55;
			await this.runAnimation(
				particle,
				[
					{ transform: `translate(${lensX}px, ${lensY}px)`, opacity: 0.85 },
					{
						transform: `translate(${lensX + (targetX - lensX) * 0.3}px, ${
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
			this._activeParticles--;
		}
	}

	private runAnimation(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
		const animation = el.animate(keyframes, options);
		this._animations.add(animation);
		return animation.finished
			.then(() => {
				this._animations.delete(animation);
			})
			.catch((error: unknown) => {
				this._animations.delete(animation);
				throw error;
			});
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-categorizing-loading-animation': GlCategorizingLoadingAnimation;
	}
}
