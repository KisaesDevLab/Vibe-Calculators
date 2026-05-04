import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HealthPage } from "./Health";

describe("HealthPage", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it("shows the loading state before the API responds", () => {
    fetchSpy.mockReturnValueOnce(new Promise(() => {}));
    render(<HealthPage />);
    expect(screen.getByText(/Checking API health/i)).toBeInTheDocument();
  });

  it("renders the status fields when /api/health succeeds", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        version: "0.0.0",
        gitSha: "abcdef1",
        dbConnected: true,
        redisConnected: true,
      }),
    });

    render(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByTestId("health-status")).toHaveTextContent("ok");
    });
    expect(screen.getByText("0.0.0")).toBeInTheDocument();
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
    expect(screen.getAllByText(/^connected$/i)).toHaveLength(2);
  });

  it("renders an error message when the API call fails", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    render(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByTestId("health-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("health-error")).toHaveTextContent(/API responded 503/);
  });
});
