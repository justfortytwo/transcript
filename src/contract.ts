/** Bump on any breaking change to the transcript tool surface below. */
export const TRANSCRIPT_CONTRACT_VERSION = 1;

/** Fully-qualified MCP tool names, served by the memory server through its extension seam. */
export const TRANSCRIPT_MCP_TOOLS = [
  'mcp__fortytwo-memory__transcript_search',
  'mcp__fortytwo-memory__transcript_context',
] as const;
