// Small UI primitives from the design (switch, slider, section headers).

import React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ChromeTokens } from "../lib/theme";

export function Switch({ checked, onCheckedChange, c }: { checked: boolean; onCheckedChange: (v: boolean) => void; c: ChromeTokens }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      style={{
        width: 30,
        height: 17,
        borderRadius: 999,
        border: "none",
        padding: 2,
        background: checked ? c.text : c.border,
        cursor: "pointer",
        transition: "background 0.15s",
        flexShrink: 0,
      }}
    >
      <SwitchPrimitive.Thumb
        style={{
          display: "block",
          width: 13,
          height: 13,
          borderRadius: 999,
          background: c.panel === "#1E1D1A" && checked ? "#1E1D1A" : "#FFFFFF",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          transform: checked ? "translateX(13px)" : "translateX(0)",
          transition: "transform 0.15s",
        }}
      />
    </SwitchPrimitive.Root>
  );
}

export function Slider({ value, onChange, min, max, step, c }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; c: ChromeTokens }) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      min={min}
      max={max}
      step={step}
      style={{ position: "relative", display: "flex", alignItems: "center", flex: 1, height: 16, userSelect: "none", touchAction: "none" }}
    >
      <SliderPrimitive.Track style={{ position: "relative", flex: 1, height: 3, borderRadius: 2, background: c.border }}>
        <SliderPrimitive.Range style={{ position: "absolute", height: "100%", borderRadius: 2, background: c.accent }} />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label="Text size"
        style={{ display: "block", width: 12, height: 12, borderRadius: 999, background: c.text, boxShadow: "0 1px 3px rgba(0,0,0,0.25)", cursor: "grab" }}
      />
    </SliderPrimitive.Root>
  );
}

export function SectionLabel({ children, c }: { children: React.ReactNode; c: ChromeTokens }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: c.muted, textTransform: "uppercase", marginBottom: 8 }}>
      {children}
    </div>
  );
}

export function Divider({ c }: { c: ChromeTokens }) {
  return <div style={{ height: 1, background: c.border, margin: "14px 0" }} />;
}

export function ChipButton({
  active,
  onClick,
  children,
  c,
  style,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  c: ChromeTokens;
  style?: React.CSSProperties;
  title?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        padding: "5px 6px",
        borderRadius: 5,
        border: active ? `1.5px solid ${c.accent}` : `1.5px solid ${c.border}`,
        background: active ? c.accentSoft : "transparent",
        fontSize: 11,
        color: active ? c.text : c.body,
        cursor: "pointer",
        textAlign: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
