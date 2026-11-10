// The language the whole app shows, chosen from the title bar: a menu of the languages that have something in
// them, each in its own name and direction, the current one checked, and "Add a language…" to pick another.
// A Radix dropdown menu: arrows, Enter and Escape work, typing jumps to a language, and the focus goes back to
// the button. The chrome stays English and left to right; only the language names are content.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { LANGUAGES, languageInfo } from "../../shared/languages";
import { languageScope } from "../lib/language-scope";
import { UI_FONT } from "../lib/theme";
import { useLanguage } from "./language-provider";
import { useReadrSettings } from "./settings-provider";

/** A language's own name, laid out in its own direction and script, isolated from the chrome around it. */
function NativeName({ lang }: { lang: string }) {
  const info = languageScope(lang);
  return (
    <span dir={info.dir} lang={lang} style={{ fontFamily: info.fontOver("inherit") }}>
      {info.native}
    </span>
  );
}

export function LanguageMenu() {
  const { t } = useTranslation();
  const { c } = useReadrSettings();
  const { lang, languages, changeLang } = useLanguage();
  const others = useMemo(
    () => Object.keys(LANGUAGES).filter((code) => !languages.includes(code)).sort((a, b) => languageInfo(a).name.localeCompare(languageInfo(b).name)),
    [languages],
  );
  if (!lang) return null;

  const surface = { fontFamily: UI_FONT, background: c.popup, border: `1px solid ${c.border}`, color: c.text, boxShadow: "0 6px 24px rgba(0,0,0,0.14)", ["--hover" as string]: c.hover };
  return (
    <Menu.Root>
      <Menu.Trigger
        data-language-menu
        data-lang={lang}
        className="readr-no-drag readr-hover"
        title={t("languageMenu.label")}
        aria-label={t("languageMenu.label")}
        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.muted, fontSize: 12, cursor: "pointer", fontFamily: "inherit", ["--hover" as string]: c.hover }}
      >
        <NativeName lang={lang} />
        <ChevronDown size={12} strokeWidth={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-language-menu-content className="readr-menu" align="end" sideOffset={6} style={surface}>
          <Menu.RadioGroup value={lang} onValueChange={changeLang}>
            {languages.map((code) => (
              <Menu.RadioItem key={code} data-lang={code} value={code} textValue={languageInfo(code).name} className="readr-menu-item">
                <span style={{ width: 14, display: "flex" }}>
                  <Menu.ItemIndicator>
                    <Check size={12} strokeWidth={2.2} />
                  </Menu.ItemIndicator>
                </span>
                <NativeName lang={code} />
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator style={{ height: 1, background: c.border, margin: "4px 0" }} />
          <Menu.Sub>
            <Menu.SubTrigger data-lang-add className="readr-menu-item">
              <Plus size={12} strokeWidth={2} style={{ width: 14 }} />
              <span style={{ flex: 1 }}>{t("languageMenu.add")}</span>
              <ChevronRight size={12} strokeWidth={2} />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className="readr-menu" sideOffset={4} collisionPadding={8} style={{ ...surface, maxHeight: "min(320px, var(--radix-dropdown-menu-content-available-height))", overflowY: "auto" }}>
                {others.map((code) => (
                  <Menu.Item key={code} data-lang-option={code} textValue={languageInfo(code).name} className="readr-menu-item" onSelect={() => changeLang(code)}>
                    <span style={{ flex: 1 }}>{languageInfo(code).name}</span>
                    <span style={{ color: c.muted, fontSize: 11 }}>
                      <NativeName lang={code} />
                    </span>
                  </Menu.Item>
                ))}
                {others.length === 0 && <div style={{ padding: "6px 10px", fontSize: 11, color: c.muted }}>{t("languageMenu.none")}</div>}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
