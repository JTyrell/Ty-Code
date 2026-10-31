import type { ModelLock, ModelLockMode } from '../../shared/types/settings';

export interface ActiveModelTriple {
  providerId: string;
  modelId: string;
  isAutoMode: boolean;
}

export interface ActiveRouteSnapshot {
  modelLock: ModelLock;
  activeRoute: { providerId: string; modelId: string };
  temporary: boolean;
  reason: string | null;
  updatedAt: number;
}

export interface ModelRouteEvent {
  kind: 'lock_changed' | 'deviated' | 'recovered';
  modelLock: ModelLock;
  activeRoute: { providerId: string; modelId: string };
  reason: string;
  timestamp: number;
}

export const SYNC_LOOP_WINDOW_MS = 1000;
export const SYNC_LOOP_MAX_CALLS_PER_WINDOW = 10;
export const SYNC_LOOP_QUIET_PERIOD_MS = 2000;

const DEFAULT_LOCK: ModelLock = {
  providerId: 'ty-code-free',
  modelId: 'google/gemma-4-31b-it:free',
  mode: 'resilient'
};
const UNLOCKED: ActiveModelTriple = { providerId: '', modelId: '', isAutoMode: true };

let currentActiveModel: ActiveModelTriple = { ...UNLOCKED };
let requestedModelLock: ModelLock = { ...DEFAULT_LOCK };
let activeRoute: ActiveRouteSnapshot = {
  modelLock: { ...DEFAULT_LOCK },
  activeRoute: { providerId: DEFAULT_LOCK.providerId, modelId: DEFAULT_LOCK.modelId },
  temporary: false,
  reason: null,
  updatedAt: 0
};
let seeded = false;
let routeEvents: ModelRouteEvent[] = [];
const listeners = new Set<(snapshot: ActiveRouteSnapshot, event?: ModelRouteEvent) => void>();

let windowStart = 0;
let windowCount = 0;
let stormActive = false;
let lastCallAt = 0;
let stormLogged = false;

function cloneLock(lock: ModelLock): ModelLock {
  return { providerId: lock.providerId, modelId: lock.modelId, mode: lock.mode };
}

function cloneSnapshot(snapshot: ActiveRouteSnapshot): ActiveRouteSnapshot {
  return {
    modelLock: cloneLock(snapshot.modelLock),
    activeRoute: { ...snapshot.activeRoute },
    temporary: snapshot.temporary,
    reason: snapshot.reason,
    updatedAt: snapshot.updatedAt
  };
}

function emit(event?: ModelRouteEvent): void {
  const snapshot = cloneSnapshot(activeRoute);
  for (const listener of listeners) listener(snapshot, event ? { ...event, modelLock: cloneLock(event.modelLock), activeRoute: { ...event.activeRoute } } : undefined);
}

function recordEvent(kind: ModelRouteEvent['kind'], reason: string): ModelRouteEvent {
  const event: ModelRouteEvent = {
    kind,
    modelLock: cloneLock(requestedModelLock),
    activeRoute: { ...activeRoute.activeRoute },
    reason,
    timestamp: Date.now()
  };
  routeEvents = [...routeEvents.slice(-49), event];
  return event;
}

export function resetActiveModelLockForTests(): void {
  currentActiveModel = { ...UNLOCKED };
  requestedModelLock = { ...DEFAULT_LOCK };
  activeRoute = {
    modelLock: { ...DEFAULT_LOCK },
    activeRoute: { providerId: DEFAULT_LOCK.providerId, modelId: DEFAULT_LOCK.modelId },
    temporary: false,
    reason: null,
    updatedAt: 0
  };
  seeded = false;
  routeEvents = [];
  windowStart = 0;
  windowCount = 0;
  stormActive = false;
  lastCallAt = 0;
  stormLogged = false;
}

export function shouldDropSetActiveModelCall(now: number): boolean {
  if (stormActive) {
    if (now - lastCallAt >= SYNC_LOOP_QUIET_PERIOD_MS) {
      stormActive = false;
      stormLogged = false;
      windowStart = now;
      windowCount = 1;
      lastCallAt = now;
      return false;
    }
    lastCallAt = now;
    return true;
  }
  if (now - windowStart >= SYNC_LOOP_WINDOW_MS) {
    windowStart = now;
    windowCount = 1;
    lastCallAt = now;
    return false;
  }
  windowCount += 1;
  lastCallAt = now;
  if (windowCount > SYNC_LOOP_MAX_CALLS_PER_WINDOW) {
    stormActive = true;
    if (!stormLogged) {
      stormLogged = true;
      const stack = new Error('SYNC-LOOP first offending call').stack || '(stack unavailable)';
      console.error(
        `[SYNC-LOOP] set-active-model storm detected: ${windowCount} calls within ${SYNC_LOOP_WINDOW_MS}ms ` +
        `(threshold: ${SYNC_LOOP_MAX_CALLS_PER_WINDOW}/window). Dropping further calls until ` +
        `${SYNC_LOOP_QUIET_PERIOD_MS}ms of quiet. First offending call stack:\n${stack}`
      );
    }
    return true;
  }
  return false;
}

export function isSameActiveModelTriple(a: ActiveModelTriple, b: ActiveModelTriple): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.isAutoMode === b.isAutoMode;
}

