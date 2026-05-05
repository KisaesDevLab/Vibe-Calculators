import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type Database } from "@vibe-calc/db";
import { createFirstAdmin, isUsersTableEmpty, verifyBootstrapToken } from "../lib/bootstrap.js";
import { createSession } from "../lib/sessions.js";
import { setSessionCookie } from "../lib/cookies.js";
import { permissionsFor } from "@vibe-calc/shared-types";
import { clientIp, problem } from "../middleware/auth.js";
import type { Env } from "../lib/env.js";

export interface SetupRouteDeps {
  db: Database;
  env: Pick<Env, "VIBE_DEPLOY_MODE">;
}

const setupBodySchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  email: z.string().email().toLowerCase(),
  name: z.string().min(1),
  password: z.string().min(12),
});

export function buildSetupRouter(deps: SetupRouteDeps): Router {
  const router = Router();

  router.get("/status", async (_req: Request, res: Response) => {
    const open = await isUsersTableEmpty(deps.db);
    res.json({ open });
  });

  router.post("/", async (req: Request, res: Response) => {
    const parsed = setupBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return problem(res, 400, "Bad request", "Invalid setup body");
    }
    const ok = await verifyBootstrapToken(deps.db, parsed.data.token);
    if (!ok) {
      return problem(res, 410, "Gone", "Setup is closed or token is invalid");
    }
    const result = await createFirstAdmin(deps.db, {
      email: parsed.data.email,
      name: parsed.data.name,
      password: parsed.data.password,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? undefined,
    });
    if (!result.ok) {
      if (result.reason === "policy") {
        return problem(
          res,
          422,
          "Password policy",
          result.policy?.ok === false ? result.policy.message : "",
        );
      }
      return problem(res, 410, "Gone", "Setup is closed");
    }

    const created = await createSession(deps.db, {
      userId: result.userId,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? undefined,
    });
    setSessionCookie(res, created.token, { deployMode: deps.env.VIBE_DEPLOY_MODE });
    res.status(201).json({
      user: {
        id: result.userId,
        email: parsed.data.email,
        name: parsed.data.name,
        role: "admin",
        permissions: permissionsFor("admin"),
      },
    });
  });

  return router;
}
