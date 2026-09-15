import { cn } from "@/lib/cn";

// Tables are primary UI here, not an afterthought (design.md). Hairline row dividers
// scan better than heavy borders in a dense list; rows get the "elevated" shadow tier
// only on hover, keeping the resting state flat per the base/elevated/floating system.

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden overflow-x-auto rounded-lg border border-neutral-dark/10 bg-neutral-light">
      <table className="w-full text-left text-body">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-neutral-dark/[0.03]">{children}</thead>;
}

export function TableHeaderCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 text-table-header text-neutral-dark/60", className)}>{children}</th>;
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-neutral-dark/8">{children}</tbody>;
}

export function TableRow({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "transition-[box-shadow,background-color] duration-150",
        onClick && "cursor-pointer hover:bg-neutral-dark/[0.02] hover:shadow-elevated",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TableCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2.5 text-neutral-dark", className)}>{children}</td>;
}

export function TableEmpty({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-body text-neutral-dark/50">
        {message}
      </td>
    </tr>
  );
}

export function TableSkeleton({ colSpan, rows = 3 }: { colSpan: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          <td colSpan={colSpan} className="px-4 py-3">
            <div className="h-4 w-full max-w-64 animate-pulse rounded bg-neutral-dark/8" />
          </td>
        </tr>
      ))}
    </>
  );
}
