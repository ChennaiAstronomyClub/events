import { useState } from "react";
import { useFormContext } from "react-hook-form";
import type { FormFieldConfig, PaymentPricing } from "@/types/forms";
import {
  formatInr,
  getPayableAmount,
  getPayingAdultCount,
} from "@/lib/payment-amount";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Copy, Lock } from "lucide-react";

interface DynamicFieldProps {
  field: FormFieldConfig;
  readOnly: boolean;
  paymentPricing?: PaymentPricing;
}

export function DynamicField({ field, readOnly, paymentPricing }: DynamicFieldProps) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext();

  const error = errors[field.name];
  const value = watch(field.name);
  const bringingValue = watch(paymentPricing?.bringingField ?? field.name);
  const additionalAdultsValue = watch(
    paymentPricing?.additionalAdultsField ?? field.name
  );
  const [copied, setCopied] = useState(false);

  const showPayableAmount = Boolean(field.showPayableAmount && paymentPricing);
  const pricingValues: Record<string, unknown> = paymentPricing
    ? {
        ...(paymentPricing.bringingField
          ? { [paymentPricing.bringingField]: bringingValue }
          : {}),
        [paymentPricing.additionalAdultsField]: additionalAdultsValue,
      }
    : {};
  const payingAdults =
    showPayableAmount && paymentPricing
      ? getPayingAdultCount(paymentPricing, pricingValues)
      : 0;
  const payableAmount =
    showPayableAmount && paymentPricing
      ? getPayableAmount(paymentPricing, pricingValues)
      : 0;

  const baseClass = readOnly ? "bg-muted cursor-not-allowed" : "";

  async function copyHelperValue(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard may be unavailable
    }
  }

  return (
    <div className={`flex flex-col${field.fullWidth ? " col-span-full" : ""}`}>
      {field.type !== "checkbox" && (
        <Label htmlFor={field.name} className="mb-2 flex-1">
          <span>
            {field.label}
            {field.required && <span className="text-destructive"> *</span>}
          </span>
          {readOnly && <Lock className="h-3 w-3 text-muted-foreground" />}
        </Label>
      )}
      {field.type !== "checkbox" &&
        (field.helperText ||
          field.helperLinkUrl ||
          field.copyableValue ||
          field.helperImageUrl ||
          showPayableAmount) && (
        <div className="mb-3 space-y-2">
          {showPayableAmount && paymentPricing && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-sm font-semibold text-foreground">
                Amount to pay: {formatInr(payableAmount)}
              </p>
              <p className="text-xs text-muted-foreground">
                {payingAdults} adult{payingAdults === 1 ? "" : "s"} ×{" "}
                {formatInr(paymentPricing.adultFee)}. Kids under 16 are free.
              </p>
            </div>
          )}
          {(field.helperText || field.helperLinkUrl) && (
            <p className="text-xs text-muted-foreground">
              {field.helperText}
              {field.helperText && field.helperLinkUrl ? " " : ""}
              {field.helperLinkUrl && (
                <a
                  href={field.helperLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  {field.helperLinkLabel || "Open link"}
                </a>
              )}
            </p>
          )}
          {field.copyableValue && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground">
                {field.copyableLabel ?? "UPI ID"}:
              </span>
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {field.copyableValue}
              </code>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => copyHelperValue(field.copyableValue!)}
              >
                {copied ? (
                  <>
                    <Check />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy />
                    Copy
                  </>
                )}
              </Button>
            </div>
          )}
          {field.helperImageUrl && (
            <img
              src={field.helperImageUrl}
              alt={field.helperImageAlt || "Payment QR code"}
              className="mx-auto max-h-64 w-auto rounded-md border border-border bg-white p-2"
            />
          )}
        </div>
      )}

      {field.type === "textarea" ? (
        <Textarea
          id={field.name}
          placeholder={field.placeholder}
          readOnly={readOnly}
          className={baseClass}
          rows={4}
          {...register(field.name)}
        />
      ) : field.type === "select" ? (
        <Select
          value={value ?? ""}
          onValueChange={(v) => setValue(field.name, v, { shouldValidate: true })}
          disabled={readOnly}
        >
          <SelectTrigger id={field.name} className={baseClass}>
            <SelectValue placeholder={field.placeholder || "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "radio" ? (
        <div className="flex gap-4">
          {field.options?.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                value={opt.value}
                disabled={readOnly}
                {...register(field.name)}
                className="accent-primary"
              />
              {opt.label}
            </label>
          ))}
        </div>
      ) : field.type === "checkbox-group" ? (
        <div className="flex flex-col gap-2">
          {field.options?.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={opt.value}
                disabled={readOnly}
                checked={Array.isArray(value) && value.includes(opt.value)}
                onChange={(e) => {
                  const current: string[] = Array.isArray(value) ? value : [];
                  const next = e.target.checked
                    ? [...current, opt.value]
                    : current.filter((v: string) => v !== opt.value);
                  setValue(field.name, next, { shouldValidate: true });
                }}
                className="accent-primary"
              />
              {opt.label}
            </label>
          ))}
        </div>
      ) : field.type === "checkbox" ? (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            {...register(field.name)}
            disabled={readOnly}
            className="mt-1 accent-primary"
          />
          <span className="flex items-center gap-1.5">
            {field.label}
            {field.required && <span className="text-destructive">*</span>}
            {readOnly && <Lock className="h-3 w-3 text-muted-foreground" />}
          </span>
        </label>
      ) : field.type === "number" ? (
        <Input
          id={field.name}
          type="number"
          placeholder={field.placeholder}
          readOnly={readOnly}
          className={baseClass}
          min={field.validation?.min}
          max={field.validation?.max}
          value={
            typeof value === "number" && !Number.isNaN(value) && value !== 0
              ? String(value)
              : ""
          }
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              setValue(field.name, field.validation?.min === 0 ? 0 : undefined, {
                shouldValidate: true,
              });
              return;
            }
            const parsed = Number(raw);
            setValue(
              field.name,
              Number.isNaN(parsed)
                ? field.validation?.min === 0
                  ? 0
                  : undefined
                : parsed,
              { shouldValidate: true }
            );
          }}
        />
      ) : (
        <Input
          id={field.name}
          type={field.type}
          placeholder={field.placeholder}
          readOnly={readOnly}
          className={baseClass}
          {...register(field.name)}
        />
      )}

      {error && (
        <p className="mt-1 text-sm text-destructive">
          {error.message as string}
        </p>
      )}
    </div>
  );
}
