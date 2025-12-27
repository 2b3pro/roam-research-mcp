/**
 * Shared validation functions for Roam MCP tools.
 * Provides consistent validation across all write operations.
 */

// Regex to match UID placeholders like {{uid:parent1}}, {{uid:section-a}}, etc.
const UID_PLACEHOLDER_REGEX = /^\{\{uid:[^}]+\}\}$/;

export interface ValidationError {
  actionIndex?: number;
  field: string;
  message: string;
  expected?: string;
  received?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates a block string content.
 * @param str The string to validate
 * @param allowEmpty If true, allows empty strings (for intentional blank blocks)
 * @returns Error message if invalid, null if valid
 */
export function validateBlockString(str: string | undefined | null, allowEmpty = false): string | null {
  if (str === undefined || str === null) {
    return 'string is required';
  }
  // Only reject truly empty strings '', not whitespace-only strings like ' '
  // Whitespace-only strings are valid in Roam (e.g., empty table cells)
  if (!allowEmpty && typeof str === 'string' && str === '') {
    return 'string cannot be empty (use " " for intentional whitespace)';
  }
  return null;
}

/**
 * Validates a Roam UID.
 * UIDs must be either:
 * - 9 alphanumeric characters (standard Roam UID)
 * - A placeholder like {{uid:name}}
 * @param uid The UID to validate
 * @param required If true, UID is required
 * @returns Error message if invalid, null if valid
 */
export function validateUid(uid: string | undefined | null, required = true): string | null {
  if (!uid) {
    return required ? 'uid is required' : null;
  }

  // Check if it's a placeholder
  if (UID_PLACEHOLDER_REGEX.test(uid)) {
    return null;
  }

  // Check if it's a valid Roam UID (9 alphanumeric characters)
  if (!/^[a-zA-Z0-9_-]{9}$/.test(uid)) {
    return 'uid must be 9 alphanumeric characters or a {{uid:name}} placeholder';
  }

  return null;
}

/**
 * Validates an outline level.
 * @param level The level to validate
 * @returns Error message if invalid, null if valid
 */
export function validateOutlineLevel(level: number | undefined | null): string | null {
  if (level === undefined || level === null) {
    return 'level is required';
  }
  if (!Number.isInteger(level) || level < 1 || level > 10) {
    return 'level must be an integer between 1 and 10';
  }
  return null;
}

/**
 * Validates a location object for block creation/movement.
 * @param location The location object to validate
 * @returns Error message if invalid, null if valid
 */
export function validateLocation(location: { 'parent-uid'?: string; order?: number | string } | undefined | null): string | null {
  if (!location) {
    return 'location is required';
  }
  if (!location['parent-uid']) {
    return 'location.parent-uid is required';
  }

  const uidError = validateUid(location['parent-uid'], true);
  if (uidError) {
    return `location.parent-uid: ${uidError}`;
  }

  return null;
}

/**
 * Validates a heading level.
 * @param heading The heading level to validate
 * @returns Error message if invalid, null if valid
 */
export function validateHeading(heading: number | undefined | null): string | null {
  if (heading === undefined || heading === null || heading === 0) {
    return null; // Heading is optional
  }
  if (!Number.isInteger(heading) || heading < 1 || heading > 3) {
    return 'heading must be 1, 2, or 3';
  }
  return null;
}

export type BatchAction = {
  action: 'create-block' | 'update-block' | 'move-block' | 'delete-block';
  uid?: string;
  string?: string;
  location?: { 'parent-uid'?: string; order?: number | string };
  heading?: number;
  open?: boolean;
  'text-align'?: string;
  'children-view-type'?: string;
};

/**
 * Validates all batch actions before execution.
 * @param actions Array of batch actions to validate
 * @returns ValidationResult with errors if any
 */
export function validateBatchActions(actions: BatchAction[]): ValidationResult {
  const errors: ValidationError[] = [];

  if (!Array.isArray(actions)) {
    errors.push({
      field: 'actions',
      message: 'actions must be an array'
    });
    return { valid: false, errors };
  }

  if (actions.length === 0) {
    errors.push({
      field: 'actions',
      message: 'actions array cannot be empty'
    });
    return { valid: false, errors };
  }

  // Track defined placeholders for forward-reference validation
  const definedPlaceholders = new Set<string>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    // Validate action type
    if (!action.action) {
      errors.push({
        actionIndex: i,
        field: 'action',
        message: 'action type is required',
        expected: 'create-block | update-block | move-block | delete-block'
      });
      continue;
    }

    const validActions = ['create-block', 'update-block', 'move-block', 'delete-block'];
    if (!validActions.includes(action.action)) {
      errors.push({
        actionIndex: i,
        field: 'action',
        message: `invalid action type: ${action.action}`,
        expected: 'create-block | update-block | move-block | delete-block',
        received: action.action
      });
      continue;
    }

    // Track placeholder definitions
    if (action.uid && UID_PLACEHOLDER_REGEX.test(action.uid)) {
      const placeholderMatch = action.uid.match(/\{\{uid:([^}]+)\}\}/);
      if (placeholderMatch) {
        definedPlaceholders.add(placeholderMatch[1]);
      }
    }

