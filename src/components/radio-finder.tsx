import React, { useEffect, useRef, useState } from "react";
import { Check, Play, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChromeKey } from "../i18n";
import { LANGUAGES, languageInfo } from "../../shared/languages";
import type { RadioFacet, RadioQuery, SavedStation, Station } from "../../shared/types";
import { cleanIpcError } from "../../shared/errors";
import { api } from "../lib/api";
import { ReadingTokens, SERIF, UI_FONT } from "../lib/theme";

interface Props {
  tokens: ReadingTokens;
  /** Language the search starts on ("" for any). */
  initialLang: string;
  saved: SavedStation[];
  onPlay: (station: Station) => void;
  onSave: (station: Station, lang: string) => Promise<void>;
}

const TOPICS: { id: string; label: ChromeKey }[] = [
  { id: "", label: "finder.topics.all" },
  { id: "news", label: "finder.topics.news" },
  { id: "talk", label: "finder.topics.talk" },
  { id: "music", label: "finder.topics.music" },
];

/** Find stations on Radio Browser: pick a country, language and topic, or search by name. */
export function RadioFinder({ tokens, initialLang, saved, onPlay, onSave }: Props) {
  const { t } = useTranslation();
  const [country, setCountry] = useState("");
  const [language, setLanguage] = useState(initialLang);
  const [topic, setTopic] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState(name); // the name box, debounced
  const [countries, setCountries] = useState<RadioFacet[]>([]);
  const [languages, setLanguages] = useState<RadioFacet[]>([]);
  const [results, setResults] = useState<Station[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null); // station id with the language picker open
  const [pickLang, setPickLang] = useState("");
  // Searches already made while the finder is open.
  const cache = useRef(new Map<string, Station[]>());

  useEffect(() => {
    api.radioCountries().then(setCountries).catch((e) => setError(cleanIpcError(e)));
    api.radioLanguages().then(setLanguages).catch((e) => setError(cleanIpcError(e)));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(name.trim()), 350);
    return () => window.clearTimeout(t);
  }, [name]);

  useEffect(() => {
    const q: RadioQuery = { country, language, name: query, tag: topic };
    const key = JSON.stringify(q);
    const hit = cache.current.get(key);
    if (hit) {
      setResults(hit);
      setError("");
      return;
    }
    let live = true;
    setResults(null);
    api.radioSearch(q).then(
      (r) => {
        if (!live) return;
        cache.current.set(key, r);
        setResults(r);
        setError("");
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
  }, [country, language, query, topic]);

  const langOptions = languages.length
    ? [...languages].sort((a, b) => a.name.localeCompare(b.name))
    : Object.values(LANGUAGES).map((l) => ({ code: l.code, name: l.name, count: 0 }));
  const savedIds = new Set(saved.map((s) => s.id));
  const savedUrls = new Set(saved.map((s) => s.url));

  const field: React.CSSProperties = { padding: "7px 10px", fontSize: 12, borderRadius: 6, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text, outline: "none", fontFamily: UI_FONT, minWidth: 0 };
  const button: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, borderRadius: 5, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text, cursor: "pointer", fontFamily: UI_FONT };

  return (
    <div data-radio-finder style={{ maxWidth: 860, margin: "0 auto", padding: "36px 48px 80px", fontFamily: UI_FONT, color: tokens.text }}>
      <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: "-0.6px", marginBottom: 4 }}>{t("finder.stationsTitle")}</div>
      <div style={{ fontSize: 12, color: tokens.secondary, marginBottom: 24 }}>{t("finder.stationsIntro")}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <select data-finder-country aria-label={t("finder.country")} value={country} onChange={(e) => setCountry(e.target.value)} style={{ ...field, maxWidth: 190 }}>
          <option value="">{t("finder.anyCountry")}</option>
          {countries.map((x) => (
            <option key={x.code} value={x.code}>{x.name}</option>
          ))}
        </select>
        <select data-finder-language aria-label={t("finder.language")} value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...field, maxWidth: 170 }}>
          <option value="">{t("finder.anyLanguage")}</option>
          {langOptions.map((x) => (
            <option key={x.code} value={x.code}>{x.name}</option>
          ))}
        </select>
        <select data-finder-topic aria-label={t("finder.topic")} value={topic} onChange={(e) => setTopic(e.target.value)} style={{ ...field, maxWidth: 120 }}>
          {TOPICS.map((x) => (
            <option key={x.id} value={x.id}>{t(x.label)}</option>
          ))}
        </select>
        <input data-finder-name value={name} onChange={(e) => setName(e.target.value)} placeholder={t("finder.searchName")} style={{ ...field, flex: 1, minWidth: 140 }} />
      </div>

      <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: 14 }}>
        {error && (
          <div data-finder-error style={{ margin: "16px 0", padding: "8px 14px", borderRadius: 6, fontSize: 12, background: tokens.sentenceHover, color: tokens.secondary }}>
            {error}
          </div>
        )}
        {results === null && <div style={{ padding: "18px 0", fontSize: 12, color: tokens.secondary }}>{t("finder.searching")}</div>}
        {results?.length === 0 && !error && <div style={{ padding: "18px 0", fontSize: 12, color: tokens.secondary }}>{t("finder.noStations")}</div>}
        {results?.map((st) => {
          const isSaved = savedIds.has(st.id) || savedUrls.has(st.url);
          return (
            <div key={st.id} data-station={st.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${tokens.border}` }}>
              <button title={t("finder.play", { name: st.name })} onClick={() => onPlay(st)} style={{ width: 34, height: 34, borderRadius: 17, border: "none", background: tokens.text, color: tokens.bg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <Play size={13} style={{ marginLeft: 2 }} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", unicodeBidi: "plaintext", textAlign: "left" }}>{st.name}</div>
                <div style={{ fontSize: 11, color: tokens.secondary, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {[st.country, st.languages.map((l) => languageInfo(l).name).join(", "), st.tags.slice(0, 3).join(", "), [st.codec, st.bitrate ? `${st.bitrate} kbps` : ""].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                </div>
              </div>
              {isSaved ? (
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: tokens.secondary }}>
                  <Check size={12} /> {t("finder.saved")}
                </span>
              ) : saving === st.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <select data-save-language aria-label={t("finder.saveUnder")} value={pickLang} onChange={(e) => setPickLang(e.target.value)} style={{ ...field, padding: "4px 8px", fontSize: 11 }}>
                    {[...new Set([pickLang, ...Object.keys(LANGUAGES)])].sort((a, b) => languageInfo(a).name.localeCompare(languageInfo(b).name)).map((code) => (
                      <option key={code} value={code}>{languageInfo(code).name}</option>
                    ))}
                  </select>
                  <button
                    data-save-confirm
                    onClick={async () => {
                      await onSave(st, pickLang);
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
                  data-save
                  onClick={() => {
                    setPickLang(st.languages[0] ?? (language || "en"));
                    setSaving(st.id);
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
