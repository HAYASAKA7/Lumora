export interface SingleWindowCreationGate {
  ensureCreated(): Promise<void>;
}

export function createSingleWindowCreationGate<Prepared>({
  canCreate,
  prepare,
  create
}: {
  canCreate(): boolean;
  prepare(): Promise<Prepared>;
  create(prepared: Prepared): void | Promise<void>;
}): SingleWindowCreationGate {
  let pendingCreation: Promise<void> | null = null;

  return {
    ensureCreated(): Promise<void> {
      if (pendingCreation !== null) {
        return pendingCreation;
      }
      if (!canCreate()) {
        return Promise.resolve();
      }

      let creation: Promise<void>;
      creation = (async () => {
        const prepared = await prepare();
        if (canCreate()) {
          await create(prepared);
        }
      })().finally(() => {
        if (pendingCreation === creation) {
          pendingCreation = null;
        }
      });
      pendingCreation = creation;
      return creation;
    }
  };
}
