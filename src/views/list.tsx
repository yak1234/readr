// /list/:name — the reading list, favorites or archive: the saved articles, today's first.

import { useTranslation } from "react-i18next";
import { LibraryRows } from "../components/article-list";
import type { ChromeKey } from "../i18n";
import { useLibrary } from "../shell/library-provider";
import { usePage } from "../shell/navigation";
import { useOpen } from "../shell/open-actions";
import type { ListName } from "../shell/routes";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";
import { PageColumn } from "./page-column";

const TITLES: Record<ListName, ChromeKey> = { "reading-list": "nav.readingList", favorites: "nav.favorites", archive: "nav.archive" };

export function ListPage() {
  const { t } = useTranslation();
  const { c } = useReadrSettings();
  const { library, ready } = useLibrary();
  const { openUrl } = useOpen();
  const page = usePage();
  useScrollRestore(ready);
  if (page?.page !== "list") return null;
  return (
    <PageColumn title={t(TITLES[page.name])} data={`list-${page.name}`}>
      <LibraryRows c={c} library={library} list={page.name} onOpen={openUrl} />
    </PageColumn>
  );
}
