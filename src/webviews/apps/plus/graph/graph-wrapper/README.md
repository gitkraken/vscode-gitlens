# Graph Wrapper Element

This directory contains components for wrapping the React-based `GraphWrapperReact` component in a web component using LitElement.

## Components

### GraphWrapperElement

`GraphWrapperElement` is a LitElement-based web component that encapsulates the React `GraphWrapperReact` component. It provides the following benefits:

1. **Efficient Updates**: Uses a subscriber pattern to update the React component's state without remounting it
2. **Web Component Interface**: Exposes the React component as a standard web component
3. **Event Forwarding**: Forwards all events from the React component to the web component

### Usage

#### Basic Usage

```html
<gl-graph-wrapper-element
    .avatars=${avatars}
    .columns=${columns}
    .context=${context}
    .config=${config}
    .rows=${rows}
    ?windowFocused=${windowFocused}
    ?loading=${loading}
    @changecolumns=${handleChangeColumns}
    @graphmouseleave=${handleGraphMouseLeave}
    @changeselection=${handleChangeSelection}
    @doubleclickrow=${handleDoubleClickRow}
></gl-graph-wrapper-element>
```

#### Using in LitElement

```typescript
import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import './graph-wrapper-element';

@customElement('my-component')
export class MyComponent extends LitElement {
    render() {
        return html`
            <gl-graph-wrapper-element
                .avatars=${{}}
                .columns=${{}}
                .context=${{}}
                .config=${{}}
                .rows=${[]}
                ?windowFocused=${true}
                ?loading=${false}
                @changecolumns=${this.handleChangeColumns}
            ></gl-graph-wrapper-element>
        `;
    }

    private handleChangeColumns(e: CustomEvent) {
        console.log('Columns changed:', e.detail);
    }
}
```

#### Using in React

```tsx
import React from 'react';
import { GlGraphWrapperElement } from './graph-wrapper-element.react';

export function MyReactComponent() {
    const handleChangeColumns = (e) => {
        console.log('Columns changed:', e.detail);
    };

    return (
        <GlGraphWrapperElement
            avatars={{}}
            columns={{}}
            context={{}}
            config={{}}
            rows={[]}
            windowFocused={true}
            loading={false}
            onChangeColumns={handleChangeColumns}
        />
    );
}
```

## How It Works

### Subscriber Pattern

The component uses a subscriber pattern to allow the React component to update its state without remounting:

1. The LitElement component passes a `subscriber` function to the React component
2. The React component calls this function with a state updater function
3. When the LitElement component's properties change, it calls the state updater function
4. The React component updates its state without remounting

### Event Forwarding

Events from the React component are forwarded to the web component:

1. The React component calls event handlers passed as props
2. The web component dispatches custom events with the same data
3. Consumers of the web component can listen for these events

## Properties and Events

The component supports all properties and events of the `GraphWrapperReact` component:

### Properties

- `activeRow`: string
- `avatars`: Record<string, string>
- `columns`: any
- `context`: Record<string, any>
- `config`: any
- `downstreams`: any
- `rows`: GraphRow[]
- `excludeRefs`: any
- `excludeTypes`: any
- `nonce`: string
- `paging`: any
- `loading`: boolean
- `selectedRows`: Record<string, boolean>
- `windowFocused`: boolean
- `refsMetadata`: any
- `includeOnlyRefs`: any
- `rowsStats`: any
- `rowsStatsLoading`: boolean
- `workingTreeStats`: any
- `theming`: any
- `searchResults`: any
- `filter`: any

### Events

- `changecolumns`: Fired when columns change
- `graphmouseleave`: Fired when mouse leaves the graph
- `changerefsvisibility`: Fired when refs visibility changes
- `changeselection`: Fired when selection changes
- `doubleclickref`: Fired when a ref is double-clicked
- `doubleclickrow`: Fired when a row is double-clicked
- `missingavatars`: Fired when avatars are missing
- `missingrefsmetadata`: Fired when refs metadata is missing
- `morerows`: Fired when more rows are needed
- `changevisibledays`: Fired when visible days change
- `graphrowhovered`: Fired when a row is hovered
- `graphrowunhovered`: Fired when a row is unhovered
- `rowcontextmenu`: Fired when row context menu is opened
