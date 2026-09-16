import { z } from 'zod';
import { entityIdField, entityIdFieldNullable } from '../fields/common.js';
import { emailAttachmentMetaSchema } from './delivery.js';

/**
 * Input definition for template reference in outbound message composition.
 */
export const composeTemplateInputSchema = z.object({
  id: entityIdFieldNullable.optional(),
  version: z.number().int().positive().nullable().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  attachments: z.array(z.any()).optional()
});
export type ComposeTemplateInput = z.infer<typeof composeTemplateInputSchema>;

/**
 * Canonical input schema for composeOutboundMessage.
 */
export const composeMessageInputSchema = z.object({
  workspaceId: entityIdField,
  template: composeTemplateInputSchema.optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  context: z.record(z.any()),
  sender: z.object({
    name: z.string().optional(),
    email: z.string().email(),
    signatureHtml: z.string().nullable().optional()
  }),
  recipient: z.object({
    email: z.string().email(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional()
  }),
  attachments: z.array(z.any()).optional(),
  isHtml: z.boolean().optional(),
  useSignature: z.boolean().optional(),
  trackingBaseUrl: z.string().optional(),
  trackingEnabled: z.boolean().optional(),
  existingTracking: z
    .object({
      openTrackingToken: z.string().nullable().optional(),
      clickTrackingTokens: z
        .array(
          z.object({
            token: z.string(),
            targetUrl: z.string()
          })
        )
        .optional()
    })
    .optional()
});
export type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;

/**
 * Result returned by the canonical composeOutboundMessage engine.
 */
export const composeMessageResultSchema = z.object({
  subject: z.string().min(1),
  htmlBody: z.string(),
  textBody: z.string(),
  variablesSnapshot: z.record(z.string()),
  openTrackingToken: z.string(),
  clickTrackingTokens: z.array(
    z.object({
      token: z.string(),
      targetUrl: z.string()
    })
  ),
  attachments: z.array(z.any()),
  messageFingerprint: z.string(),
  templateId: entityIdFieldNullable.optional(),
  templateVersion: z.number().int().positive().nullable().optional()
});
export type ComposeMessageResult = z.infer<typeof composeMessageResultSchema>;
