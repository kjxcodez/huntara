import { z } from 'zod';

// Preprocessor: coerces empty strings to null before validation.
// Required because HTML form selects submit "" for unselected state,
// which would fail regex/email validators before .nullable() is evaluated.
const emptyToNull = (val: unknown) => {
  if (typeof val === 'string' && val.trim() === '') return null;
  return val;
};

export const entityIdField = z
  .string()
  .min(1, 'Entity ID is required')
  .max(128, 'Entity ID exceeds maximum length of 128 characters');

// Nullable variant that accepts empty strings (coerces them to null)
export const entityIdFieldNullable = z.preprocess(
  emptyToNull,
  z.string().max(128, 'Entity ID exceeds maximum length of 128 characters').nullable().optional()
);

/**
 * @deprecated Use entityIdField instead. BSON ObjectIds are prohibited; all HUNTARA IDs are canonical strings.
 */
export const objectIdField = entityIdField;

/**
 * @deprecated Use entityIdFieldNullable instead.
 */
export const objectIdFieldNullable = entityIdFieldNullable;


export const emailField = z.string().email({ message: 'Invalid email address' });

// Nullable variant that accepts empty strings (coerces them to null)
export const emailFieldNullable = z.preprocess(
  emptyToNull,
  z.string().email({ message: 'Invalid email address' }).nullable()
);

export const urlField = z.string().url({ message: 'Invalid URL format' }).nullable();

export const domainField = z.preprocess(
  (val) => {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (!trimmed) return '';
    try {
      const url = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./i, '');
    } catch {
      return trimmed;
    }
  },
  z
    .string()
    .regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/, {
      message: 'Invalid domain format'
    })
    .or(z.string().length(0))
    .nullable()
);

export const nameField = z.string().min(1, { message: 'Name must not be empty' }).max(100);

export const phoneField = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number' })
  .nullable();

// Nullable variant that accepts empty strings (coerces them to null)
export const phoneFieldNullable = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number' })
    .nullable()
);
