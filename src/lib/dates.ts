// Formatting a Date as yyyy-mm-dd for display.
//
// Deliberately NOT toISOString().slice(0, 10), which converts to UTC first. Beesline runs
// at UTC+3, so a Date sitting at local midnight — which is what addWorkingDays() and every
// date-only field produce — is 21:00 the previous day in UTC, and the ISO string shows the
// wrong day. A supplier document due on Wednesday the 30th displayed as Tuesday the 29th,
// which is the sort of quiet off-by-one that makes an SLA argument unwinnable.
//
// The local getters read back exactly the parts the date was built from, so what is stored
// and what is shown agree.
export function formatDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
