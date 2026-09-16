import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 5 Remediation — Issue #29: campaigns:pause & Lifecycle IPC Authorization', () => {
  const preloadPath = path.resolve(__dirname, '../../preload/index.ts');
  const campaignsIpcPath = path.resolve(__dirname, '../ipc/campaigns-ipc.ts');
  const campaignsScreenPath = path.resolve(__dirname, '../../renderer/screens/CampaignsScreen.tsx');
  const schemaIpcPath = path.resolve(__dirname, '../../../../../packages/schema/src/ipc/index.ts');

  // Helper to extract validChannels array from preload/index.ts
  const getPreloadValidChannels = (): string[] => {
    const preloadContent = fs.readFileSync(preloadPath, 'utf8');
    const invokeSection = preloadContent.slice(
      preloadContent.indexOf('invoke: <K extends keyof IpcChannelMap>'),
      preloadContent.indexOf('on: <K extends keyof IpcChannelMap>')
    );
    const channelMatches = invokeSection.match(/'[a-zA-Z0-9_:-]+'/g) || [];
    return channelMatches.map((c) => c.replace(/'/g, ''));
  };

  // Helper simulating preload invocation logic
  const simulatePreloadInvoke = (channel: string, payload?: any) => {
    const validChannels = getPreloadValidChannels();
    if (validChannels.includes(channel)) {
      return Promise.resolve({ success: true, channel, payload });
    }
    return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Static Preload Whitelist Verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('Static Preload & Handler Whitelist Verification', () => {
    it('confirms that CampaignsScreen.tsx invokes campaigns:pause, campaigns:resume, and campaigns:stop', () => {
      const screenContent = fs.readFileSync(campaignsScreenPath, 'utf8');

      expect(screenContent).toContain("window.ipc.invoke('campaigns:pause', campaignId)");
      expect(screenContent).toContain("window.ipc.invoke('campaigns:resume', campaignId)");
      expect(screenContent).toContain("window.ipc.invoke('campaigns:stop', campaignId)");
    });

    it('confirms that campaigns-ipc.ts registers safeRegister for all lifecycle channels', () => {
      const ipcContent = fs.readFileSync(campaignsIpcPath, 'utf8');

      expect(ipcContent).toContain("safeRegister('campaigns:pause'");
      expect(ipcContent).toContain("safeRegister('campaigns:resume'");
      expect(ipcContent).toContain("safeRegister('campaigns:stop'");
      expect(ipcContent).toContain("safeRegister('campaigns:runtime:overview'");
    });

    it('verifies remediation: all four lifecycle channels are present in preload/index.ts validChannels', () => {
      const validChannels = getPreloadValidChannels();

      expect(validChannels).toContain('campaigns:pause');
      expect(validChannels).toContain('campaigns:resume');
      expect(validChannels).toContain('campaigns:stop');
      expect(validChannels).toContain('campaigns:runtime:overview');
    });

    it('verifies type safety: all four lifecycle channels are declared in schema IpcChannelMap', () => {
      const schemaContent = fs.readFileSync(schemaIpcPath, 'utf8');

      expect(schemaContent).toContain("'campaigns:pause':");
      expect(schemaContent).toContain("'campaigns:resume':");
      expect(schemaContent).toContain("'campaigns:stop':");
      expect(schemaContent).toContain("'campaigns:runtime:overview':");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Preload Invocation Security Boundary Verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('Preload Invocation Security Boundary', () => {
    it('authorizes campaigns:pause invocation cleanly', async () => {
      await expect(simulatePreloadInvoke('campaigns:pause', 'camp_123')).resolves.toEqual({
        success: true,
        channel: 'campaigns:pause',
        payload: 'camp_123'
      });
    });

    it('authorizes campaigns:resume invocation cleanly', async () => {
      await expect(simulatePreloadInvoke('campaigns:resume', 'camp_123')).resolves.toEqual({
        success: true,
        channel: 'campaigns:resume',
        payload: 'camp_123'
      });
    });

    it('authorizes campaigns:stop invocation cleanly', async () => {
      await expect(simulatePreloadInvoke('campaigns:stop', 'camp_123')).resolves.toEqual({
        success: true,
        channel: 'campaigns:stop',
        payload: 'camp_123'
      });
    });

    it('authorizes campaigns:runtime:overview invocation cleanly', async () => {
      await expect(
        simulatePreloadInvoke('campaigns:runtime:overview', { workspaceId: 'ws_1' })
      ).resolves.toEqual({
        success: true,
        channel: 'campaigns:runtime:overview',
        payload: { workspaceId: 'ws_1' }
      });
    });

    it('preserves the security boundary: rejects arbitrary or malicious channels', async () => {
      await expect(simulatePreloadInvoke('malicious:eval')).rejects.toThrow(
        'Unauthorized IPC channel: malicious:eval'
      );
      await expect(simulatePreloadInvoke('campaigns:arbitrary_injection')).rejects.toThrow(
        'Unauthorized IPC channel: campaigns:arbitrary_injection'
      );
      await expect(simulatePreloadInvoke('system:format_disk')).rejects.toThrow(
        'Unauthorized IPC channel: system:format_disk'
      );
    });
  });
});
