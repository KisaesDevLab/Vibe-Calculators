import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server.js";
import type { HealthDependencies } from "./health.js";

function makeDeps(overrides: Partial<HealthDependencies> = {}): HealthDependencies {
  return {
    pingDb: overrides.pingDb ?? vi.fn().mockResolvedValue({ connected: true }),
    pingRedis: overrides.pingRedis ?? vi.fn().mockResolvedValue({ connected: true }),
    getVersion:
      overrides.getVersion ?? vi.fn().mockReturnValue({ version: "0.0.0", gitSha: "abcdef1" }),
  };
}

describe("GET /api/health", () => {
  it("returns the documented response shape when DB and Redis are up", async () => {
    const app = createApp({ health: makeDeps() });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      version: "0.0.0",
      gitSha: "abcdef1",
      dbConnected: true,
      redisConnected: true,
    });
  });

  it("returns 503 with degraded status when the database is down", async () => {
    const app = createApp({
      health: makeDeps({
        pingDb: vi.fn().mockResolvedValue({ connected: false, error: "ECONNREFUSED" }),
      }),
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.dbConnected).toBe(false);
    expect(res.body.redisConnected).toBe(true);
  });

  it("returns 503 when Redis is down", async () => {
    const app = createApp({
      health: makeDeps({
        pingRedis: vi.fn().mockResolvedValue({ connected: false, error: "timeout" }),
      }),
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.redisConnected).toBe(false);
  });

  it("includes the application/json content type", async () => {
    const app = createApp({ health: makeDeps() });
    const res = await request(app).get("/api/health");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
