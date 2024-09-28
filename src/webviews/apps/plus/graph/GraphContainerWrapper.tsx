import React from 'react';
import ReactDOM from 'react-dom';
import { GraphWrapper } from './GraphWrapper';
import r2wc from '@r2wc/react-to-web-component';

const GraphContainerWrapper = (props) => {
  return <GraphWrapper {...props} />;
};

customElements.define('graph-container-wrapper', r2wc(GraphContainerWrapper));
