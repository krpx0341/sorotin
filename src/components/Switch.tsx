"use client";

/** Emerald toggle switch shared by Settings and the home options panel. */
export function Switch({
  checked,
  disabled,
  onChange,
  label,
  size = "md",
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex shrink-0 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40 ${
        sm ? "h-6 w-10" : "h-7 w-12"
      } ${checked ? "border-emerald-300/50 bg-emerald-400" : "border-white/10 bg-white/10"}`}
    >
      <span
        className={`inline-block rounded-full shadow-md transition ${sm ? "h-4 w-4" : "h-5 w-5"} ${
          checked ? `${sm ? "translate-x-5" : "translate-x-6"} bg-[#04241a]` : "translate-x-1 bg-zinc-300"
        }`}
      />
    </button>
  );
}
