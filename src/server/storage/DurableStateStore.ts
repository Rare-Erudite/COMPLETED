import type { PersistentJsonStore } from './PersistentJsonStore.js';

interface DurableEntry {
  key: string;
  snapshot(): unknown;
  restore(value: unknown): void;
}

const arrayMutators = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

export class DurableStateStore {
  private readonly entries: DurableEntry[] = [];
  private persistence: PersistentJsonStore | undefined;

  trackArray<T>(key: string, initialValue: T[]): T[] {
    const target = initialValue;
    const proxy = this.observe(target, () => this.persist(key, target)) as T[];
    this.entries.push({
      key,
      snapshot: () => target,
      restore: (value) => {
        target.splice(0, target.length, ...(Array.isArray(value) ? value : []));
      },
    });
    return proxy;
  }

  trackObject<T extends Record<string, unknown>>(key: string, initialValue: T): T {
    const target = initialValue;
    const proxy = this.observe(target, () => this.persist(key, target)) as T;
    this.entries.push({
      key,
      snapshot: () => target,
      restore: (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        for (const property of Object.keys(target)) delete target[property];
        Object.assign(target, value);
      },
    });
    return proxy;
  }

  trackMap<K, V>(key: string, initialValue: Map<K, V>): Map<K, V> {
    const target = initialValue;
    const proxy = new Proxy(target, {
      get: (map, property) => {
        if (property === 'set') {
          return (entryKey: K, value: V) => {
            map.set(entryKey, value);
            this.persist(key, [...map.entries()]);
            return proxy;
          };
        }
        if (property === 'delete') {
          return (entryKey: K) => {
            const deleted = map.delete(entryKey);
            if (deleted) this.persist(key, [...map.entries()]);
            return deleted;
          };
        }
        if (property === 'clear') {
          return () => {
            if (map.size > 0) {
              map.clear();
              this.persist(key, []);
            }
          };
        }
        if (property === 'get') return (entryKey: K) => map.get(entryKey);
        if (property === 'forEach') {
          return (callback: (value: V, mapKey: K, map: Map<K, V>) => void, thisArg?: unknown) =>
            map.forEach((value, mapKey) => callback.call(thisArg, value, mapKey, proxy));
        }
        const value = Reflect.get(map, property, map);
        return typeof value === 'function' ? value.bind(map) : value;
      },
    });

    this.entries.push({
      key,
      snapshot: () => [...target.entries()],
      restore: (value) => {
        target.clear();
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (Array.isArray(entry) && entry.length === 2) {
              target.set(entry[0] as K, entry[1] as V);
            }
          }
        }
      },
    });
    return proxy;
  }

  async hydrate(persistence: PersistentJsonStore): Promise<void> {
    this.persistence = persistence;
    for (const entry of this.entries) {
      const value = await persistence.getOrSeed(entry.key, entry.snapshot());
      entry.restore(value);
    }
  }

  private persist(key: string, value: unknown): void {
    this.persistence?.setDocument(key, value);
  }

  private observe<T extends object>(target: T, onMutation: () => void): T {
    const proxyCache = new WeakMap<object, object>();
    let batchDepth = 0;
    let changed = false;
    const notify = () => {
      if (batchDepth > 0) {
        changed = true;
        return;
      }
      onMutation();
    };

    const wrap = (value: unknown): unknown => {
      if (!value || typeof value !== 'object') return value;
      const cached = proxyCache.get(value);
      if (cached) return cached;

      const proxy = new Proxy(value, {
        get: (object, property, receiver) => {
          const member = Reflect.get(object, property, receiver);
          if (Array.isArray(object) && typeof property === 'string' && arrayMutators.has(property)) {
            return (...args: unknown[]) => {
              batchDepth += 1;
              try {
                const result = Reflect.apply(member, receiver, args);
                changed = true;
                return result === receiver ? receiver : result;
              } finally {
                batchDepth -= 1;
                if (batchDepth === 0 && changed) {
                  changed = false;
                  onMutation();
                }
              }
            };
          }
          return wrap(member);
        },
        set: (object, property, valueToSet) => {
          const result = Reflect.set(object, property, valueToSet, object);
          if (result) notify();
          return result;
        },
        deleteProperty: (object, property) => {
          const existed = Reflect.has(object, property);
          const result = Reflect.deleteProperty(object, property);
          if (result && existed) notify();
          return result;
        },
      });

      proxyCache.set(value, proxy);
      return proxy;
    };

    return wrap(target) as T;
  }
}
