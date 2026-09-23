import { BaseRepository } from '../base/base.repository.js';
import { WorkspaceModel, type WorkspaceDocument } from '../../db/models/workspace.model.js';

export class WorkspaceRepository extends BaseRepository<WorkspaceDocument> {
  constructor() {
    super(WorkspaceModel);
  }

  public async findBySlug(slug: string): Promise<WorkspaceDocument | null> {
    return this.findOne({ slug });
  }

  public async findUserWorkspaces(userId: string): Promise<WorkspaceDocument[]> {
    return this.findMany({
      $or: [
        { ownerId: userId },
        {
          members: {
            $elemMatch: {
              userId,
              status: 'ACTIVE'
            }
          }
        }
      ]
    });
  }

  public async findByInvitationToken(token: string): Promise<WorkspaceDocument | null> {
    return this.findOne({ 'members.invitationToken': token });
  }

  public async findPendingInvitesByEmail(email: string): Promise<WorkspaceDocument[]> {
    return this.findMany({
      members: {
        $elemMatch: {
          email: email.toLowerCase().trim(),
          status: 'PENDING'
        }
      }
    });
  }
}
