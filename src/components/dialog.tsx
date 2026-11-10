// The app's modal: a card over a dimmed page, with a title (and an optional line under it), opened by its own
// trigger button. Radix does the focus trap, Escape, the return of focus to the trigger and the screen-reader
// roles; this sets the look.

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useReadrSettings } from "../shell/settings-provider";

type Attributes = { [key in `data-${string}`]?: string | boolean };

interface Props extends Attributes {
  /** The button that opens it (it gets the focus back when the dialog closes). */
  trigger: React.ReactElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A line under the title. */
  intro?: string;
  width?: number;
  /** To keep the focus from going back to the trigger (the dialog closed because the app went elsewhere). */
  onCloseAutoFocus?: (event: Event) => void;
  children: React.ReactNode;
}

export function Dialog({ trigger, open, onOpenChange, title, intro, width = 420, onCloseAutoFocus, children, ...attributes }: Props) {
  const { c } = useReadrSettings();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.12)" }} />
        <DialogPrimitive.Content
          {...attributes}
          onCloseAutoFocus={onCloseAutoFocus}
          // Without an intro there is nothing to describe the dialog by (Radix would warn).
          {...(intro ? {} : { "aria-describedby": undefined })}
          style={{
            position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width, maxWidth: "calc(100vw - 32px)", maxHeight: "78vh",
            display: "flex", flexDirection: "column", background: c.popup, border: `1px solid ${c.border}`, borderRadius: 10,
            boxShadow: "0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)", zIndex: 100, fontFamily: "'Inter', system-ui, sans-serif", overflow: "hidden", outline: "none",
          }}
        >
          <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${c.border}`, background: c.popupHeader }}>
            <DialogPrimitive.Title style={{ margin: 0, fontSize: 18, fontWeight: 600, color: c.text, fontFamily: "Georgia, serif", lineHeight: 1.3 }}>{title}</DialogPrimitive.Title>
            {intro ? (
              <DialogPrimitive.Description style={{ margin: "2px 0 0", fontSize: 11, color: c.muted, lineHeight: 1.45 }}>{intro}</DialogPrimitive.Description>
            ) : null}
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
