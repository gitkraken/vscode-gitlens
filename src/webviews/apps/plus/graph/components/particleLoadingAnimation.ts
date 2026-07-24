import { html, LitElement } from 'lit';
import { query } from 'lit/decorators.js';

/**
 * Shared machinery for the graph details' particle "loading" animations. Owns the stage element,
 * a jittered spawn loop with a hard active-particle cap, Web-Animations bookkeeping (so everything
 * is cancelled on disconnect), a `ResizeObserver`-driven relayout, and the reduced-motion bail.
 *
 * Subclasses supply only the animation-specific pieces: the palette (`readColors`), the static
 * scaffold (`buildScaffold`), the geometry (`relayout`), and the per-particle phase chain
 * (`spawnParticle`). They own their own `_layout` since its shape differs per animation.
 */
export abstract class ParticleLoadingAnimation extends LitElement {
	@query('.stage') protected stageEl!: HTMLDivElement;

	/** Hard cap on concurrently-animating particles. */
	protected maxParticles = 60;
	/** Minimum delay between steady-state spawns. */
	protected spawnMinMs = 80;
	/** Extra random spawn delay added on top of `spawnMinMs`. */
	protected spawnJitterMs = 90;
	/** Particles kicked off up front before the steady-state loop. */
	protected initialBurst = 6;
	/** Stagger between the initial-burst spawns. */
	protected burstStaggerMs = 120;

	private readonly _animations = new Set<Animation>();
	private readonly _timers = new Set<ReturnType<typeof setTimeout>>();
	private _resizeObserver?: ResizeObserver;
	private _running = false;
	private _activeParticles = 0;
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

	/** Read the palette into instance state. Called once, before `buildScaffold`. */
	protected abstract readColors(): void;
	/** Build the static scaffold (lens/seam, buckets, …) into the stage. Called once. */
	protected abstract buildScaffold(): void;
	/** (Re)compute geometry for the current size and position the scaffold. Must toggle the
	 *  `data-ready` attribute once a valid layout exists (and clear `_layout` when too small). */
	protected abstract relayout(): void;
	/** Build, animate, and remove a single particle through its phase chain. The base owns the
	 *  active-count cap and accounting, so this only needs to guard its own `_layout`. */
	protected abstract spawnParticle(): Promise<void>;

	protected scheduleRelayout(): void {
		if (this._scheduleRafId != null) return;

		this._scheduleRafId = requestAnimationFrame(() => {
			this._scheduleRafId = undefined;
			this.relayout();
		});
	}

	protected runAnimation(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
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

	protected stop(): void {
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

	private start(): void {
		if (this._running) return;

		this._running = true;
		for (let i = 0; i < this.initialBurst; i++) {
			this.scheduleSpawn(i * this.burstStaggerMs);
		}
		this.scheduleSpawn(this.initialBurst * this.burstStaggerMs);
	}

	private scheduleSpawn(delay: number): void {
		if (!this._running) return;

		const timer = setTimeout(() => {
			this._timers.delete(timer);
			if (!this._running) return;

			void this.runSpawn();
			this.scheduleSpawn(this.spawnMinMs + Math.random() * this.spawnJitterMs);
		}, delay);
		this._timers.add(timer);
	}

	/** Cap + active-count accounting around the subclass's `spawnParticle`. */
	private async runSpawn(): Promise<void> {
		if (this._activeParticles >= this.maxParticles) return;

		this._activeParticles++;
		try {
			await this.spawnParticle();
		} finally {
			this._activeParticles--;
		}
	}
}
