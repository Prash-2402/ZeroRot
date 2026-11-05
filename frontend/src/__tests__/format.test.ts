import { describe, expect, it } from "vitest";
import { days, inr, kg, num, qualityColor, tempColor } from "../lib/format";

describe("format helpers", () => {
  it("formats rupees in Indian grouping and never invents a value", () => {
    expect(inr(123456)).toBe("₹1,23,456");
    expect(inr(-500)).toBe("−₹500");
    expect(inr(null)).toBe("—");
    expect(inr(NaN)).toBe("—");
  });
  it("formats numbers, weights and durations", () => {
    expect(num(12.345, 2)).toBe("12.35");
    expect(num(undefined)).toBe("—");
    expect(kg(500)).toBe("500 kg");
    expect(kg(2500)).toBe("2.50 t");
    expect(days(0.5)).toBe("12 h");
    expect(days(null)).toBe("> 30 d");
  });
  it("maps temperature deviation to the semantic scale (blue → red)", () => {
    expect(tempColor(10, 13)).toBe("#2F80ED");
    expect(tempColor(13.5, 13)).toBe("#7FC4FF");
    expect(tempColor(15.5, 13)).toBe("#FFC900");
    expect(tempColor(17.5, 13)).toBe("#F2994A");
    expect(tempColor(25, 13)).toBe("#EB4D3D");
  });
  it("maps quality to colour bands", () => {
    expect(qualityColor(90)).toBe("#5FB37C");
    expect(qualityColor(30)).toBe("#EB4D3D");
  });
});
