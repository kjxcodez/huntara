import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('IPC Contract Verification (Phase 4 Invariant)', () => {
  // Resolve paths relative to desktop package root
  const desktopRoot = path.resolve(__dirname, '../../..');
  const projectRoot = path.resolve(desktopRoot, '../..');
  const preloadPath = path.join(desktopRoot, 'src/preload/index.ts');
  const rendererDir = path.join(desktopRoot, 'src/renderer');
  const mainIpcDir = path.join(desktopRoot, 'src/main/ipc');
  const mainLibDir = path.join(desktopRoot, 'src/main/lib');
  const mainServicesDir = path.join(desktopRoot, 'src/main/services');
  const mainIndexFile = path.join(desktopRoot, 'src/main/index.ts');
  const schemaIpcFile = path.join(projectRoot, 'packages/schema/src/ipc/index.ts');

  // Helper to extract channel arrays from preload
  function getPreloadChannels(): {
    invokeChannels: string[];
    onChannels: string[];
  } {
    const content = fs.readFileSync(preloadPath, 'utf8');

    const invokeBlockMatch = content.match(
      /invoke:[\s\S]*?const validChannels:\s*Array<string>\s*=\s*\[([\s\S]*?)\];/
    );
    const onBlockMatch = content.match(
      /on:[\s\S]*?const validChannels:\s*Array<string>\s*=\s*\[([\s\S]*?)\];/
    );

    if (!invokeBlockMatch?.[1] || !onBlockMatch?.[1]) {
      throw new Error('Failed to parse validChannels from preload/index.ts');
    }

    const extract = (block: string) => {
      const matches = block.match(/'([^'\s]+)'/g) || [];
      return matches.map((m) => m.replace(/'/g, ''));
    };

    return {
      invokeChannels: extract(invokeBlockMatch[1]),
      onChannels: extract(onBlockMatch[1])
    };
  }

  // Helper to discover all main handlers
  function getMainRegistrations(): {
    handleChannels: Set<string>;
    onChannels: Set<string>;
    emittedEvents: Set<string>;
  } {
    const handleChannels = new Set<string>();
    const onChannels = new Set<string>();
    const emittedEvents = new Set<string>();

    function scan(dirOrFile: string) {
      if (!fs.existsSync(dirOrFile)) return;
      const stat = fs.statSync(dirOrFile);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(dirOrFile)) {
          scan(path.join(dirOrFile, entry));
        }
      } else if (dirOrFile.endsWith('.ts') && !dirOrFile.endsWith('.test.ts')) {
        const content = fs.readFileSync(dirOrFile, 'utf8');

        // Match safeRegister and ipcMain.handle
        for (const m of content.matchAll(/safeRegister\(\s*['"]([^'"\s]+)['"]/g)) {
          if (m[1]) handleChannels.add(m[1]);
        }
        for (const m of content.matchAll(/ipcMain\.handle\(\s*['"]([^'"\s]+)['"]/g)) {
          if (m[1]) handleChannels.add(m[1]);
        }

        // Match ipcMain.on
        for (const m of content.matchAll(/ipcMain\.on\(\s*['"]([^'"\s]+)['"]/g)) {
          if (m[1]) onChannels.add(m[1]);
        }

        // Match webContents.send and broadcast
        for (const m of content.matchAll(/webContents\.send\(\s*['"]([^'"\s]+)['"]/g)) {
          if (m[1]) emittedEvents.add(m[1]);
        }
        for (const m of content.matchAll(/broadcast\(\s*['"]([^'"\s]+)['"]/g)) {
          if (m[1]) emittedEvents.add(m[1]);
        }
      }
    }

    scan(mainIpcDir);
    scan(path.join(mainLibDir, 'playwright-setup.ts'));
    scan(path.join(mainLibDir, 'event-bridge.ts'));
    scan(path.join(mainLibDir, 'workspace-runtime.ts'));
    scan(path.join(mainLibDir, 'logger.ts'));
    scan(path.join(mainServicesDir, 'updater.ts'));
    scan(path.join(mainServicesDir, 'connectivity-service.ts'));
    scan(path.join(mainServicesDir, 'projection-service.ts'));
    scan(path.join(mainServicesDir, 'cache-hydrator.ts'));
    scan(mainIndexFile);

    // EventBridge autoEvents array
    const ebContent = fs.readFileSync(path.join(mainLibDir, 'event-bridge.ts'), 'utf8');
    for (const m of ebContent.matchAll(/'(automation:[^']+)'/g)) {
      if (m[1]) emittedEvents.add(m[1]);
    }

    // Playwright browser install progress
    emittedEvents.add('browser:install-progress');

    return { handleChannels, onChannels, emittedEvents };
  }

  // Helper to discover all renderer calls
  function getRendererUsage(): {
    invokedChannels: Set<string>;
    listenedChannels: Set<string>;
  } {
    const invokedChannels = new Set<string>();
    const listenedChannels = new Set<string>();

    function scan(dir: string) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx')
        ) {
          const content = fs.readFileSync(full, 'utf8');

          // Match invoke
          for (const m of content.matchAll(/(?:ipc\.invoke|\.invoke)\(\s*['"]([^'"\s]+)['"]/g)) {
            if (m[1]) invokedChannels.add(m[1]);
          }

          // Match on
          for (const m of content.matchAll(/(?:window\.ipc\.on|\bipc\.on)\(\s*['"]([^'"\s]+)['"]/g)) {
            if (m[1]) listenedChannels.add(m[1]);
          }
        }
      }
    }

    scan(rendererDir);
    return { invokedChannels, listenedChannels };
  }

  describe('1. Preload Registry Integrity & Deduplication', () => {
    it('has zero duplicate entries in invoke validChannels', () => {
      const { invokeChannels } = getPreloadChannels();
      const duplicates = invokeChannels.filter(
        (item, index) => invokeChannels.indexOf(item) !== index
      );
      expect(duplicates, `Found duplicate preload invoke channels: ${duplicates.join(', ')}`).toEqual([]);
    });

    it('has zero duplicate entries in on validChannels', () => {
      const { onChannels } = getPreloadChannels();
      const duplicates = onChannels.filter(
        (item, index) => onChannels.indexOf(item) !== index
      );
      expect(duplicates, `Found duplicate preload on channels: ${duplicates.join(', ')}`).toEqual([]);
    });
  });

  describe('2. Notification Center Canonical Contract (Step 2 Repair)', () => {
    it('enforces canonical discovery:run:list in Notification Center, preload, and main', () => {
      const { invokeChannels } = getPreloadChannels();
      const { handleChannels } = getMainRegistrations();
      const notifCenterFile = path.join(rendererDir, 'components/common/NotificationCenter.tsx');
      const notifContent = fs.readFileSync(notifCenterFile, 'utf8');

      // 1. NotificationCenter must invoke canonical discovery:run:list
      expect(notifContent).toContain("window.ipc.invoke('discovery:run:list'");
      expect(notifContent).not.toContain("window.ipc.invoke('discovery:list'");

      // 2. Preload must allow discovery:run:list and forbid dead discovery:list
      expect(invokeChannels).toContain('discovery:run:list');
      expect(invokeChannels).not.toContain('discovery:list');

      // 3. Main must register discovery:run:list and have no handler for discovery:list
      expect(handleChannels.has('discovery:run:list')).toBe(true);
      expect(handleChannels.has('discovery:list')).toBe(false);
    });

    it('ensures other dead discovery channels are completely removed', () => {
      const { invokeChannels } = getPreloadChannels();
      const deadChannels = [
        'discovery:list',
        'discovery:create',
        'discovery:get',
        'discovery:results',
        'discovery:import',
        'discovery:skip'
      ];
      for (const ch of deadChannels) {
        expect(invokeChannels, `Dead channel ${ch} should not be in preload`).not.toContain(ch);
      }
    });
  });

  describe('3. Renderer → Preload → Main Invoke Alignment', () => {
    it('ensures every renderer-invoked channel is exposed by preload', () => {
      const { invokeChannels } = getPreloadChannels();
      const { invokedChannels } = getRendererUsage();
      const preloadSet = new Set(invokeChannels);

      const unexposed: string[] = [];
      for (const ch of invokedChannels) {
        if (!preloadSet.has(ch)) {
          unexposed.push(ch);
        }
      }

      expect(
        unexposed,
        `Renderer invokes channels blocked by preload: ${unexposed.join(', ')}`
      ).toEqual([]);
    });

    it('ensures every preload invoke channel maps 1:1 to a registered main handler (no dead preload channels)', () => {
      const { invokeChannels } = getPreloadChannels();
      const { handleChannels } = getMainRegistrations();

      const deadChannels: string[] = [];
      for (const ch of invokeChannels) {
        if (!handleChannels.has(ch)) {
          deadChannels.push(ch);
        }
      }

      expect(
        deadChannels,
        `Preload exposes invoke channels with no main handler: ${deadChannels.join(', ')}`
      ).toEqual([]);
    });

    it('ensures all active main handlers are exposed in preload (no unexposed handlers)', () => {
      const { invokeChannels } = getPreloadChannels();
      const { handleChannels } = getMainRegistrations();
      const preloadSet = new Set(invokeChannels);

      const unexposedHandlers: string[] = [];
      for (const ch of handleChannels) {
        if (!preloadSet.has(ch)) {
          unexposedHandlers.push(ch);
        }
      }

      expect(
        unexposedHandlers,
        `Main registers handlers not exposed in preload invoke: ${unexposedHandlers.join(', ')}`
      ).toEqual([]);
    });
  });

  describe('4. Invoke / Event Classification Invariant', () => {
    it('ensures no push-event channels are placed in preload invoke array', () => {
      const { invokeChannels } = getPreloadChannels();
      const eventOnlyChannels = [
        'system:connectivity-changed',
        'auth:unauthorized',
        'sync:completed',
        'system:log:event',
        'browser:install-progress'
      ];

      for (const ev of eventOnlyChannels) {
        expect(
          invokeChannels,
          `Event channel ${ev} should NOT be in preload invoke.validChannels`
        ).not.toContain(ev);
      }
    });

    it('ensures no request/response invoke channels are placed in preload on array', () => {
      const { onChannels } = getPreloadChannels();
      const invokeOnlyChannels = [
        'companies:list',
        'companies:create',
        'system:status',
        'auth:login',
        'auth:register',
        'auth:logout',
        'auth:session',
        'workspaces:create',
        'workspaces:list',
        'scheduler:tick'
      ];

      for (const ch of invokeOnlyChannels) {
        expect(
          onChannels,
          `Invoke channel ${ch} should NOT be in preload on.validChannels`
        ).not.toContain(ch);
      }
    });

    it('ensures all renderer event listeners are allowed in preload on array', () => {
      const { onChannels } = getPreloadChannels();
      const { listenedChannels } = getRendererUsage();
      const onSet = new Set(onChannels);

      const blocked: string[] = [];
      for (const ch of listenedChannels) {
        if (!onSet.has(ch)) {
          blocked.push(ch);
        }
      }

      expect(
        blocked,
        `Renderer listens to events blocked by preload on: ${blocked.join(', ')}`
      ).toEqual([]);
    });
  });

  describe('5. Schema Synchronization', () => {
    it('ensures every preload invoke channel is declared in IpcChannelMap', () => {
      const { invokeChannels } = getPreloadChannels();
      const schemaContent = fs.readFileSync(schemaIpcFile, 'utf8');

      const missingInSchema: string[] = [];
      for (const ch of invokeChannels) {
        if (!schemaContent.includes(`'${ch}':`)) {
          missingInSchema.push(ch);
        }
      }

      expect(
        missingInSchema,
        `Channels in preload missing from IpcChannelMap: ${missingInSchema.join(', ')}`
      ).toEqual([]);
    });
  });
});
