export function hasNodes(...nodes: (Node[] | undefined)[]) {
	return nodes.some(nodes => (nodes?.length ?? 0) > 0);
}

export function nodeTypeFilter(nodeType: Node['nodeType']) {
	return (node: Node) => node.nodeType === nodeType;
}
