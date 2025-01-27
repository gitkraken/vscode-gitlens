export function hasNodes(...nodes: (Node[] | undefined)[]): boolean {
	return nodes.some(nodes => (nodes?.length ?? 0) > 0);
}

export function nodeTypeFilter(nodeType: Node['nodeType']): (node: Node) => boolean {
	return (node: Node) => node.nodeType === nodeType;
}
