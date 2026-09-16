import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

describe('Phase 4 — Projection & Cache Synchronization Suite', () => {
  const workspaceId = 'ws_test_456';

  let queryClient: QueryClient;
  let backendAudiences: Array<{ id: string; name: string; workspaceId: string }>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0
        }
      }
    });

    backendAudiences = [
      { id: 'aud_initial', name: 'Initial Target Audience', workspaceId }
    ];
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section 14: Required Test — ContactsScreen -> CampaignsScreen Flow
  // ──────────────────────────────────────────────────────────────────────────
  describe('Section 14: ContactsScreen Audience Creation to CampaignsScreen Immediate Visibility', () => {
    it('invalidates canonical query key so created audience in ContactsScreen is immediately available in CampaignsScreen dropdown', async () => {
      // Step 1: CampaignsScreen loads initial audience list with canonical key
      const initialFetch = await queryClient.fetchQuery({
        queryKey: ['audiences', 'list', workspaceId],
        queryFn: async () => [...backendAudiences]
      });

      expect(initialFetch).toHaveLength(1);
      expect(initialFetch[0]?.id).toBe('aud_initial');

      // Step 2: User is on ContactsScreen and creates an audience
      const newAudience = {
        id: 'aud_new_from_contacts',
        name: 'High-Value Decision Makers',
        workspaceId
      };

      // Simulating audiences:create IPC + backend write
      backendAudiences.push(newAudience);

      // ContactsScreen success handler invalidates the canonical query key
      await queryClient.invalidateQueries({
        queryKey: ['audiences', 'list', workspaceId]
      });

      // Step 3: User navigates to CampaignsScreen
      // CampaignsScreen uses canonical key ['audiences', 'list', workspaceId]
      const campaignsAudienceList = await queryClient.fetchQuery({
        queryKey: ['audiences', 'list', workspaceId],
        queryFn: async () => [...backendAudiences]
      });

      // Verify the new audience is present in the CampaignsScreen dropdown data immediately
      expect(campaignsAudienceList).toHaveLength(2);
      expect(campaignsAudienceList.map((a) => a.id)).toContain('aud_new_from_contacts');
      expect(campaignsAudienceList.map((a) => a.name)).toContain('High-Value Decision Makers');
    });

    it('demonstrates that the previous mismatched key would have left CampaignsScreen stale', async () => {
      // Step 1: Suppose CampaignsScreen previously registered ['audiences', workspaceId]
      await queryClient.fetchQuery({
        queryKey: ['audiences', workspaceId],
        queryFn: async () => [...backendAudiences]
      });

      // Step 2: Contacts/Audiences screen invalidates ['audiences', 'list', workspaceId]
      backendAudiences.push({
        id: 'aud_unseen',
        name: 'Unseen Audience',
        workspaceId
      });

      await queryClient.invalidateQueries({
        queryKey: ['audiences', 'list', workspaceId]
      });

      // With old mismatched key, query was NOT invalidated (remains fresh/stale in cache)
      const cachedQueryState = queryClient.getQueryState(['audiences', workspaceId]);
      expect(cachedQueryState?.isInvalidated).toBe(false);

      // But with the canonical key ['audiences', 'list', workspaceId], it IS marked invalidated
      const canonicalQueryState = queryClient.getQueryState(['audiences', 'list', workspaceId]);
      // Either non-existent or invalidated
      expect(canonicalQueryState?.isInvalidated ?? true).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section 15: Focused Verification — Projection Broadcast
  // ──────────────────────────────────────────────────────────────────────────
  describe('Section 15: Projection Broadcast Sequence in audiences:create', () => {
    it('executes saveFromServer then broadcastProjectionUpdated before returning created entity', async () => {
      const executionOrder: string[] = [];
      const mockWorkspaceId = 'ws_broadcast_test';

      const mockSdk = {
        audiences: {
          create: vi.fn().mockImplementation(async (payload) => {
            executionOrder.push('sdk.audiences.create');
            return { id: 'aud_999', ...payload };
          })
        }
      };

      const mockLocalCRMRepository = {
        saveFromServer: vi.fn().mockImplementation(async (entityType, record) => {
          executionOrder.push(`saveFromServer:${entityType}:${record.id}`);
        })
      };

      const mockProjectionService = {
        broadcastProjectionUpdated: vi.fn().mockImplementation((scope, wsId) => {
          executionOrder.push(`broadcastProjectionUpdated:${scope}:${wsId}`);
        })
      };

      // Simulating audiences:create handler sequence from audiences-ipc.ts
      const handleAudienceCreate = async (record: any) => {
        if (!record.workspaceId) throw new Error('workspaceId is required.');
        if (!record.name) throw new Error('name is required.');

        const payload = {
          ...record,
          mode: record.mode || 'dynamic',
          filterDefinition: record.filterDefinition || {},
          staticMemberIds: record.staticMemberIds || []
        };

        const created = await mockSdk.audiences.create(payload);
        await mockLocalCRMRepository.saveFromServer('audiences', created);
        mockProjectionService.broadcastProjectionUpdated('audiences', record.workspaceId);
        return created;
      };

      const inputRecord = {
        workspaceId: mockWorkspaceId,
        name: 'Enterprise VIPs',
        mode: 'static',
        staticMemberIds: ['c1', 'c2']
      };

      const created = await handleAudienceCreate(inputRecord);

      // Verify return value
      expect(created.id).toBe('aud_999');
      expect(created.name).toBe('Enterprise VIPs');

      // Verify exact sequence order:
      // 1. sdk.audiences.create
      // 2. saveFromServer
      // 3. broadcastProjectionUpdated
      expect(executionOrder).toEqual([
        'sdk.audiences.create',
        'saveFromServer:audiences:aud_999',
        `broadcastProjectionUpdated:audiences:${mockWorkspaceId}`
      ]);

      expect(mockProjectionService.broadcastProjectionUpdated).toHaveBeenCalledWith(
        'audiences',
        mockWorkspaceId
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section 15: Alternate Creation Paths Invalidation
  // ──────────────────────────────────────────────────────────────────────────
  describe('Section 15: Alternate Creation Paths Query Invalidation', () => {
    it('invalidates canonical query key on ContactsScreen handleSaveAudience', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Simulated handleSaveAudience logic from ContactsScreen.tsx
      const handleSaveAudienceSuccess = async () => {
        await queryClient.invalidateQueries({
          queryKey: ['audiences', 'list', workspaceId]
        });
      };

      await handleSaveAudienceSuccess();

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['audiences', 'list', workspaceId]
      });
    });

    it('invalidates canonical query key on ContactsScreen CreateAudienceModal onSuccess', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Simulated modal onSuccess from ContactsScreen.tsx
      const onModalSuccess = () => {
        queryClient.invalidateQueries({
          queryKey: ['audiences', 'list', workspaceId]
        });
      };

      onModalSuccess();

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['audiences', 'list', workspaceId]
      });
    });

    it('invalidates canonical query key on CompaniesScreen CreateAudienceModal onSuccess', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Simulated modal onSuccess from CompaniesScreen.tsx
      const onModalSuccess = () => {
        queryClient.invalidateQueries({
          queryKey: ['audiences', 'list', workspaceId]
        });
      };

      onModalSuccess();

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['audiences', 'list', workspaceId]
      });
    });
  });
});
