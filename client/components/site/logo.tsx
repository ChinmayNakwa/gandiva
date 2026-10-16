import { cn } from "cn";

/** Gandiva bow-and-arrow mark: a drawn bow, taut string and a loosed arrow. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-6", className)}
    >
      <path d="M7.5 3.2C15.5 6.2 15.5 17.8 7.5 20.8" />
      <path d="M7.5 3.2V20.8" />
      <path d="M2.5 12h17" />
      <path d="M15.5 8 20.8 12 15.5 16" />
    </svg>
  );
}

export function LogoLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-5 text-primary" />
      <span className="font-heading text-base font-semibold tracking-tight">
        Gandiva
      </span>
    </span>
  );
}