    // Validate based on action type
    switch (action.action) {
      case 'create-block': {
        // create-block requires string and location
        const stringError = validateBlockString(action.string);
        if (stringError) {
          errors.push({
            actionIndex: i,
            field: 'string',
            message: stringError
          });
        }

        const locationError = validateLocation(action.location);
        if (locationError) {
          errors.push({
            actionIndex: i,
            field: 'location',
            message: locationError
          });
        }

        // Check for forward-reference to undefined placeholder
        if (action.location?.['parent-uid']) {
          const parentUid = action.location['parent-uid'];
          const placeholderMatch = parentUid.match(/\{\{uid:([^}]+)\}\}/);
          if (placeholderMatch && !definedPlaceholders.has(placeholderMatch[1])) {
            errors.push({
              actionIndex: i,
              field: 'location.parent-uid',
              message: `Placeholder {{uid:${placeholderMatch[1]}}} referenced before definition`
            });
          }
        }

        const headingError = validateHeading(action.heading);
        if (headingError) {
          errors.push({
            actionIndex: i,
            field: 'heading',
            message: headingError
          });
        }
        break;
      }

      case 'update-block': {
        // update-block requires uid
        const uidError = validateUid(action.uid);
        if (uidError) {
          errors.push({
            actionIndex: i,
            field: 'uid',
            message: uidError
          });
        }

        // string is optional for update but if provided, validate it
        if (action.string !== undefined) {
          const stringError = validateBlockString(action.string);
          if (stringError) {
            errors.push({
              actionIndex: i,
              field: 'string',
              message: stringError
            });
          }
        }

        const headingError = validateHeading(action.heading);
        if (headingError) {
          errors.push({
            actionIndex: i,
            field: 'heading',
            message: headingError
          });
        }
        break;
      }

      case 'move-block': {
        // move-block requires uid and location
        const uidError = validateUid(action.uid);
        if (uidError) {
          errors.push({
            actionIndex: i,
            field: 'uid',
            message: uidError
          });
        }

        const locationError = validateLocation(action.location);
        if (locationError) {
          errors.push({
            actionIndex: i,
            field: 'location',
            message: locationError
          });
        }
        break;
      }

      case 'delete-block': {
        // delete-block requires uid
        const uidError = validateUid(action.uid);
        if (uidError) {
          errors.push({
            actionIndex: i,
            field: 'uid',
            message: uidError
          });
        }
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Formats validation errors into a human-readable string.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map(err => {
      const prefix = err.actionIndex !== undefined ? `Action ${err.actionIndex}: ` : '';
      return `${prefix}[${err.field}] ${err.message}`;
    })
    .join('; ');
}
