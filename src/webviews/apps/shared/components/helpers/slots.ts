export function hasNodes(...nodes: Array<Node[] | undefined>) {
	return nodes.some(nodes => (nodes?.length ?? 0) > 0);
}

export function nodeTypeFilter(nodeType: Node['nodeType']) {
	return (node: Node) => node.nodeType === nodeType;
}
