import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export function Dialog({ open, onOpenChange, title, description, children }) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-40 bg-stone-950/40 backdrop-blur-sm" />
        <Primitive.Content className="dialog-content">
          <div className="mb-5">
            <Primitive.Title className="text-xl font-semibold text-stone-900">
              {title}
            </Primitive.Title>
            <Primitive.Description className="mt-2 text-sm text-stone-500">
              {description}
            </Primitive.Description>
          </div>
          <Primitive.Close
            className="absolute right-4 top-4 rounded-md p-1 text-stone-400 hover:bg-stone-100"
            aria-label="Close dialog"
          >
            <X size={18} />
          </Primitive.Close>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
