import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";
const variants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-emerald-800 text-white hover:bg-emerald-900",
        outline:
          "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
        ghost: "text-stone-500 hover:bg-stone-100",
        destructive: "bg-red-50 text-red-700 hover:bg-red-100",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(variants({ variant, size, className }))} {...props} />
  );
}
