import { I18nProvider } from "@/lib/i18n/client";
import { loadMessagesForNamespaces } from "@/lib/i18n/load-messages";
import { getMessages, getRequestLocale } from "@/lib/i18n/server";
import type { MessageNamespace } from "@/lib/i18n/types";

export async function I18nShell({
  children,
  userId,
  namespaces,
}: {
  children: React.ReactNode;
  userId?: string | null;
  namespaces?: MessageNamespace[];
}) {
  const locale = await getRequestLocale(userId);
  const messages = namespaces
    ? loadMessagesForNamespaces(locale, namespaces)
    : await getMessages(locale);

  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
