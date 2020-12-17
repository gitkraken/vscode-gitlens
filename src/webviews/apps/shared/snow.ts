'use strict';
/*global window document requestAnimationFrame*/

function randomBetween(min: number, max: number) {
	return min + Math.random() * (max - min);
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

export class Snow {
	private readonly _canvas: HTMLCanvasElement | undefined;
	private readonly _ctx: CanvasRenderingContext2D | undefined;
	private _height: number = 0;
	private _width: number = 0;
	private readonly _snowflakes: Snowflake[] = [];

	private readonly _clearBound: () => void;
	private readonly _updateBound: () => void;

	constructor(public snowing: boolean = true) {
		this._clearBound = this.clear.bind(this);
		this._updateBound = this.update.bind(this);

		this._canvas = document.querySelector<HTMLCanvasElement>('canvas.snow') ?? undefined;
		this._ctx = this._canvas?.getContext('2d') ?? undefined;

		if (this._ctx == null) return;

		const trigger = document.querySelector('.snow__trigger');
		if (trigger != null) {
			trigger.addEventListener('click', () => this.onToggle(!this.snowing));
		}

		window.addEventListener('resize', () => this.onResize());
		this.onResize();

		this.onToggle(snowing);
	}

	onToggle(snowing: boolean): void {
		this.snowing = snowing;
		document.body.classList.toggle('snowing', this.snowing);

		if (this.snowing) {
			this.createSnowflakes();
			requestAnimationFrame(this._updateBound);
		}
	}

	onResize(): void {
		if (this._canvas == null) return;

		this._height = window.innerHeight;
		this._width = window.innerWidth;
		this._canvas.width = this._width;
		this._canvas.height = this._height;
	}

	clear(): void {
		if (this._canvas == null || this._ctx == null) return;

		this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
		this._snowflakes.length = 0;
	}

	createSnowflakes(): void {
		const flakes = window.innerWidth / 4;

		for (let i = 0; i < flakes; i++) {
			this._snowflakes.push(new Snowflake());
		}
	}

	update(): void {
		if (this._ctx == null) return;

		this._ctx.clearRect(0, 0, this._width, this._height);

		const color = document.body.classList.contains('vscode-light') ? '#424242' : '#fff';

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

		requestAnimationFrame(this.snowing ? this._updateBound : this._clearBound);
	}
}
