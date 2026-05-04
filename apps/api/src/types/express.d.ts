// Module augmentation for Express's Request to expose req.user and
// req.session populated by the auth middleware (Phase 2.12). This
// lives in a top-level .d.ts so the augmentation is picked up
// regardless of whether the augmenting middleware module has been
// imported in any given handler file.

import type { ApiKeyRow, SessionRow, UserRow } from "@vibe-calc/db";

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      session?: SessionRow;
      apiKey?: ApiKeyRow;
    }
  }
}

export {};
