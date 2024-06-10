import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { elementBase } from '../../shared/components/styles/lit/base.css';
import '../../shared/components/overlays/tooltip';

@customElement('video-button')
export class VideoButton extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				--video-button-background: #01000a;
				--video-button-foreground: #fff;
				display: block;
			}

			.video-button {
				display: flex;
				flex-direction: row;
				justify-content: space-between;
				align-items: center;
				background-color: var(--video-button-background);
				padding: 0 2rem 0 1rem;
				color: var(--video-button-foreground);
				transition: background-color ease-in-out 150ms;
				border-radius: 0.4rem;
				position: relative;
				overflow: hidden;
				height: 70px;
				text-decoration: none;
			}

			.video-button .play {
				transform: scale(1.2);
				transition: transform ease-in-out 150ms;
			}
			.video-button:hover .play {
				transform: scale(1.4);
			}

			.background {
				position: absolute;
				top: 0;
				left: 0;
				right: 0;
				bottom: 0;
				width: 100%;
				height: 100%;
				object-fit: cover;
				object-position: center;
				transition: transform ease-in-out 150ms;
			}
			.video-button:hover .background {
				transform: translateX(-3px) scale(1.05);
			}

			.background__base {
				fill: var(--video-button-background);
				transition: fill ease-in-out 150ms;
			}
			.video-button:hover .background__base {
				opacity: 0.5;
			}

			.title {
				/* position: absolute; */
				align-self: center;
				color: var(--video-button-foreground);
				font-weight: 400;
				text-shadow:
					0 0 5px rgba(0, 0, 0, 1),
					0 0 10px rgba(0, 0, 0, 1),
					0 0 15px rgba(0, 0, 0, 1);
				transform: scale(1.2);
				transform-origin: left;
				transition: transform ease-in-out 150ms;
				z-index: 1;
			}
			.video-button:hover .title {
				transform: scale(1.4);
			}
		`,
	];

	@property({ reflect: true })
	src: string | undefined;

	override render() {
		return html` <a
			class="video-button"
			href="https://youtu.be/oJdlGtsbc3U?utm_source=inapp&amp;utm_medium=welcome_banner&amp;utm_id=GitLens+tutorial"
			aria-label="Watch the Tutorial video"
		>
			<img class="background" .src=${this.src} alt="Video thumbnail" />
			<span class="title">Tutorial Video</span>
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- prettier-ignore -->
			<svg class="play" width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path
					d="M13.8626 11.0319C14.3464 10.5343 24.5 16.0074 24.5 17.5C24.5 18.9926 14.346 24.4657 13.8627 23.9681C13.3794 23.4706 13.3788 11.5294 13.8626 11.0319Z"
					fill="currentColor"
				></path>
				<path
					d="M34 18C34 26.8366 26.8366 34 18 34C9.16344 34 2 26.8366 2 18C2 9.16344 9.16344 2 18 2C26.8366 2 34 9.16344 34 18Z"
					stroke="#DE98FF"
				></path>
			</svg>
		</a>`;
	}
}
