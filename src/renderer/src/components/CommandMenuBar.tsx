/**
 * Command menu bar (Prompt 5).
 *
 * Every row painted here comes from the shared command registry:
 * `resolveCommandMenus()` returns the menus in bar order, already filtered for
 * "hidden > dead", already split into separator groups, and already carrying
 * both the enablement verdict and the reason a greyed row is greyed. This
 * component owns no menu table of its own — adding an item is one registry
 * entry, not an edit here, which is the property Prompt 5 Step 4 asks to be
 * able to demonstrate.
 *
 * Two rules shape the render:
 *
 *  - **Hidden > dead.** A menu whose every row is unbacked does not paint its
 *    button at all, so Run and Terminal vanish until a debug or task handler is
 *    registered instead of offering clicks that end in `no_handler`.
 *  - **Greyed = explained.** A disabled row keeps its `disabledReason` as a
 *    tooltip and swallows the click without closing the menu, so the user reads
 *    the reason rather than losing their place in the dropdown.
 *
 * The same component renders in every window that mounts TitleBar — the hash
 * router sends editor popouts to `MainWorkbench` too — and each instance
 * resolves from its own window's contexts, which is what Prompt 5 Step 3.3
 * asks for.
 *
 * Note on focus: clicking a row moves DOM focus into the menu bar, so
 * `focusedSurface()` in `lib/command-runtime.ts` reports `'none'` while a menu
 * is open. The edit handlers are written for that; nothing here should call
 * `preventDefault()` on `mousedown` to "preserve" editor focus, because that
 * would break the click-outside listener without fixing anything.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { notifyCommandMenuOpened } from '../lib/command-contexts';
import {
  executeCommandEntry,
  executeDynamicSubmenuItem,
  resolveCommandMenus
} from '../lib/command-runtime';
import { useCommandRuntimeStore } from '../state/command-runtime-store';
import { formatKeybindingForDisplay } from '../../../shared/types/command-registry';
import type {
  CommandMenuId,
  DynamicSubmenuItem,
  ResolvedMenuRow
} from '../../../preload/types';

export interface CommandMenuBarProps {
  /**
   * macOS swaps the modifier glyphs (`⌘`/`⇧`/`⌥`) and drops the `+`
   * separators. TitleBar already resolved the platform from `getAppInfo()`, so
   * it is passed down rather than fetched a second time.
   */
  isMac?: boolean;
}

// ---------------------------------------------------------------------------
// Styles — carried over verbatim from the hand-written bar this replaces, so
// the demo looks identical while the rows underneath become registry-driven.
// ---------------------------------------------------------------------------

const POPUP_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  backgroundColor: 'var(--bg-secondary, #12181f)',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
  borderRadius: '6px',
  padding: '4px 0',
  minWidth: '220px',
  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
  zIndex: 'var(--layer-menu)',
  backdropFilter: 'blur(16px)'
};

const FLYOUT_STYLE: React.CSSProperties = {
  ...POPUP_STYLE,
  // `-5px` cancels the popup's own 4px padding plus its 1px border so the
  // child's first row lines up with the parent row that opened it.
  top: '-5px',
  left: '100%',
  marginLeft: '2px'
};

const DIVIDER_STYLE: React.CSSProperties = {
  height: '1px',
  backgroundColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))',
  margin: '4px 0'
};

const ROW_STYLE: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '5px 12px',
  fontSize: '12px',
  color: 'var(--text-primary, #e2e8f0)',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  outline: 'none'
};

const ROW_DISABLED_STYLE: React.CSSProperties = {
  ...ROW_STYLE,
  opacity: 0.45,
  cursor: 'default'
};

const SHORTCUT_STYLE: React.CSSProperties = {
  fontSize: '10px',
  opacity: 0.7,
  marginLeft: '16px'
};

