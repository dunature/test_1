export function providerToolsFromRegistry(registry) {
    const tools = registry?.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
    }));
    return tools && tools.length > 0 ? tools : undefined;
}
