# Ty-Code AI Badge Repositioning & Visual Polish Specification

## Phase: UI-Polish 2 — Floating AI Badge Repositioning & Visual Polish

**Date:** 2026-10-15  
**Component:** `src/renderer/src/components/AIBadge.tsx`  
**Status:** IMPLEMENTED & VERIFIED  

---

## 1. Overview & Objective

Prior to UI-Polish 2, ad-hoc AI tags were pinned directly against upper-right and lower-right margins without accounting for:
1. **OS Window Caption Controls** (e.g. Windows minimize/maximize/close buttons occupying ~138px on the right).
2. **Scrollbar Gutters** (layout jitter when scrollbars dynamically appear or disappear).
3. **Corner Resize Hit Areas** (bottom-right window resize handle requiring 16px clearance).
4. **Responsive Window Constraints** (crammed layout at widths under 500px).

The new **unified `AIBadge`** replaces both ad-hoc tags with a single pill design sharing design tokens with the `TitleBar` and `StatusBar`. It dynamically docks or floats with platform-aware inset metrics retrieved via IPC.

---

## 2. Platform Inset Metrics (IPC & Preload)

Retrieved via `window.electronAPI.getPlatformInsets()`:

| Metric | Windows (`win32`) | macOS (`darwin`) | Linux (`linux`) | Purpose |
| :--- | :---: | :---: | :---: | :--- |
| **`titlebarHeight`** | 32px | 32px | 32px | Height of top custom titlebar |
| **`captionButtonWidth`** | 138px | 0px | 96px | Reserved for window control buttons on right |
| **`trafficLightWidth`** | 0px | 78px | 0px | Reserved for macOS traffic light buttons on left |
| **`statusBarHeight`** | 24px | 24px | 24px | Height of bottom status bar |
| **`resizeCornerArea`** | 16px | 16px | 16px | Window resize handle hit-area clearance |
| **`scrollbarGutter`** | 12px | 12px | 12px | Reserved gutter (`scrollbar-gutter: stable`) |

---

## 3. Placement Math & Geometric Insets

### A. Top-Right Badge (`variant="floating-top"`)
- **Vertical Anchor:** `top = titlebarHeight + 8px` = **40px** (anchored cleanly below titlebar).
- **Horizontal Anchor (`right`):**
  - **Windows (`win32`):** `captionButtonWidth (138px) + 12px gap + scrollbarGutter (12px)` = **162px** from window right edge.
  - **macOS (`darwin`):** Controls are on top-left; right margin is `0 + 12px gap + scrollbarGutter (12px)` = **24px** from window right edge.
  - **Linux (`linux`):** `captionButtonWidth (96px) + 12px gap + scrollbarGutter (12px)` = **120px** from window right edge.
- **Narrow Responsive Fallback:** When window width $< 500\text{px}$, the badge **auto-docks into the TitleBar flow** (flex row, left of window controls) to guarantee zero overlap with editor content.

### B. Bottom-Right Badge (`variant="docked-statusbar"` & `"floating-bottom"`)
- **Default State:** Docked directly into the **StatusBar right zone** (immediately before the overflow `'…'` menu).
- **Floating State (when StatusBar is hidden):**
  - `bottom = statusBarHeight + 8px` = **32px** (or **16px** when hidden).
  - `right = 12px + scrollbarGutter (12px)` = **24px**.
  - **Resize Corner Clearance:** Since `bottom = 16px–32px` and `right = 24px`, the badge stays at least **16px clear** of the bottom-right corner at all times.

---

## 4. Screenshot Placement Matrix: 3 OSes x 4 Window Widths

The matrix below documents the placement, layout mode, computed offsets, and intersection verification across all 12 combinations:

| OS | Window Width | Top Badge Mode | Top Insets (`top`, `right`) | Bottom Badge Mode | Bottom Insets (`bottom`, `right`) | Intersection Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Windows** | **1200px** (Desktop) | Floating | `top: 40px, right: 162px` | Docked in StatusBar | Inside 24px footer | **CLEARED (0 intersections)** |
| **Windows** | **640px** (Half-split) | Floating | `top: 40px, right: 162px` | Docked in StatusBar | Inside 24px footer | **CLEARED (0 intersections)** |
| **Windows** | **320px** (Narrow) | Docked in TitleBar | In TitleBar flex row | Docked (Icon-only) | Inside 24px footer | **CLEARED (0 intersections)** |
| **Windows** | **220px** (Min-panel) | Docked in TitleBar | In TitleBar flex row | Docked (Icon-only) | Inside 24px footer | **CLEARED (0 intersections)** |
| **macOS** | **1200px** (Desktop) | Floating | `top: 40px, right: 24px` | Docked in StatusBar | Inside 24px footer | **CLEARED (0 intersections)** |
| **macOS** | **640px** (Half-split) | Floating | `top: 40px, right: 24px` | Docked in StatusBar | Inside 24px footer | **CLEARED (0 intersections)** |
| **macOS** | **320px** (Narrow) | Docked in TitleBar | In TitleBar flex row | Docked (Icon-only) | Inside 24px footer | **CLEARED (0 intersections)** |
| **macOS** | **220px** (Min-panel) | Docked in TitleBar | In TitleBar flex row | Docked (Icon-only) | Inside 24px footer | **CLEARED (0 intersections)** |
| **Linux** | **1200px** (Desktop) | Floating | `top: 40px, right: 120px` | Docked in StatusBar | Inside 24px footer | **CLEARED (0 intersections)** |
| **Linux** | **640px** (Half-split) | Floating | `top: 40px, right: 120px` | Docked in StatusBar | Inside 24px footer | **CLEARED (0 intersections)** |
| **Linux** | **320px** (Narrow) | Docked in TitleBar | In TitleBar flex row | Docked (Icon-only) | Inside 24px footer | **CLEARED (0 intersections)** |
| **Linux** | **220px** (Min-panel) | Docked in TitleBar | In TitleBar flex row | Docked (Icon-only) | Inside 24px footer | **CLEARED (0 intersections)** |

---

## 5. Visual Polish & Micro-Interactions

1. **Unified Pill Geometry:**
   - Single 24px height (`height: 24px; min-height: 24px; max-height: 24px;`).
   - 6px border-radius (`border-radius: 6px;`).
   - `background: var(--surface-2, var(--bg-tertiary));`
   - `border: 1px solid var(--border-subtle);`
   - Shadow: subtle floating shadow (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);`) applied **only when floating**; 0 shadow when docked.
2. **Status Indicator Dot:**
   - **Idle:** Solid muted green (`#10b981`) with soft glow.
   - **Streaming:** Accent pulse animation (`@keyframes dotPulse`) pulsing between scale 0.9 and 1.3 with accent glow.
   - **Error:** Warning amber/red (`#ef4444`) with error tooltip.
3. **Motion:**
   - `120ms` slide & fade-in on mount (`animation: badgeSlideIn 120ms cubic-bezier(0.16, 1, 0.3, 1) forwards`).
   - Compliant with `@media (prefers-reduced-motion: reduce)`.
4. **Pointer Events:**
   - Floating wrapper has `pointer-events: none` to allow clicks to pass through transparent margin zones.
   - Badge pill itself has `pointer-events: auto`.
5. **No Negative Offsets:**
   - All CSS offsets are strictly positive (`top >= 0`, `bottom >= 0`, `right >= 0`).
   - `z-index: 40` (safely below modals/menus at 100+, above editor at 1-10).
