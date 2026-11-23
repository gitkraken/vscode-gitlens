export interface FrameScheduler {
	request(callback: () => void): number;
	cancel(handle: number): void;
}

const animationFrames: FrameScheduler = {
	request: callback => requestAnimationFrame(callback),
	cancel: handle => cancelAnimationFrame(handle),
};

/** Runs `callback` once on the next frame however many times `schedule` is called before it. */
export class FrameCoalescer {
	private readonly callback: () => void;
	private readonly frames: FrameScheduler;
	private handle: number | undefined;

	constructor(callback: () => void, frames: FrameScheduler = animationFrames) {
		this.callback = callback;
		this.frames = frames;
	}

	schedule(): void {
		this.handle ??= this.frames.request(this.run);
	}

	cancel(): void {
		if (this.handle == null) return;

		this.frames.cancel(this.handle);
		this.handle = undefined;
	}

	private readonly run = (): void => {
		this.handle = undefined;
		this.callback();
	};
}
