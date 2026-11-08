// Colour tokens lifted from the Readr Figma Make design.

export type ReadingStyle = "light" | "sepia" | "dark" | "paper";
export type ReadingFont = "georgia" | "literata" | "source";
export type FocusMode = "off" | "article" | "sentence" | "line";
export type ViewMode = "original" | "interlinear" | "bilingual" | "translation";

export interface ReadingTokens {
  bg: string;
  text: string;
  secondary: string;
  border: string;
  sentenceHover: string;
  activeSentence: string;
}

export const readingTokens: Record<ReadingStyle, ReadingTokens> = {
  light: { bg: "#FAFAF7", text: "#1C1B18", secondary: "#6B6963", border: "#E8E6E0", sentenceHover: "rgba(184,169,138,0.10)", activeSentence: "rgba(201,160,96,0.20)" },
  sepia: { bg: "#F5EFE0", text: "#3A2F1E", secondary: "#7A6A4F", border: "#DED3BE", sentenceHover: "rgba(184,129,58,0.10)", activeSentence: "rgba(184,129,58,0.22)" },
  dark: { bg: "#2A2825", text: "#E8E6E0", secondary: "#A8A6A0", border: "#3E3C38", sentenceHover: "rgba(212,168,83,0.10)", activeSentence: "rgba(212,168,83,0.22)" },
  paper: { bg: "#F9F6EF", text: "#2E2C28", secondary: "#6B6963", border: "#E2DDD4", sentenceHover: "rgba(184,152,96,0.10)", activeSentence: "rgba(184,152,96,0.22)" },
};

export interface ChromeTokens {
  panel: string;
  border: string;
  text: string;
  body: string;
  muted: string;
  faint: string;
  hover: string;
  selected: string;
  accent: string;
  accentSoft: string;
  popup: string;
  popupHeader: string;
  chip: string;
}

const lightChrome: ChromeTokens = {
  panel: "#F2F0EB",
  border: "#E5E2D9",
  text: "#1C1B18",
  body: "#6B6963",
  muted: "#9E9C97",
  faint: "#C5C3BC",
  hover: "rgba(0,0,0,0.03)",
  selected: "rgba(0,0,0,0.06)",
  accent: "#B8A98A",
  accentSoft: "rgba(184,169,138,0.1)",
  popup: "#FEFDF8",
  popupHeader: "#FAF9F5",
  chip: "#F0EDE4",
};

const darkChrome: ChromeTokens = {
  panel: "#1E1D1A",
  border: "#3E3C38",
  text: "#E8E6E0",
  body: "#A8A6A0",
  muted: "#6B6963",
  faint: "#4A4844",
  hover: "rgba(255,255,255,0.04)",
  selected: "rgba(255,255,255,0.07)",
  accent: "#B8A98A",
  accentSoft: "rgba(184,169,138,0.14)",
  popup: "#2F2D29",
  popupHeader: "#272522",
  chip: "#3A3833",
};

export const chromeTokens = (style: ReadingStyle): ChromeTokens => (style === "dark" ? darkChrome : lightChrome);

export const fontFamilyMap: Record<ReadingFont, string> = {
  georgia: "Georgia, 'Times New Roman', serif",
  literata: "'Literata', Georgia, serif",
  source: "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
};

export const UI_FONT = "'Inter', system-ui, sans-serif";
export const ARABIC_FONT = "'Noto Naskh Arabic', Georgia, serif";
