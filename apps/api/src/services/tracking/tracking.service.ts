import { EmailDeliveryModel, type EmailDeliveryDocument } from '../../db/models/email-delivery.model.js';
import { EmailEventRepository } from '../../repositories/email-event/email-event.repository.js';
import { EmailEventType } from '@huntara/schema';
import { logger } from '../../config/index.js';

// Minimal 1x1 transparent GIF binary (43 bytes)
const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function isLikelyPrefetchOrBot(userAgent?: string): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return (
    ua.includes('googleimageproxy') ||
    ua.includes('yahoo! slurp') ||
    ua.includes('bot') ||
    ua.includes('crawler') ||
    ua.includes('spider') ||
    ua.includes('preview') ||
    ua.includes('applebot')
  );
}

export class TrackingService {
  /**
   * Processes a public open-tracking pixel request.
   * Records OPENED event and increments delivery open metrics.
   * Always returns a valid 1x1 transparent GIF without leaking state.
   */
  public static async handleOpen(
    token: string,
    metadata?: { userAgent?: string | undefined; ip?: string | undefined }
  ): Promise<Buffer> {
    if (!token || typeof token !== 'string' || token.length < 16) {
      return TRANSPARENT_1X1_GIF;
    }

    try {
      const delivery = await EmailDeliveryModel.findOne({ openTrackingToken: token });
      if (!delivery) {
        return TRANSPARENT_1X1_GIF;
      }

      const now = new Date();
      const isPrefetch = isLikelyPrefetchOrBot(metadata?.userAgent);

      // Event deduplication: deduplicate identical requests within a 60-second window
      const minuteBucket = Math.floor(now.getTime() / 60000);
      const dedupeKey = `open_${token}_${minuteBucket}`;

      const eventRepo = new EmailEventRepository(delivery.workspaceId);
      await eventRepo.recordEvent({
        deliveryId: delivery._id.toString(),
        contactId: delivery.contactId,
        campaignId: delivery.campaignId || null,
        type: EmailEventType.OPENED,
        occurredAt: now,
        metadata: {
          userAgent: metadata?.userAgent ? metadata.userAgent.substring(0, 255) : null,
          isPrefetch
        },
        dedupeKey
      });

      // Update aggregate counts on delivery record
      await EmailDeliveryModel.updateOne(
        { _id: delivery._id },
        {
          $inc: { openCount: 1 },
          $set: {
            lastOpenedAt: now,
            ...(delivery.firstOpenedAt ? {} : { firstOpenedAt: now })
          }
        }
      );

      logger.info(
        {
          deliveryId: delivery._id.toString(),
          contactId: delivery.contactId,
          campaignId: delivery.campaignId,
          isPrefetch
        },
        'Recorded email OPENED event'
      );
    } catch (err: any) {
      // Never throw on tracking pixel endpoint; always return image
      logger.warn({ err: err.message, token }, 'Failed to record email open event');
    }

    return TRANSPARENT_1X1_GIF;
  }

  /**
   * Processes a public click-tracking redirect request.
   * Resolves the server-stored destination URL for the opaque token.
   * Returns destination URL for HTTP 302 redirect, or null if invalid.
   */
  public static async handleClick(
    token: string,
    metadata?: { userAgent?: string | undefined; ip?: string | undefined }
  ): Promise<string | null> {
    if (!token || typeof token !== 'string' || token.length < 16) {
      return null;
    }

    try {
      const delivery = await EmailDeliveryModel.findOne({
        'clickTrackingTokens.token': token
      });
      if (!delivery || !Array.isArray(delivery.clickTrackingTokens)) {
        return null;
      }

      const match = delivery.clickTrackingTokens.find((t) => t.token === token);
      if (!match || !match.targetUrl) {
        return null;
      }

      const targetUrl = match.targetUrl.trim();

      // Open redirect prevention: only allow http or https destinations
      if (!/^https?:\/\//i.test(targetUrl)) {
        logger.warn({ token, targetUrl }, 'Blocked redirect to non-http(s) scheme');
        return null;
      }

      const now = new Date();
      // Deduplicate clicks within a 10-second window
      const bucket = Math.floor(now.getTime() / 10000);
      const dedupeKey = `click_${token}_${bucket}`;

      const eventRepo = new EmailEventRepository(delivery.workspaceId);
      await eventRepo.recordEvent({
        deliveryId: delivery._id.toString(),
        contactId: delivery.contactId,
        campaignId: delivery.campaignId || null,
        type: EmailEventType.CLICKED,
        occurredAt: now,
        metadata: {
          token,
          targetUrl,
          userAgent: metadata?.userAgent ? metadata.userAgent.substring(0, 255) : null
        },
        dedupeKey
      });

      // Update aggregate counts on delivery record
      await EmailDeliveryModel.updateOne(
        { _id: delivery._id },
        {
          $inc: { clickCount: 1 },
          $set: {
            lastClickedAt: now,
            ...(delivery.firstClickedAt ? {} : { firstClickedAt: now })
          }
        }
      );

      logger.info(
        {
          deliveryId: delivery._id.toString(),
          targetUrl,
          contactId: delivery.contactId
        },
        'Recorded email CLICKED event and authorized redirect'
      );

      return targetUrl;
    } catch (err: any) {
      logger.warn({ err: err.message, token }, 'Failed to record email click event');
      return null;
    }
  }
}
