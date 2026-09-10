import Decimal from "decimal.js";

Decimal.set({ precision: 28 });

export { Decimal };
export type Money = Decimal;

export type RoundingModeName = "HALF_UP" | "FLOOR" | "CEIL";

export function D(v: Decimal.Value | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v as Decimal.Value);
}

export function roundMoney(v: Decimal, precision: number, mode: RoundingModeName): Decimal {
  const rm = mode === "FLOOR" ? Decimal.ROUND_FLOOR : mode === "CEIL" ? Decimal.ROUND_CEIL : Decimal.ROUND_HALF_UP;
  return v.toDecimalPlaces(precision, rm);
}

export function formatMoney(v: Decimal.Value | null | undefined, currency = "PKR", fractionDigits = 0): string {
  const n = D(v).toNumber();
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: Math.max(fractionDigits, 2),
  })
    .format(n)
    .replace(/^([A-Z]{3})\s?/, "$1 ");
}

export function formatNumber(v: Decimal.Value | null | undefined, digits = 2): string {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(D(v).toNumber());
}
