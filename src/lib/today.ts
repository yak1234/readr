// Today's date for a page's dateline.

import { useEffect, useState } from "react";

/** Today's date, moving on at midnight while the page stays open. */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    const timer = window.setTimeout(() => setToday(new Date()), next - Date.now() + 1000);
    return () => window.clearTimeout(timer);
  }, [today]);
  return today;
}
