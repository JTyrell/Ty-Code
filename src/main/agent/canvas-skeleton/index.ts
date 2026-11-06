/**
 * Canvas skeleton emitters — dispatcher (Prompt 4 extension, tier 2).
 *
 * `skeletonFor(target, nodes, componentName)` returns the deterministic baseline
 * dialect for any registry target. The export orchestrator uses this as the
 * guaranteed offline/keyless fallback (after agent + one retry), and the
 * conformance suite runs it directly (no model, no network) to assert each
 * platform's markers/bans/balance.
 */

import type { CanvasComponentNode } from '../../services/canvas-sync-manager';
import type { CanvasTargetId } from '../../../shared/canvas-platform-registry';
import { skeletonReactWeb } from './reactWeb';
import { skeletonReactNative } from './reactNative';
import { skeletonHtmlTailwind } from './htmlTailwind';
import { skeletonVue } from './vue';
import { skeletonSvelte } from './svelte';
import { skeletonAngular } from './angular';
import { skeletonFlutter } from './flutter';
import { skeletonCompose } from './compose';
import { skeletonSwiftUI } from './swiftui';

export function skeletonFor(target: CanvasTargetId, nodes: CanvasComponentNode[], componentName: string): string {
  switch (target) {
    case 'react-web':
      return skeletonReactWeb(nodes, componentName);
    case 'react-native':
      return skeletonReactNative(nodes, componentName);
    case 'html-tailwind':
      return skeletonHtmlTailwind(nodes, componentName);
    case 'vue':
      return skeletonVue(nodes, componentName);
    case 'svelte':
      return skeletonSvelte(nodes, componentName);
    case 'angular':
      return skeletonAngular(nodes, componentName);
    case 'flutter':
      return skeletonFlutter(nodes, componentName);
    case 'compose':
      return skeletonCompose(nodes, componentName);
    case 'swiftui':
      return skeletonSwiftUI(nodes, componentName);
    default: {
      // Exhaustiveness guard: an unregistered target should never reach here.
      const _exhaustive: never = target;
      return skeletonReactWeb(nodes, _exhaustive);
    }
  }
}
