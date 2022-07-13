import GraphContainer, { GraphRow } from '@axosoft/gitkraken-components/lib/components/graph/GraphContainer';
import * as React from 'react';
import { calculateCSSVariables } from './graphUtils';

interface GKProps {
  extensionUri?: any;
  graphRows?: GraphRow[];
  repo?: string;
  nonce?: string;
}

interface GKState {
  rows?: GraphRow[];
}

export class GKGraph extends React.Component<GKProps, GKState> {
  constructor(props: GKProps) {
    super(props);

    this.state = {
      rows: []
    };
  }

  override render() {
    const {
      graphRows,
      repo,
      nonce
    } = this.props;
    return (
      <div className="GKGraph">
        <h2 >{repo}</h2>
        <GraphContainer
          graphRows={(graphRows != null)? graphRows : []}
          useAuthorInitialsForAvatars={false}
          nonce={nonce}
          cssVariables={calculateCSSVariables()}
        />
      </div>
    );
  }
}
