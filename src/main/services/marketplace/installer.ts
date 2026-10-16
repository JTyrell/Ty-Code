/**
 * Ty-Code Desktop IDE - Extension Installer Alias
 * Wraps and re-exports VsixInstaller for backward compatibility with existing tests and services.
 */

import { VsixInstaller, vsixInstaller } from './vsix-installer';

export { VsixInstaller, vsixInstaller };
export { VsixInstaller as ExtensionInstaller };
export const extensionInstaller = vsixInstaller;
export default vsixInstaller;
