import { ToolRegistry } from '@huntara/agent-core';
import { SchedulerGatewayImpl } from './scheduler-gateway';
import { SearchLocalBusinessesTool } from './maps-tool';
import { CrawlWebsiteTool } from './crawler-tool';
import type Database from 'better-sqlite3';
import type { LocalEventBus } from '../../lib/event-bus';

/**
 * Creates and initializes a new ToolRegistry instance populated with the workspace's
 * bridged infrastructure tools using the SchedulerGateway.
 */
export function createWorkspaceToolRegistry(
  db: Database.Database,
  eventBus: LocalEventBus
): ToolRegistry {
  const gateway = new SchedulerGatewayImpl(db, eventBus);
  const registry = new ToolRegistry();

  registry.register(new SearchLocalBusinessesTool(gateway));
  registry.register(new CrawlWebsiteTool(gateway));

  return registry;
}
