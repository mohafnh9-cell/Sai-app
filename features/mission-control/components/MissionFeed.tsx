"use client";

import { useI18n } from "@/lib/i18n/client";
import type { MissionFeedItem } from "../types";

export function MissionFeed({ items }: { items: MissionFeedItem[] }) {
  const { t } = useI18n("missionControl");

  return (
    <section className="space-y-4" aria-labelledby="mission-feed-heading">
      <h2 id="mission-feed-heading" className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {t("feed.title")}
      </h2>
      <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="text-sm py-2 border-b border-border/40 last:border-0 text-foreground/90"
          >
            {item.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