export function normalizeActiveModelTriple(
  config: { providerId?: string; modelId?: string; isAutoMode?: boolean } | null | undefined,
  defaultProvider: string,
  defaultModel: string
): ActiveModelTriple {
  const providerId = (config?.providerId || defaultProvider).trim();
  const modelId = (config?.modelId || defaultModel).trim();
  const isAutoMode = Boolean(config?.isAutoMode || providerId === 'auto');
  return {
    providerId: isAutoMode ? 'auto' : providerId,
    modelId: isAutoMode ? '' : modelId,
    isAutoMode
  };
}

function applyRequestedLock(triple: ActiveModelTriple, mode: ModelLockMode, reason: string): void {
  currentActiveModel = triple;
  requestedModelLock = { providerId: triple.providerId, modelId: triple.modelId, mode };
  activeRoute = {
    modelLock: cloneLock(requestedModelLock),
    activeRoute: { providerId: triple.providerId, modelId: triple.modelId },
    temporary: false,
    reason: null,
    updatedAt: Date.now()
  };
  emit(recordEvent('lock_changed', reason));
}

export interface LockActiveModelResult {
  changed: boolean;
  triple: ActiveModelTriple;
  modelLock: ModelLock;
}

export function lockActiveModel(
  config: { providerId?: string; modelId?: string; isAutoMode?: boolean; mode?: ModelLockMode } | null | undefined,
  defaultProvider: string,
  defaultModel: string
): LockActiveModelResult {
  if (shouldDropSetActiveModelCall(Date.now())) {
    return { changed: false, triple: { ...currentActiveModel }, modelLock: cloneLock(requestedModelLock) };
  }
  const next = normalizeActiveModelTriple(config, defaultProvider, defaultModel);
  const mode = config?.mode ?? requestedModelLock.mode;
  const changed = !isSameActiveModelTriple(currentActiveModel, next) || requestedModelLock.mode !== mode;
  if (!changed) return { changed: false, triple: { ...currentActiveModel }, modelLock: cloneLock(requestedModelLock) };
  applyRequestedLock(next, mode, seeded ? 'Requested model lock changed.' : 'Requested model lock initialized.');
  seeded = true;
  return { changed: true, triple: { ...next }, modelLock: cloneLock(requestedModelLock) };
}

export function seedModelLock(lock: ModelLock, defaultProvider = DEFAULT_LOCK.providerId, defaultModel = DEFAULT_LOCK.modelId): ActiveRouteSnapshot {
  if (seeded) return getActiveRouteSnapshot();
  const triple = normalizeActiveModelTriple(lock, defaultProvider, defaultModel);
  applyRequestedLock(triple, lock.mode, 'Requested model lock restored from settings.');
  seeded = true;
  return getActiveRouteSnapshot();
}

export function getActiveModel(): ActiveModelTriple {
  return { ...currentActiveModel };
}

export function getModelLock(): ModelLock {
  return cloneLock(requestedModelLock);
}

export function getGatewayActiveOverride(): { providerId: string; modelId: string } | null {
  return { ...activeRoute.activeRoute };
}

export function getActiveRouteSnapshot(): ActiveRouteSnapshot {
  return cloneSnapshot(activeRoute);
}

export function getModelRouteEvents(): ModelRouteEvent[] {
  return routeEvents.map((event) => ({ ...event, modelLock: cloneLock(event.modelLock), activeRoute: { ...event.activeRoute } }));
}

export function activateTemporaryRoute(providerId: string, modelId: string, reason: string): ActiveRouteSnapshot {
  if (requestedModelLock.mode !== 'resilient') return getActiveRouteSnapshot();
  if (activeRoute.temporary && activeRoute.activeRoute.providerId === providerId && activeRoute.activeRoute.modelId === modelId) {
    return getActiveRouteSnapshot();
  }
  activeRoute = {
    modelLock: cloneLock(requestedModelLock),
    activeRoute: { providerId, modelId },
    temporary: providerId !== requestedModelLock.providerId || modelId !== requestedModelLock.modelId,
    reason,
    updatedAt: Date.now()
  };
  if (activeRoute.temporary) emit(recordEvent('deviated', reason));
  return getActiveRouteSnapshot();
}

export function restoreRequestedRoute(reason = 'Requested route confirmed healthy again.'): ActiveRouteSnapshot {
  if (!activeRoute.temporary) return getActiveRouteSnapshot();
  activeRoute = {
    modelLock: cloneLock(requestedModelLock),
    activeRoute: { providerId: requestedModelLock.providerId, modelId: requestedModelLock.modelId },
    temporary: false,
    reason: null,
    updatedAt: Date.now()
  };
  emit(recordEvent('recovered', reason));
  return getActiveRouteSnapshot();
}

export function onActiveRouteChanged(listener: (snapshot: ActiveRouteSnapshot, event?: ModelRouteEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasSyncLoopStormFired(): boolean {
  return stormLogged || stormActive;
}

export function activePairChanged(
  before: { providerId: string; modelId: string; mode?: ModelLockMode },
  after: { providerId: string; modelId: string; mode?: ModelLockMode }
): boolean {
  return before.providerId !== after.providerId || before.modelId !== after.modelId || before.mode !== after.mode;
}
