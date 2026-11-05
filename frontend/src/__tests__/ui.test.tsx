import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Empty, ErrorBox, Origin } from "../components/ui";

describe("data-origin labels", () => {
  it("labels simulated, live, manual and unavailable data distinctly", () => {
    render(<div><Origin kind="simulated" /><Origin kind="live_forecast" /><Origin kind="manual+scenario" /><Origin kind="unavailable" /></div>);
    expect(screen.getByText("SIMULATED")).toBeTruthy();
    expect(screen.getByText("LIVE FORECAST")).toBeTruthy();
    expect(screen.getByText("MANUAL + SCENARIO")).toBeTruthy();
    expect(screen.getByText("DATA UNAVAILABLE")).toBeTruthy();
  });
  it("renders empty states and errors", () => {
    render(<div><Empty title="No batches registered">Register one</Empty><ErrorBox error={{ message: "Route information unavailable" }} /></div>);
    expect(screen.getByText("No batches registered")).toBeTruthy();
    expect(screen.getByText("Route information unavailable")).toBeTruthy();
  });
});
