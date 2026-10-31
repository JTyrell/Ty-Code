/**
 * Renderer command-runtime state (Prompt 5).
 *
 * Holds the three things a menu bar needs in order to paint itself from the
 * shared registry, and nothing else:
 *
 *  - the contexts THIS window can observe (is an editor open, is the terminal
 *    showing, are there problems),
 *  - what main told us it owns (developer tools permitted, an updater wired up,
 *    a launch configuration on disk) plus the handler keys main can actually
 *    run,
 *  - the runtime-only submenu rows (open tabs, running tasks) that cannot be
 *    named in the registry because they exist only once the user looks.
 *
 * Deliberately not in here: the registry table, the resolution rules, or any
 * handler. Those live in `lib/command-runtime.ts` and the shared registry, so
 * this store stays a dumb snapshot that React can subscribe to without pulling
 * command semantics into the state layer.
 */

import { create } from 'zustand';
import type {
  CommandContext,
  CommandContextSnapshot,
  DynamicSubmenuItem,
  DynamicSubmenuSource,
  MainCommandContext
} from '../../../preload/types';

export interface CommandRuntimeStore {
  /**
   * Contexts contributed by this window's own feature areas. Partial by design:
   * a contributor reports only the keys it can genuinely observe, and anything
   * unreported resolves to `false` through `emptyContext()`.
   */
  contexts: Partial<CommandContext>;

  /** Context keys main reported, merged OVER `contexts` at resolution time. */
  mainContexts: CommandContextSnapshot;

  /**
   * Registry `command` keys main has a live handler for. Unioned with the
   * renderer's own registrations to decide which rows are backed — a row main
   * cannot run is hidden here rather than painted as a click that ends in
   * `no_handler`.
   */
  mainCommands: ReadonlySet<string>;

  /** Handler keys main still lacks, kept for the Diagnostics surface. */
  missingMainHandlers: readonly string[];

  /** Live rows per dynamic submenu source, supplied by the owning feature. */
  dynamicSubmenus: Partial<Record<DynamicSubmenuSource, DynamicSubmenuItem[]>>;

  /**
   * Bumped whenever something outside this store changes what a menu would
   * resolve to — a renderer handler being registered or disposed, for instance.
   * Subscribers read it so they re-render on those changes too.
   */
  revision: number;

  setContexts: (contexts: Partial<CommandContext>) => void;
  setMainCommandContext: (context: MainCommandContext) => void;
  setDynamicSubmenu: (
    source: DynamicSubmenuSource,
    items: DynamicSubmenuItem[]
  ) => void;
  bumpRevision: () => void;
}

export const useCommandRuntimeStore = create<CommandRuntimeStore>((set) => ({
  contexts: {},
  mainContexts: {},
  mainCommands: new Set<string>(),
  missingMainHandlers: [],
  dynamicSubmenus: {},
  revision: 0,

  setContexts: (contexts) => set({ contexts }),

  setMainCommandContext: (context) =>
    set({
      mainContexts: context.contexts,
      // A fresh Set each fetch: zustand compares by reference, so reusing one
      // would leave a menu showing the previous fetch's handler coverage.
      mainCommands: new Set(context.availableCommands),
      missingMainHandlers: context.missingHandlers
    }),

  setDynamicSubmenu: (source, items) =>
    set((state) => ({
      dynamicSubmenus: { ...state.dynamicSubmenus, [source]: items }
    })),

  bumpRevision: () => set((state) => ({ revision: state.revision + 1 }))
}));
