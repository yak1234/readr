import React, { useEffect, useRef, useState } from "react";
import { Check, Play, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, languageInfo } from "../../shared/languages";
import type { Channel, SavedChannel, TvQuery } from "../../shared/types";
import { cleanIpcError } from "../../shared/errors";
import { api } from "../lib/api";
import { ReadingTokens, SERIF, UI_FONT } from "../lib/theme";
import { CHROME_LOCALE } from "../i18n";

interface Props {
  tokens: ReadingTokens;
  /** Language the search starts on ("" for any). */
  initialLang: string;
  saved: SavedChannel[];
  onPlay: (channel: Channel) => void;
  onSave: (channel: Channel, lang: string) => Promise<void>;
}

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames([CHROME_LOCALE], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** Find TV channels in the iptv-org index: official streams only, news first. */
export function TvFinder({ tokens, initialLang, saved, onPlay, onSave }: Props) {
  const { t } = useTranslation();
  const [country, setCountry] = useState("");
  const [language, setLanguage] = useState(initialLang);
  const [name, setName] = useState("");
  const [query, setQuery] = useState(name); // the name box, debounced
  const [countries, setCountries] = useState<string[]>([]);
  const [results, setResults] = useState<Channel[] | null>(null);
  const [error, setError] = useState("");
  const [first, setFirst] = useState(true); // the first search may download the index
  const [saving, setSaving] = useState<string | null>(null);
  const [pickLang, setPickLang] = useState("");
  const cache = useRef(new Map<string, { channels: Channel[]; countries: string[] }>());

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(name.trim()), 350);
    return () => window.clearTimeout(t);
  }, [name]);

  useEffect(() => {
    const q: TvQuery = { country, language, name: query };
    const key = JSON.stringify(q);
    const show = (r: { channels: Channel[]; countries: string[] }) => {
      setResults(r.channels);
      setCountries(r.countries);
      setError("");
      setFirst(false);
    };
    const hit = cache.current.get(key);
    if (hit) return show(hit);
    let live = true;
    setResults(null);
    api.tvSearch(q).then(
      (r) => {
        if (!live) return;
        cache.current.set(key, r);
        show(r);
      },
      (e) => {
        if (!live) return;
        setResults([]);
        setError(cleanIpcError(e));
      },
    );
    return () => {
      live = false;
    };
  }, [country, language, query]);

  const savedIds = new Set(saved.map((c) => c.id));
  const savedUrls = new Set(saved.map((c) => c.url));
  // A built-in may use another of the broadcaster's own addresses for the same channel.
  const savedNames = new Set(saved.map((c) => `${c.name}|${c.country}`));
  const field: React.CSSProperties = { padding: "7px 10px", fontSize: 12, borderRadius: 6, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text, outline: "none", fontFamily: UI_FONT, minWidth: 0 };
  const button: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, borderRadius: 5, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text, cursor: "pointer", fontFamily: UI_FONT };
  const host = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  };

  return (
    <div data-tv-finder style={{ maxWidth: 860, margin: "0 auto", padding: "36px 48px 80px", fontFamily: UI_FONT, color: tokens.text }}>
      <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: "-0.6px", marginBottom: 4 }}>{t("finder.channelsTitle")}</div>
      <div style={{ fontSize: 12, color: tokens.secondary, marginBottom: 24 }}>{t("finder.channelsIntro")}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <select data-tv-finder-language aria-label={t("finder.language")} value={language} onChange={(e) => { setLanguage(e.target.value); setCountry(""); }} style={{ ...field, maxWidth: 170 }}>
          <option value="">{t("finder.anyLanguage")}</option>
          {Object.values(LANGUAGES).sort((a, b) => a.name.localeCompare(b.name)).map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
        <select data-tv-finder-country aria-label={t("finder.country")} value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...field, maxWidth: 190 }}>
          <option value="">{t("finder.anyCountry")}</option>
          {[...new Set([...countries, country].filter(Boolean))].map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
            <option key={x.code} value={x.code}>{x.name}</option>
          ))}
        </select>
        <input data-tv-finder-name value={name} onChange={(e) => setName(e.target.value)} placeholder={t("finder.searchName")} style={{ ...field, flex: 1, minWidth: 140 }} />
      </div>

      <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: 14 }}>
        {error && (
          <div data-tv-finder-error style={{ margin: "16px 0", padding: "8px 14px", borderRadius: 6, fontSize: 12, background: tokens.sentenceHover, color: tokens.secondary }}>
            {error}
          </div>
        )}
        {results === null && <div style={{ padding: "18px 0", fontSize: 12, color: tokens.secondary }}>{t(first ? "finder.firstList" : "finder.searching")}</div>}
        {results?.length === 0 && !error && <div style={{ padding: "18px 0", fontSize: 12, color: tokens.secondary }}>{t("finder.noChannels")}</div>}
        {results?.map((ch) => {
          const isSaved = savedIds.has(ch.id) || savedUrls.has(ch.url) || savedNames.has(`${ch.name}|${ch.country}`);
          return (
            <div key={ch.id} data-channel={ch.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${tokens.border}` }}>
              <button title={t("finder.watch", { name: ch.name })} onClick={() => onPlay(ch)} style={{ width: 34, height: 34, borderRadius: 17, border: "none", background: tokens.text, color: tokens.bg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <Play size={13} style={{ marginLeft: 2 }} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", unicodeBidi: "plaintext", textAlign: "left" }}>{ch.name}</div>
                <div style={{ fontSize: 11, color: tokens.secondary, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {[ch.country && countryName(ch.country), ch.languages.map((l) => languageInfo(l).name).join(", "), ch.categories.slice(0, 2).join(", "), host(ch.url)].filter(Boolean).join(" · ")}
                </div>
              </div>
              {isSaved ? (
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: tokens.secondary }}>
                  <Check size={12} /> {t("finder.saved")}
                </span>
              ) : saving === ch.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <select data-tv-save-language aria-label={t("finder.saveUnder")} value={pickLang} onChange={(e) => setPickLang(e.target.value)} style={{ ...field, padding: "4px 8px", fontSize: 11 }}>
                    {[...new Set([pickLang, ...Object.keys(LANGUAGES)])].sort((a, b) => languageInfo(a).name.localeCompare(languageInfo(b).name)).map((code) => (
                      <option key={code} value={code}>{languageInfo(code).name}</option>
                    ))}
                  </select>
                  <button
                    data-tv-save-confirm
                    onClick={async () => {
                      await onSave(ch, pickLang);
                      setSaving(null);
                    }}
                    style={{ ...button, background: tokens.text, color: tokens.bg, borderColor: tokens.text }}
                  >
                    {t("finder.save")}
                  </button>
                  <button onClick={() => setSaving(null)} style={{ ...button, color: tokens.secondary }}>{t("finder.cancel")}</button>
                </div>
              ) : (
                <button
                  data-tv-save
                  onClick={() => {
                    setPickLang(ch.languages[0] ?? (language || "en"));
                    setSaving(ch.id);
                  }}
                  style={button}
                >
                  <Plus size={11} /> {t("finder.save")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
