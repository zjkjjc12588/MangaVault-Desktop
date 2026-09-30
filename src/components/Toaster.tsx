import * as Toast from "@radix-ui/react-toast";
import { CheckCircle, Info, XCircle } from "lucide-react";
import { useToastStore, type ToastTone } from "../stores/toastStore";
import { cn } from "../lib/cn";

const icons: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle,
  error: XCircle,
};

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <Toast.Provider swipeDirection="right" duration={4200}>
      {toasts.map((toast) => {
        const Icon = icons[toast.tone];
        return (
          <Toast.Root
            key={toast.id}
            className={cn(
              "grid w-[360px] grid-cols-[auto_1fr] gap-x-3 rounded-lg border bg-panel p-4 shadow-2xl",
              toast.tone === "error" ? "border-danger/60" : "border-border",
            )}
            onOpenChange={(open) => {
              if (!open) dismiss(toast.id);
            }}
          >
            <Icon
              size={18}
              className={toast.tone === "error" ? "mt-0.5 text-danger" : "mt-0.5 text-accent"}
            />
            <div className="min-w-0">
              <Toast.Title className="text-sm font-semibold">{toast.title}</Toast.Title>
              {toast.description && (
                <Toast.Description className="mt-1 text-xs leading-5 text-foreground/65">
                  {toast.description}
                </Toast.Description>
              )}
            </div>
          </Toast.Root>
        );
      })}
      <Toast.Viewport className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 outline-none" />
    </Toast.Provider>
  );
}