const DETAIL_STYLE: React.CSSProperties = {
  fontSize: '10px',
  opacity: 0.55,
  marginLeft: '12px',
  maxWidth: '260px',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

/**
 * One separator-delimited block of a popup.
 *
 * A top-level menu contributes one block per registry `group`; a flyout
 * contributes a single block holding the parent's static children followed by
 * its dynamic ones, because `resolveRow` returns those as two flat lists rather
 * than as groups.
 */
interface PopupGroup {
  rows: ResolvedMenuRow[];
  dynamic: DynamicSubmenuItem[];
}

function nonEmptyGroups(groups: PopupGroup[]): PopupGroup[] {
  return groups.filter((group) => group.rows.length > 0 || group.dynamic.length > 0);
}

/** A row is a disclosure target when the resolver gave it any child at all. */
function hasChildren(row: ResolvedMenuRow): boolean {
  return row.children.length > 0 || row.dynamicChildren.length > 0;
}

interface MenuPopupProps {
  groups: PopupGroup[];
  /** 0 for a menu bar dropdown, 1+ for a nested flyout. Indexes into `trail`. */
  depth: number;
  /** Open disclosure row id per depth; `trail[depth]` is this popup's child. */
  trail: readonly string[];
  isMac: boolean;
  flyout?: boolean;
  onRowEnter: (depth: number, id: string | null) => void;
  onActivateRow: (depth: number, row: ResolvedMenuRow) => void;
  onActivateDynamic: (item: DynamicSubmenuItem) => void;
}

const MenuPopup: React.FC<MenuPopupProps> = ({
  groups,
  depth,
  trail,
  isMac,
  flyout = false,
  onRowEnter,
  onActivateRow,
  onActivateDynamic
}) => {
  const visible = nonEmptyGroups(groups);

  return (
    <div role="menu" style={flyout ? FLYOUT_STYLE : POPUP_STYLE}>
      {visible.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 0 && <div role="separator" style={DIVIDER_STYLE} />}

          {group.rows.map((row) => {
            const disclosure = hasChildren(row);
            // A greyed parent keeps its flyout shut: showing children the user
            // cannot reach is the same dead end as a dead click one level up.
            const openable = disclosure && row.enabled;
            const isOpen = openable && trail[depth] === row.entry.id;
            const shortcut = row.displayKeybinding
              ? formatKeybindingForDisplay(row.displayKeybinding, isMac)
              : undefined;

            return (
              <div
                key={row.entry.id}
                role="menuitem"
                tabIndex={row.enabled ? 0 : -1}
                aria-disabled={row.enabled ? undefined : true}
                aria-haspopup={openable ? 'menu' : undefined}
                aria-expanded={openable ? isOpen : undefined}
                title={row.enabled ? undefined : row.disabledReason}
                style={row.enabled ? ROW_STYLE : ROW_DISABLED_STYLE}
                onMouseEnter={(e) => {
                  if (row.enabled) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  onRowEnter(depth, openable ? row.entry.id : null);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onClick={() => {
                  if (row.enabled) onActivateRow(depth, row);
                }}
                onKeyDown={(e) => {
                  if (!row.enabled) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onActivateRow(depth, row);
                  }
                }}
              >
                <span>{row.entry.label}</span>
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  {shortcut && <span style={SHORTCUT_STYLE}>{shortcut}</span>}
                  {openable && (
                    <ChevronRight
                      size={12}
                      style={{ opacity: 0.7, marginLeft: shortcut ? '4px' : '16px' }}
                    />
                  )}
                </span>

                {isOpen && (
                  <MenuPopup
                    flyout
                    depth={depth + 1}
                    trail={trail}
                    isMac={isMac}
                    groups={[{ rows: row.children, dynamic: row.dynamicChildren }]}
                    onRowEnter={onRowEnter}
                    onActivateRow={onActivateRow}
                    onActivateDynamic={onActivateDynamic}
                  />
                )}
              </div>
            );
          })}

          {group.dynamic.map((item) => (
            <div
              key={item.id}
              role="menuitem"
              tabIndex={item.enabled ? 0 : -1}
              aria-disabled={item.enabled ? undefined : true}
              title={item.enabled ? undefined : item.disabledReason}
              style={item.enabled ? ROW_STYLE : ROW_DISABLED_STYLE}
              onMouseEnter={(e) => {
                if (item.enabled) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                // Truncate the trail at this depth so a sibling flyout above
                // does not stay open while the pointer sits on a leaf.
                onRowEnter(depth, null);
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              onClick={() => {
                if (item.enabled) onActivateDynamic(item);
              }}
              onKeyDown={(e) => {
                if (!item.enabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onActivateDynamic(item);
                }
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', minWidth: 0 }}>
                <span>{item.label}</span>
                {item.detail && <span style={DETAIL_STYLE}>{item.detail}</span>}
              </span>
              {/* Always present so `space-between` keeps labels left-aligned
                  even on the rows that have nothing on their right. */}
              <span />
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};

export const CommandMenuBar: React.FC<CommandMenuBarProps> = ({ isMac = false }) => {
  // The five store slices a resolution reads. `revision` is the one that is
  // easy to miss: it moves when a renderer handler is registered or disposed,
  // which changes what is backed without any context changing at all.
  const contexts = useCommandRuntimeStore((s) => s.contexts);
  const mainContexts = useCommandRuntimeStore((s) => s.mainContexts);
  const mainCommands = useCommandRuntimeStore((s) => s.mainCommands);
  const dynamicSubmenus = useCommandRuntimeStore((s) => s.dynamicSubmenus);
  const revision = useCommandRuntimeStore((s) => s.revision);

  const menus = useMemo(() => {
    // `resolveCommandMenus()` reads the same five slices straight off the store
    // via `getState()`; they are listed as deps so the memo re-runs when any of
    // them moves. A menu with no backed row is dropped entirely rather than
    // rendered as a button that opens an empty popup.
    return resolveCommandMenus().filter((menu) => menu.groups.some((group) => group.length > 0));
  }, [contexts, mainContexts, mainCommands, dynamicSubmenus, revision]);

  const [openMenu, setOpenMenu] = useState<CommandMenuId | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const barRef = useRef<HTMLElement>(null);
  const buttonRefs = useRef<Partial<Record<CommandMenuId, HTMLButtonElement | null>>>({});

  const closeAll = useCallback(() => {
    setOpenMenu(null);
    setTrail([]);
  }, []);

  /**
   * Hovering a row owns the trail from its own depth down. Passing `null`
   * truncates, which is what closes a sibling flyout when the pointer moves to
   * a leaf. Returning the previous array on a no-op keeps React from
   * re-rendering the whole bar on every mouse move across a submenu parent.
   */
  const handleRowEnter = useCallback((depth: number, id: string | null) => {
    setTrail((prev) => {
      const next = id === null ? prev.slice(0, depth) : [...prev.slice(0, depth), id];
      if (next.length === prev.length && next.every((value, i) => value === prev[i])) return prev;
      return next;
    });
  }, []);

  const handleActivateRow = useCallback(
    (depth: number, row: ResolvedMenuRow) => {
      if (hasChildren(row)) {
        // A submenu parent discloses instead of running. Its registry `command`
        // still exists for the command palette, where there is no hover to
        // disclose with — but in a menu the click belongs to the chevron.
        setTrail((prev) =>
          prev[depth] === row.entry.id
            ? prev.slice(0, depth)
            : [...prev.slice(0, depth), row.entry.id]
        );
        return;
      }
      closeAll();
      executeCommandEntry(row.entry).catch((err) => {
        console.error('[command-menu-bar] command failed:', row.entry.id, err);
      });
    },
    [closeAll]
  );

  const handleActivateDynamic = useCallback(
    (item: DynamicSubmenuItem) => {
      closeAll();
      executeDynamicSubmenuItem(item).catch((err) => {
        console.error('[command-menu-bar] dynamic command failed:', item.id, err);
      });
    },
    [closeAll]
  );

  /**
   * Click-outside and Escape, installed only while something is open so the
   * listeners are genuinely disposable and never fire on a closed bar. Escape
   * deliberately does not `preventDefault()`: a modal underneath still needs
   * the key, and closing an already-closed menu is a no-op.
   *
   * The same effect carries the "a menu just opened" notification. It runs
   * exactly once per open — it early-returns while nothing is open, and
   * `closeAll` is a stable callback — and it is therefore the one place that
   * sees all three ways a menu opens: a click, a hover while one is already
   * open, and ArrowDown on a focused button. Putting the notification at the
   * three `setOpenMenu` call sites instead would mean writing it three times,
   * and a fourth open path added later would silently skip it, which is how a
   * submenu ends up listing a world that no longer exists.
   */
  useEffect(() => {
    if (openMenu === null) return undefined;
    notifyCommandMenuOpened(openMenu);
    const onMouseDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) closeAll();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu, closeAll]);

  /** Left/Right walk the bar, so the `menubar` role is honest about keys. */
  const focusSibling = useCallback(
    (from: CommandMenuId, delta: number) => {
      const ids = menus.map((menu) => menu.menu);
      const at = ids.indexOf(from);
      if (at < 0) return;
      const next = ids[(at + delta + ids.length) % ids.length];
      buttonRefs.current[next]?.focus();
    },
    [menus]
  );

  if (menus.length === 0) return null;

  return (
    <nav
      ref={barRef}
      role="menubar"
      aria-orientation="horizontal"
      aria-label="Application menu"
      style={{ display: 'flex', alignItems: 'center', gap: '1px', height: '100%' }}
    >
      {menus.map((menu) => {
        const isOpen = openMenu === menu.menu;
        return (
          <div
            key={menu.menu}
            style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}
          >
            <button
              ref={(node) => {
                buttonRefs.current[menu.menu] = node;
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className={`titlebar-menu-btn${isOpen ? ' is-open' : ''}`}
              onClick={() => {
                setTrail([]);
                setOpenMenu(isOpen ? null : menu.menu);
              }}
              onMouseEnter={() => {
                if (openMenu !== null && openMenu !== menu.menu) {
                  setTrail([]);
                  setOpenMenu(menu.menu);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  focusSibling(menu.menu, 1);
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  focusSibling(menu.menu, -1);
                } else if (e.key === 'ArrowDown' && !isOpen) {
                  e.preventDefault();
                  setTrail([]);
                  setOpenMenu(menu.menu);
                }
              }}
            >
              {menu.menu}
            </button>

            {isOpen && (
              <MenuPopup
                depth={0}
                trail={trail}
                isMac={isMac}
                groups={menu.groups.map((rows) => ({ rows, dynamic: [] }))}
                onRowEnter={handleRowEnter}
                onActivateRow={handleActivateRow}
                onActivateDynamic={handleActivateDynamic}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
};

export default CommandMenuBar;
