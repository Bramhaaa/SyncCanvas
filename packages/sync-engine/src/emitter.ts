export interface Emitter<T> {
  on(cb: (event: T) => void): () => void;
  emit(event: T): void;
  clear(): void;
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(event: T) => void>();

  return {
    on(cb: (event: T) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    emit(event: T): void {
      for (const cb of listeners) {
        cb(event);
      }
    },

    clear(): void {
      listeners.clear();
    },
  };
}
