import {
  type LanguagePreference,
  type LocaleReloadResult,
  type LocalizationSnapshot,
  LocalizationSnapshotSchema
} from '../../shared/contracts';
import {
  loadLocalePacks,
  type LoadedLocalePacks
} from './locale-pack-loader';
import { resolveLocaleSelection } from './locale-tags';
import { resolveMessageCatalog } from './message-catalog';
import { Translator } from './translator';

export type LocalizationServiceOptions = {
  preference: LanguagePreference;
  preferredSystemLanguages: readonly string[];
  bundledRoot: string;
  userRoot?: string;
  userRoots?: readonly string[];
};

function packMessages(
  packs: ReadonlyMap<string, { messages: Readonly<Record<string, string>> }>
): Map<string, Readonly<Record<string, string>>> {
  return new Map([...packs].map(([locale, pack]) => [locale, pack.messages]));
}

function freezeSnapshot(snapshot: LocalizationSnapshot): LocalizationSnapshot {
  Object.freeze(snapshot.availableLocales);
  Object.freeze(snapshot.messages);
  Object.freeze(snapshot.warnings);
  return Object.freeze(snapshot);
}

function comparable(snapshot: LocalizationSnapshot): string {
  return JSON.stringify({ ...snapshot, revision: 0 });
}

export class LocalizationService {
  private preference: LanguagePreference;
  private packs: LoadedLocalePacks;
  private snapshot: LocalizationSnapshot;
  private translator: Translator;
  private readonly listeners = new Set<(snapshot: LocalizationSnapshot) => void>();
  private userRoots: readonly string[];

  constructor(private readonly options: LocalizationServiceOptions) {
    this.userRoots = options.userRoots === undefined
      ? options.userRoot === undefined ? [] : [options.userRoot]
      : [...options.userRoots];
    this.preference = options.preference;
    this.packs = loadLocalePacks({ ...options, userRoots: this.userRoots });
    this.snapshot = this.createSnapshot(this.packs, 1);
    this.translator = new Translator(
      this.snapshot.formattingLocale,
      this.snapshot.messages
    );
  }

  getSnapshot(): LocalizationSnapshot {
    return this.snapshot;
  }

  getTranslator(): Translator {
    return this.translator;
  }

  subscribe(listener: (snapshot: LocalizationSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setPreference(preference: LanguagePreference): LocalizationSnapshot {
    if (preference === this.preference) return this.snapshot;
    this.preference = preference;
    this.installSnapshot(this.createSnapshot(this.packs, this.snapshot.revision + 1));
    return this.snapshot;
  }

  reload(): LocaleReloadResult {
    const nextPacks = loadLocalePacks({
      ...this.options,
      userRoots: this.userRoots
    });
    const candidate = this.createSnapshot(nextPacks, this.snapshot.revision + 1);
    this.packs = nextPacks;
    if (comparable(candidate) !== comparable(this.snapshot)) {
      this.installSnapshot(candidate);
    }
    return {
      snapshot: this.snapshot,
      loadedUserPacks: nextPacks.loadedUserPacks,
      rejectedUserPacks: nextPacks.rejectedUserPacks
    };
  }

  setUserRoots(userRoots: readonly string[]): LocaleReloadResult {
    this.userRoots = [...userRoots];
    return this.reload();
  }

  private createSnapshot(
    packs: LoadedLocalePacks,
    revision: number
  ): LocalizationSnapshot {
    const selection = resolveLocaleSelection(
      this.preference,
      this.options.preferredSystemLanguages,
      packs.summaries.map((summary) => summary.locale)
    );
    const summary = packs.summaries.find(
      (candidate) => candidate.locale === selection.locale
    );
    const parsed = LocalizationSnapshotSchema.parse({
      revision,
      preference: this.preference,
      locale: selection.locale,
      formattingLocale: selection.formattingLocale,
      direction: summary?.direction ?? 'ltr',
      availableLocales: packs.summaries.map((candidate) => ({
        ...candidate,
        sources: [...candidate.sources]
      })),
      messages: resolveMessageCatalog(
        selection.locale,
        packMessages(packs.bundled),
        packMessages(packs.user)
      ),
      warnings: packs.warnings.map((warning) => ({ ...warning }))
    });
    return freezeSnapshot(parsed);
  }

  private installSnapshot(snapshot: LocalizationSnapshot): void {
    this.snapshot = snapshot;
    this.translator = new Translator(snapshot.formattingLocale, snapshot.messages);
    for (const listener of this.listeners) listener(snapshot);
  }
}
