import type { PaymentPricing } from "@/types/forms";

function additionalAdults(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return 0;
}

export function getPayingAdultCount(
  pricing: PaymentPricing,
  values: Record<string, unknown>
): number {
  const includeRegistrant = pricing.includeRegistrant !== false;
  const isBringing =
    !pricing.bringingField ||
    values[pricing.bringingField] === (pricing.bringingYesValue ?? "yes");
  const extra = isBringing
    ? additionalAdults(values[pricing.additionalAdultsField])
    : 0;
  return (includeRegistrant ? 1 : 0) + extra;
}

export function getPayableAmount(
  pricing: PaymentPricing,
  values: Record<string, unknown>
): number {
  return getPayingAdultCount(pricing, values) * pricing.adultFee;
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}
