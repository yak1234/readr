import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChromeTokens, ReadingTokens, UI_FONT } from "../lib/theme";

interface Props {
  c: ChromeTokens;
  tokens: ReadingTokens;
  /** What went wrong, for the curious (it is also in the log). */
  message: string;
  /** Runs the upgrade again; resolves when it has finished either way. */
  onRetry: () => Promise<void>;
  onShowFolder: () => void;
}

/** Shown instead of the app when the library couldn't be moved into the database. */
export function UpgradeFailed({ c, tokens, message, onRetry, onShowFolder }: Props) {
  const { t } = useTranslation();
  const [trying, setTrying] = useState(false);
  const retry = () => {
    setTrying(true);
    onRetry().finally(() => setTrying(false));
  };
  const button = (primary: boolean): React.CSSProperties => ({
    padding: "7px 14px",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: UI_FONT,
    cursor: "pointer",
    border: `1px solid ${primary ? tokens.text : c.border}`,
    background: primary ? tokens.text : "transparent",
    color: primary ? tokens.bg : c.text,
  });
  return (
    <div data-upgrade-failed style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: tokens.bg, fontFamily: UI_FONT }}>
      <div style={{ maxWidth: 420, padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: c.text, margin: "0 0 10px" }}>{t("upgrade.title")}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: c.body, margin: "0 0 20px" }}>{t("upgrade.body")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button data-upgrade-retry disabled={trying} onClick={retry} style={{ ...button(true), opacity: trying ? 0.6 : 1 }}>
            {t("upgrade.tryAgain")}
          </button>
          <button data-upgrade-folder onClick={onShowFolder} style={button(false)}>
            {t("upgrade.showFolder")}
          </button>
        </div>
        {message && <p style={{ fontSize: 11, color: c.muted, margin: "20px 0 0", wordBreak: "break-word" }}>{message}</p>}
      </div>
    </div>
  );
}
