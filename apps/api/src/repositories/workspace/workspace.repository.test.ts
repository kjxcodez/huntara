import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockCapturedFilter: any = null;

function makeQuery(result: any) {
  const promise = Promise.resolve(result);
  (promise as any).session = vi.fn().mockImplementation(() => promise);
  (promise as any).sort = vi.fn().mockImplementation(() => promise);
  (promise as any).skip = vi.fn().mockImplementation(() => promise);
  (promise as any).limit = vi.fn().mockImplementation(() => promise);
  return promise;
}

// In-memory MongoDB filter evaluator for $or, $elemMatch, and equality
function evaluateMongoFilter(doc: any, filter: any): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;

  if (filter.$or && Array.isArray(filter.$or)) {
    return filter.$or.some((subFilter: any) => evaluateMongoFilter(doc, subFilter));
  }

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') continue;

    if (value && typeof value === 'object' && (value as any).$elemMatch) {
      const arr = doc[key];
      if (!Array.isArray(arr)) return false;
      const matchCriteria = (value as any).$elemMatch;
      const hasMatch = arr.some((item: any) => {
        return Object.entries(matchCriteria).every(([mKey, mVal]) => item[mKey] === mVal);
      });
      if (!hasMatch) return false;
    } else {
      if (doc[key] !== value) return false;
    }
  }

  return true;
}

const mockWorkspaceDataset = [
  // Case A: Migrated legacy workspace with ownerId but empty members array
  {
    _id: 'ws_legacy_owner_only',
    name: 'Legacy Owner Workspace',
    ownerId: 'usr_target_1',
    members: []
  },
  // Case B: Normal owned workspace with ownerId and active member entry
  {
    _id: 'ws_owned_with_members',
    name: 'Active Owned Workspace',
    ownerId: 'usr_target_1',
    members: [{ userId: 'usr_target_1', role: 'OWNER', status: 'ACTIVE' }]
  },
  // Case C: Workspace where user is an active member but not the owner
  {
    _id: 'ws_active_member_only',
    name: 'Team Workspace (Member)',
    ownerId: 'usr_other_owner',
    members: [{ userId: 'usr_target_1', role: 'MEMBER', status: 'ACTIVE' }]
  },
  // Case D: Workspace where user is an invited/pending member (non-active)
  {
    _id: 'ws_pending_member',
    name: 'Pending Invite Workspace',
    ownerId: 'usr_other_owner',
    members: [{ userId: 'usr_target_1', role: 'MEMBER', status: 'PENDING' }]
  },
  // Case E & F: Another user's workspace (neither owner nor member)
  {
    _id: 'ws_unrelated',
    name: 'Isolated Foreign Workspace',
    ownerId: 'usr_stranger_9',
    members: [{ userId: 'usr_stranger_9', role: 'OWNER', status: 'ACTIVE' }]
  }
];

vi.mock('../../db/models/workspace.model.js', () => {
  return {
    WorkspaceModel: {
      find: (filter: any) => {
        mockCapturedFilter = filter;
        const matching = mockWorkspaceDataset.filter((doc) => evaluateMongoFilter(doc, filter));
        return makeQuery(matching);
      },
      findOne: (filter: any) => {
        mockCapturedFilter = filter;
        const match = mockWorkspaceDataset.find((doc) => evaluateMongoFilter(doc, filter));
        return makeQuery(match || null);
      }
    }
  };
});

import { WorkspaceRepository } from './workspace.repository.js';

describe('WorkspaceRepository.findUserWorkspaces — Regression Coverage', () => {
  let repository: WorkspaceRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCapturedFilter = null;
    repository = new WorkspaceRepository();
  });

  it('CASE A: returns legacy migrated workspaces where ownerId matches even if members is empty', async () => {
    const workspaces = await repository.findUserWorkspaces('usr_target_1');
    const legacyWs = workspaces.find((w: any) => w._id === 'ws_legacy_owner_only');
    expect(legacyWs).toBeDefined();
    expect(legacyWs?._id).toBe('ws_legacy_owner_only');
  });

  it('CASE B: returns workspaces owned by the user that also have active member records', async () => {
    const workspaces = await repository.findUserWorkspaces('usr_target_1');
    const ownedWs = workspaces.find((w: any) => w._id === 'ws_owned_with_members');
    expect(ownedWs).toBeDefined();
    expect(ownedWs?._id).toBe('ws_owned_with_members');
  });

  it('CASE C: returns workspaces where user is an active member but not the owner', async () => {
    const workspaces = await repository.findUserWorkspaces('usr_target_1');
    const memberWs = workspaces.find((w: any) => w._id === 'ws_active_member_only');
    expect(memberWs).toBeDefined();
    expect(memberWs?._id).toBe('ws_active_member_only');
  });

  it('CASE D: does NOT return workspaces where user has non-active (PENDING) membership unless owned', async () => {
    const workspaces = await repository.findUserWorkspaces('usr_target_1');
    const pendingWs = workspaces.find((w: any) => w._id === 'ws_pending_member');
    expect(pendingWs).toBeUndefined();
  });

  it('CASE E: returns an empty array when user owns no workspaces and belongs to none', async () => {
    const workspaces = await repository.findUserWorkspaces('usr_unknown_nobody');
    expect(workspaces).toEqual([]);
  });

  it('CASE F: maintains strict tenant isolation and never leaks unrelated workspaces', async () => {
    const workspaces = await repository.findUserWorkspaces('usr_target_1');
    const foreignWs = workspaces.find((w: any) => w._id === 'ws_unrelated');
    expect(foreignWs).toBeUndefined();
  });

  it('FILTER STRUCTURE: constructs $or clause checking both ownerId and active membership', async () => {
    await repository.findUserWorkspaces('usr_target_1');
    expect(mockCapturedFilter).toBeDefined();
    expect(mockCapturedFilter).toEqual({
      $or: [
        { ownerId: 'usr_target_1' },
        {
          members: {
            $elemMatch: {
              userId: 'usr_target_1',
              status: 'ACTIVE'
            }
          }
        }
      ]
    });
  });
});
