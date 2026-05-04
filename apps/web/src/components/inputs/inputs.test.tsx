import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MoneyInput, _internals as moneyInternals } from "./MoneyInput";
import { DateInput, _internals as dateInternals } from "./DateInput";
import { RateInput, _internals as rateInternals } from "./RateInput";
import { PeriodInput, _internals as periodInternals, type PeriodUnit } from "./PeriodInput";

// ---------------------------------------------------------------------
// MoneyInput
// ---------------------------------------------------------------------

describe("MoneyInput", () => {
  function Wrapper(): JSX.Element {
    const [v, setV] = useState("");
    const [u, setU] = useState(false);
    return (
      <MoneyInput
        value={v}
        onChange={setV}
        unknown={u}
        onUnknownToggle={() => setU((p) => !p)}
        data-testid="money"
      />
    );
  }

  it("parses '1.5K' as 1500.00", () => {
    expect(moneyInternals.parseInput("1.5K").decimal?.toFixed(2)).toBe("1500.00");
  });

  it("parses 'M' suffix", () => {
    expect(moneyInternals.parseInput("2.5M").decimal?.toFixed(2)).toBe("2500000.00");
  });

  it("treats parens as negative", () => {
    expect(moneyInternals.parseInput("(1,234.56)").decimal?.toFixed(2)).toBe("-1234.56");
  });

  it("strips commas", () => {
    expect(moneyInternals.parseInput("1,234,567.89").decimal?.toFixed(2)).toBe("1234567.89");
  });

  it("formats canonical with thousands separators", () => {
    expect(moneyInternals.formatForDisplay("1234567.89")).toBe("1,234,567.89");
  });

  it("formats negative with leading minus", () => {
    expect(moneyInternals.formatForDisplay("-1234.5")).toBe("-1,234.50");
  });

  it("emits canonical decimal string on user typing (no float)", () => {
    let last = "";
    const onChange = vi.fn((v: string) => {
      last = v;
    });
    render(<MoneyInput value="" onChange={onChange} />);
    const el = screen.getByRole("textbox");
    fireEvent.change(el, { target: { value: "1234.56" } });
    expect(onChange).toHaveBeenCalled();
    expect(last).toBe("1234.56");
  });

  it("'U' on empty input toggles unknown", () => {
    render(<Wrapper />);
    const el = screen.getByRole("textbox");
    fireEvent.keyDown(el, { key: "U" });
    expect(el).toHaveValue("U");
  });

  it("blur normalizes display", () => {
    function Local(): JSX.Element {
      const [v, setV] = useState("");
      return <MoneyInput value={v} onChange={setV} />;
    }
    render(<Local />);
    const el = screen.getByRole("textbox");
    fireEvent.change(el, { target: { value: "1234567" } });
    fireEvent.blur(el);
    expect(el).toHaveValue("1,234,567.00");
  });
});

// ---------------------------------------------------------------------
// DateInput
// ---------------------------------------------------------------------

describe("DateInput", () => {
  it("parses compact 6-digit '010125' as 2025-01-01", () => {
    const d = dateInternals.tryParseDisplay("010125");
    expect(d?.toISOString().slice(0, 10)).toBe("2025-01-01");
  });

  it("parses compact 8-digit '01012025'", () => {
    const d = dateInternals.tryParseDisplay("01012025");
    expect(d?.toISOString().slice(0, 10)).toBe("2025-01-01");
  });

  it("parses MM/DD/YYYY explicit", () => {
    const d = dateInternals.tryParseDisplay("12/31/2026");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("isoToDisplay round-trips", () => {
    expect(dateInternals.isoToDisplay("2025-01-01")).toBe("01/01/2025");
  });

  it("relative '+1m' adds a month to current value", () => {
    expect(
      dateInternals.tryRelative("+1m", new Date("2025-01-15"))?.toISOString().slice(0, 10),
    ).toBe("2025-02-15");
  });

  it("relative '-2y' subtracts two years", () => {
    expect(
      dateInternals.tryRelative("-2y", new Date("2025-01-15"))?.toISOString().slice(0, 10),
    ).toBe("2023-01-15");
  });

  it("ArrowUp on focused date increments by one day", () => {
    function Local(): JSX.Element {
      const [v, setV] = useState("2025-01-01");
      return <DateInput value={v} onChange={setV} />;
    }
    render(<Local />);
    const el = screen.getByRole("textbox");
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(el).toHaveValue("01/02/2025");
  });

  it("Shift+ArrowUp adjusts the month", () => {
    function Local(): JSX.Element {
      const [v, setV] = useState("2025-01-15");
      return <DateInput value={v} onChange={setV} />;
    }
    render(<Local />);
    const el = screen.getByRole("textbox");
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: "ArrowUp", shiftKey: true });
    expect(el).toHaveValue("02/15/2025");
  });

  it("Ctrl+ArrowDown adjusts the year", () => {
    function Local(): JSX.Element {
      const [v, setV] = useState("2025-01-15");
      return <DateInput value={v} onChange={setV} />;
    }
    render(<Local />);
    const el = screen.getByRole("textbox");
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: "ArrowDown", ctrlKey: true });
    expect(el).toHaveValue("01/15/2024");
  });
});

// ---------------------------------------------------------------------
// RateInput
// ---------------------------------------------------------------------

describe("RateInput", () => {
  it("parses '6.5' as 0.065 (canonical fraction)", () => {
    expect(rateInternals.parsePct("6.5")?.toFixed(6)).toBe("0.065000");
  });

  it("strips trailing %", () => {
    expect(rateInternals.parsePct("6.5%")?.toFixed(6)).toBe("0.065000");
  });

  it("formats canonical 0.065 as 6.500000% by default", () => {
    expect(rateInternals.formatPct("0.065", 6)).toBe("6.500000%");
  });

  it("emits canonical fraction on change", () => {
    function Local(): JSX.Element {
      const [v, setV] = useState("");
      return <RateInput value={v} onChange={setV} data-testid="rate" />;
    }
    render(<Local />);
    const el = screen.getByRole("textbox");
    fireEvent.change(el, { target: { value: "7.25%" } });
    fireEvent.blur(el);
    expect(el).toHaveValue("7.250000%");
  });
});

// ---------------------------------------------------------------------
// PeriodInput
// ---------------------------------------------------------------------

describe("PeriodInput", () => {
  it("parses '12y' as 144 months", () => {
    expect(periodInternals.parseInput("12y", "months").months).toBe(144);
    expect(periodInternals.parseInput("12y", "months").unitOverride).toBe("years");
  });

  it("parses '24m' as 24 months", () => {
    expect(periodInternals.parseInput("24m", "years").months).toBe(24);
    expect(periodInternals.parseInput("24m", "years").unitOverride).toBe("months");
  });

  it("respects current unit when no suffix", () => {
    expect(periodInternals.parseInput("5", "years").months).toBe(60);
    expect(periodInternals.parseInput("5", "months").months).toBe(5);
  });

  it("display shows years when divisible by 12 in years mode", () => {
    expect(periodInternals.valueForDisplay(144, "years")).toBe("12");
    expect(periodInternals.valueForDisplay(144, "months")).toBe("144");
  });

  it("renders and toggles unit via the side button", () => {
    function Local(): JSX.Element {
      const [v, setV] = useState<number | null>(360);
      const [u, setU] = useState<PeriodUnit>("months");
      return <PeriodInput value={v} onChange={setV} unit={u} onUnitChange={setU} />;
    }
    render(<Local />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("360");
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    expect(input).toHaveValue("30");
  });
});
