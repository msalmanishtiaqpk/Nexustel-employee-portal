"use client";
import * as React from "react";
import { X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-display text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** A button that opens a dialog containing `children` (usually an ActionForm). */
export function DialogButton({ title, label, children, wide, ...btn }: ButtonProps & { title: string; label?: React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); wide?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} {...btn}>{label ?? title}</Button>
      <Dialog open={open} onClose={close} title={title} wide={wide}>
        {typeof children === "function" ? children(close) : children}
      </Dialog>
    </>
  );
}
