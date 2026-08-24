import { localeFallbackChain } from './locale-tags';

export type MessageMap = Readonly<Record<string, string>>;

export function resolveMessageCatalog(
  locale: string,
  bundled: ReadonlyMap<string, MessageMap>,
  user: ReadonlyMap<string, MessageMap>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const apply = (messages: MessageMap | undefined): void => {
    if (messages !== undefined) Object.assign(resolved, messages);
  };

  apply(bundled.get('en'));
  apply(user.get('en'));
  const candidates = localeFallbackChain(locale)
    .filter((candidate) => candidate !== 'en')
    .reverse();
  for (const candidate of candidates) {
    apply(bundled.get(candidate));
    apply(user.get(candidate));
  }
  return resolved;
}
