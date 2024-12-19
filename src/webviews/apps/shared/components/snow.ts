import { css, html, LitElement, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('gl-snow')
export class GlSnow extends LitElement {
	static override styles = [
		css`
			:host {
				display: contents;
				--snow-color: #fff;
			}

			:host(.vscode-light),
			:host(.vscode-high-contrast-light) {
				--snow-color: #424242;
			}

			canvas.snow {
				position: fixed;
				top: 0;
				left: 0;
				width: 100vw;
				height: 100vh;
				pointer-events: none;
				z-index: 2147483646;
			}

			.snow__toggle {
				cursor: pointer;
				width: 16px;
				opacity: 0.6;
				transform: rotate(90deg) scaleX(-1);
				transition:
					filter ease-in-out 250ms,
					opacity ease-in-out 250ms,
					transform ease-in-out 250ms;
			}

			:host(:not([snowing])) .snow__toggle {
				filter: grayscale(100%);
				opacity: 0.5;
			}

			.snow__toggle:hover {
				filter: unset !important;
				opacity: 0.9 !important;
				transform: rotate(0deg) scaleX(-1) scale(1.4);
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	snowing = false;

	private _canvas: HTMLCanvasElement | undefined;
	private _ctx: CanvasRenderingContext2D | undefined;
	private _snowflakes: Snowflake[] = [];
	private _animationFrame: number | undefined;

	private _resizeObserver: ResizeObserver | undefined;

	override connectedCallback() {
		super.connectedCallback();
		this._resizeObserver = new ResizeObserver(() => this.updateCanvasSize());
		this._resizeObserver.observe(document.body);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this._resizeObserver?.disconnect();
	}

	override firstUpdated() {
		this._canvas = this.shadowRoot?.querySelector('canvas.snow') ?? undefined;
		this._ctx = this._canvas?.getContext('2d') ?? undefined;

		if (this._ctx == null) return;

		this.updateCanvasSize();
		this.onToggle(this.snowing);
	}

	override render() {
		return html`
			<canvas class="snow"></canvas>
			<span
				class="snow__toggle"
				title="Let it snow — Happy Holidays!"
				@click=${() => this.onToggle(!this.snowing)}
			>
				${this.renderToggle()}
			</span>
		`;
	}

	private renderToggle() {
		return svg`
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" height="16" width="16" fill="currentColor">
				<path d="M409.162 326.341c38.951-25.866 49.348-36.597 44.162-44.869-1.156-1.848-3.558-4.047-8.362-4.047-9.836 0-29.14 9.461-64.337 31.574-18.816-11.26-39.952-23.652-61.633-36.256 1.416-5.358 2.247-10.942 2.255-16.74-.008-5.797-.839-11.39-2.264-16.739 21.332-12.408 42.655-24.906 61.634-36.264 35.196 22.113 54.501 31.574 64.337 31.574 4.811 0 7.213-2.207 8.377-4.055 5.178-8.256-5.218-18.986-44.169-44.861 69.425-42.867 72.235-51.269 68.538-57.653-.912-1.596-2.89-3.484-7.132-3.484-9.607 0-33.479 10.528-77.07 34-2.907-46.311-6.945-60.673-16.78-60.673-2.255.081-4.324 1.075-5.993 2.874-4.632 5.007-8.614 17.472-6.521 73.846-19.304 10.748-40.546 22.83-62.167 35.222-7.93-7.898-17.904-13.702-29.038-16.707-.082-26.673-.257-50.284-.587-71.51 49.861-26.364 58.671-36.053 60.689-42.566.733-2.345.562-4.633-.496-6.644-1.051-1.978-3.396-4.331-8.598-4.331-8.223 0-23.578 5.886-52.344 20.151C269.245 6.627 263.382 0 255.998 0c-7.377 0-13.239 6.627-15.665 88.185-28.757-14.265-44.112-20.151-52.336-20.151-5.202 0-7.547 2.353-8.597 4.34-1.059 2.002-1.222 4.29-.505 6.636 2.028 6.513 10.829 16.202 60.689 42.566-.349 21.974-.513 46.448-.59 71.51-11.129 3.004-21.103 8.809-29.029 16.707-23.363-13.386-43.579-24.857-62.171-35.197 2.092-56.382-1.889-68.863-6.522-73.87-1.669-1.799-3.738-2.793-6.27-2.891-9.567 0-13.589 14.378-16.495 60.69-43.591-23.473-67.472-33.993-77.079-33.993-4.234 0-6.213 1.889-7.124 3.469-3.697 6.391-.888 14.785 68.538 57.66-38.951 25.874-49.348 36.605-44.17 44.869 1.165 1.84 3.567 4.054 8.378 4.047 9.835 0 29.139-9.461 64.328-31.574 18.791 11.26 39.944 23.652 61.634 36.264-1.416 5.356-2.247 10.942-2.251 16.739.004 5.797.834 11.39 2.255 16.74-21.344 12.416-42.668 24.914-61.622 36.256-35.206-22.113-54.518-31.574-64.353-31.574-4.812 0-7.205 2.198-8.37 4.054-5.178 8.256 5.211 18.987 44.162 44.862-69.425 42.867-72.235 51.269-68.53 57.66.911 1.58 2.89 3.468 7.124 3.468 9.607 0 33.488-10.519 77.07-34 2.915 46.311 6.937 60.689 16.495 60.689 0 0 .236-.008.285-.008 2.255-.081 4.324-1.083 5.993-2.874 4.632-5.016 8.614-17.48 6.522-73.854 19.222-10.69 40.244-22.651 62.166-35.213 7.93 7.905 17.908 13.71 29.042 16.715.086 26.664.261 50.267.59 71.501-49.868 26.372-58.67 36.052-60.698 42.566-.716 2.344-.554 4.633.505 6.644 1.05 1.978 3.395 4.331 8.597 4.331 8.224 0 23.58-5.887 52.336-20.151 2.426 81.557 8.288 88.185 15.665 88.185 7.384 0 13.247-6.628 15.665-88.185 28.765 14.264 44.121 20.151 52.344 20.151 5.202 0 7.548-2.353 8.598-4.34 1.058-2.002 1.229-4.291.496-6.636-2.018-6.514-10.828-16.194-60.681-42.566.346-21.974.51-46.441.59-71.501 11.13-3.005 21.108-8.81 29.034-16.715 21.434 12.286 42.912 24.498 62.168 35.213-2.093 56.366 1.888 68.839 6.521 73.854 1.669 1.791 3.738 2.793 5.993 2.874.057 0 .228.008.284.008 9.559 0 13.58-14.378 16.488-60.689 43.592 23.481 67.472 34 77.087 34 4.225 0 6.204-1.888 7.116-3.468 3.699-6.401.889-14.795-68.536-57.662zm-131.495-48.672c-5.605 5.57-13.149 8.964-21.665 8.973-8.516-.008-16.06-3.403-21.666-8.973-5.572-5.609-8.963-13.148-8.972-21.665.008-8.516 3.399-16.064 8.972-21.666 5.606-5.577 13.15-8.964 21.666-8.972 8.516.008 16.06 3.395 21.665 8.972 5.574 5.602 8.964 13.15 8.972 21.666-.008 8.517-3.398 16.056-8.972 21.665z"/>
			</svg>
		`;
	}

	private onToggle(snowing: boolean): void {
		this.snowing = snowing;

		if (this.snowing) {
			this.createSnowflakes();
			this._animationFrame = requestAnimationFrame(() => this.updateAnimation());
		} else {
			if (this._animationFrame) {
				cancelAnimationFrame(this._animationFrame);
			}
			this.clear();
		}
	}

	private updateCanvasSize(): void {
		if (this._canvas == null) return;

		this._canvas.width = window.innerWidth;
		this._canvas.height = window.innerHeight;

		if (this.snowing) {
			this.createSnowflakes();
		}
	}

	private clear(): void {
		if (this._canvas == null || this._ctx == null) return;

		this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
		this._snowflakes = [];
	}

	private createSnowflakes(): void {
		this._snowflakes = Array.from({ length: window.innerWidth / 4 }, () => new Snowflake());
	}

	private updateAnimation(): void {
		if (this._ctx == null || this._canvas == null) return;

		this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

		const color = getComputedStyle(this).getPropertyValue('--snow-color').trim();

		for (const flake of this._snowflakes) {
			flake.update();

			this._ctx.save();
			this._ctx.fillStyle = color;
			this._ctx.beginPath();
			this._ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
			this._ctx.closePath();
			this._ctx.globalAlpha = flake.alpha;
			this._ctx.fill();
			this._ctx.restore();
		}

		this._animationFrame = requestAnimationFrame(() => this.updateAnimation());
	}
}

class Snowflake {
	alpha = 0;
	radius = 0;
	x = 0;
	y = 0;

	private _vx = 0;
	private _vy = 0;

	constructor() {
		this.reset();
	}

	reset() {
		this.alpha = randomBetween(0.1, 0.9);
		this.radius = randomBetween(1, 4);
		this.x = randomBetween(0, window.innerWidth);
		this.y = randomBetween(0, -window.innerHeight);
		this._vx = randomBetween(-3, 3);
		this._vy = randomBetween(2, 5);
	}

	update() {
		this.x += this._vx;
		this.y += this._vy;

		if (this.y + this.radius > window.innerHeight) {
			this.reset();
		}
	}
}

function randomBetween(min: number, max: number) {
	return min + Math.random() * (max - min);
}
