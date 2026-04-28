import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'fs';
import { register as registerSearchNotes } from './tools/search-notes.js';
import { register as registerReadNote } from './tools/read-note.js';
import { register as registerListNotes } from './tools/list-notes.js';
import { register as registerListTags } from './tools/list-tags.js';
import { register as registerGetBacklinks } from './tools/get-backlinks.js';
import { register as registerGetOutgoingLinks } from './tools/get-outgoing-links.js';
import { register as registerGetGraph } from './tools/get-graph.js';
import { register as registerCreateNote } from './tools/create-note.js';
import { register as registerUpdateNote } from './tools/update-note.js';
import { register as registerGetContext } from './tools/get-context.js';
import { register as registerSaveMemory } from './tools/save-memory.js';
import { register as registerSetSessionContext } from './tools/set-session-context.js';
import { register as registerGetSessionContext } from './tools/get-session-context.js';
import { register as registerListSessionContext } from './tools/list-session-context.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

/**
 * Create and configure an McpServer instance with all tools registered.
 *
 * @param {{ userId: string, scopes: string[] }} authContext
 * @returns {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer}
 */
export function createServer(authContext) {
  const server = new McpServer({ name: 'mycelium-mcp', version: pkg.version });

  // Read-only tools
  registerSearchNotes(server, authContext);
  registerReadNote(server, authContext);
  registerListNotes(server, authContext);
  registerListTags(server, authContext);

  // Graph and link tools
  registerGetBacklinks(server, authContext);
  registerGetOutgoingLinks(server, authContext);
  registerGetGraph(server, authContext);

  // Write tools
  registerCreateNote(server, authContext);
  registerUpdateNote(server, authContext);

  // OpenClaw convenience tools
  registerGetContext(server, authContext);
  registerSaveMemory(server, authContext);

  // Session context tools
  registerSetSessionContext(server, authContext);
  registerGetSessionContext(server, authContext);
  registerListSessionContext(server, authContext);

  return server;
}
