import {
  CHECKOUT_ROW_CLASS,
  CHECKOUT_WARNING_CLASS,
  checkoutWarningLabel,
  daysSinceCheckout,
  getCheckoutWarningLevel,
} from "@/lib/stock";
import { formatDay } from "@/lib/dates";

// The single rendering of a checked-out piece's since-date (SLT-57). Used by the Admin
// dashboard's "Who has what" (SLT-38), the Formulator dashboard's "Currently with you"
// (SLT-40) and the Formulator's My Checkouts page (SLT-30).
//
// One component rather than three copies of the same conditional: the brief is that the
// same piece shows the same colour everywhere, and the only way to guarantee that is for
// there to be one place where the colour is decided.
export function CheckoutSince({
  checkedOutAt,
  className = "",
}: {
  checkedOutAt: Date | null;
  className?: string;
}) {
  const level = getCheckoutWarningLevel(checkedOutAt);
  const label = checkoutWarningLabel(level, daysSinceCheckout(checkedOutAt));

  return (
    <span className={`text-caption ${CHECKOUT_WARNING_CLASS[level]} ${className}`.trim()}>
      since {checkedOutAt ? formatDay(checkedOutAt) : "—"}
      {label ? ` · ${label}` : ""}
    </span>
  );
}

// The whole row is tinted, not just the date — an overdue piece should be findable by
// scanning a list, which a coloured word at the end of a line isn't. Exported alongside
// the component so both halves of the same signal are decided in one module.
export function checkoutRowClass(checkedOutAt: Date | null): string {
  return CHECKOUT_ROW_CLASS[getCheckoutWarningLevel(checkedOutAt)];
}
