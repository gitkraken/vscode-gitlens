import { customElement, property } from 'lit/decorators.js';
import { html, css } from 'lit';
import { ContextProvider } from '@lit/context';
import { GlElement } from '../../shared/components/element';
import { stateContext } from './context';
import { GraphContainer } from '@gitkraken/gitkraken-components';
import { reactToWebComponent } from '@r2wc/react-to-web-component';

@customElement('gl-graph-wrapper')
export class GlGraphWrapper extends GlElement {
  static styles = css`
    :host {
      display: block;
    }
  `;

  @property({ type: Object })
  state;

  private provider;

  constructor() {
    super();
    this.provider = new ContextProvider(this, { context: stateContext, initialValue: this.state });
  }

  render() {
    return html`
      <div>
        <graph-container .state=${this.state}></graph-container>
      </div>
    `;
  }
}

const GraphContainerWC = reactToWebComponent(GraphContainer, React, ReactDOM);
customElements.define('graph-container', GraphContainerWC);
