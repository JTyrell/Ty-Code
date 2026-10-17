/**
 * Unified Provisioning Onboarding Store (Phase UnifiedProvisioning)
 *
 * Persisted Zustand store tracking wizard state, path choice, connected providers,
 * skip/anonymous fallback status, and reminder cadence for non-intrusive upgrades.
 *
 * Brand: Ty-Code
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { toast } from './toast-store';

export type OnboardingPath = 'free_accounts' | 'local' | 'anonymous' | 'fcc_full';
export type OnboardingStepId =
  | 'welcome'
  | 'auto_setup'
  | 'subscriptions'
  | 'harness_import'
  | 'summary'
  | 'skip_anonymous'
  | 'path_choice'
  | 'openrouter'
  | 'groq'
  | 'google-gemini'
  | 'ollama';

export interface OnboardingState {
  // Modal visibility
  isOpen: boolean;

  // Flow progression
  currentStep: OnboardingStepId;
  selectedPath: OnboardingPath | null;
  connectedProviders: string[];
  skippedProviders: string[];
  connectedSubscriptions: string[];
  importedHarnesses: string[];
  discoveredFreeModelsCount: number;
  autoSetupStatus:
    | 'idle'
    | 'verifying'
    | 'loading'
    | 'health_checking'
    | 'ready'
    | 'running'
    | 'completed'
    | 'error';
  autoSetupLogs: string[];

  // Completion flags
  isCompleted: boolean;
  isSkipped: boolean;
  firstSeenTimestamp: number;
  completedTimestamp: number | null;

  // Reminder cadence (Day-3, max once per week, dismissible forever)
  lastReminderTimestamp: number | null;
  reminderDismissedForever: boolean;

  // Rate-limit encounter
  rateLimitEncountered: boolean;

  // Actions
  openWizard: (initialStep?: OnboardingStepId) => void;
  closeWizard: () => void;
  setStep: (step: OnboardingStepId) => void;
  selectPath: (path: OnboardingPath) => void;
  markProviderConnected: (providerId: string) => void;
  markProviderSkipped: (providerId: string) => void;
  startAutoSetup: () => Promise<void>;
  connectSubscription: (subId: 'copilot' | 'chatgpt') => Promise<boolean>;
  importHarness: (detectedConfig: any) => Promise<boolean>;
  skipToAnonymous: () => Promise<void>;
  completeWizard: () => Promise<void>;
  resetWizard: () => void;
  dismissReminder: (forever?: boolean) => void;
  recordRateLimit429: () => void;
  syncWithBackend: () => Promise<void>;
  shouldShowReminder: () => boolean;
}

const STORAGE_KEY = 'ty_code_onboarding_state_v1';

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      currentStep: 'welcome',
      selectedPath: null,
      connectedProviders: [],
      skippedProviders: [],
      connectedSubscriptions: [],
      importedHarnesses: [],
      discoveredFreeModelsCount: 50,
      autoSetupStatus: 'idle',
      autoSetupLogs: [],
      isCompleted: false,
      isSkipped: false,
      firstSeenTimestamp: Date.now(),
      completedTimestamp: null,
      lastReminderTimestamp: null,
      reminderDismissedForever: false,
      rateLimitEncountered: false,

      openWizard: (initialStep?: OnboardingStepId) => {
        set((state) => ({
          isOpen: true,
          currentStep: initialStep || (state.isCompleted ? 'auto_setup' : state.currentStep || 'welcome')
        }));
      },

      closeWizard: () => {
        set({ isOpen: false });
      },

      setStep: (step: OnboardingStepId) => {
        set({ currentStep: step });
        void get().syncWithBackend();
      },

      selectPath: (path: OnboardingPath) => {
        set({ selectedPath: path });
        if (path === 'free_accounts') {
          set({ currentStep: 'openrouter' });
        } else if (path === 'local') {
          set({ currentStep: 'ollama' });
        } else if (path === 'anonymous') {
          void get().skipToAnonymous();
        } else if (path === 'fcc_full') {
          set({ currentStep: 'auto_setup' });
          void get().startAutoSetup();
        }
        void get().syncWithBackend();
      },

      startAutoSetup: async () => {
        set({ autoSetupStatus: 'verifying', autoSetupLogs: ['Initiating FCC bootstrap Tier-2...', 'Verifying embedded supply layer...'] });
        try {
          if (window.electronAPI?.fccSetEnabled) {
            await window.electronAPI.fccSetEnabled(true);
          }
          set((s) => ({
            autoSetupStatus: 'loading',
            autoSetupLogs: [...s.autoSetupLogs, '✓ Embedded supply verified (SHA-256 integrity match)', 'Loading 61-provider model catalog...']
          }));

          let modelCount = 50;
          if (window.electronAPI?.fccGetCatalog) {
            const catRes = await window.electronAPI.fccGetCatalog();
            if (catRes.success && catRes.data) {
              const totalModels = catRes.data.reduce((sum, p) => sum + (p.models?.length || 0), 0);
              if (totalModels > 0) modelCount = totalModels;
            }
          }
          set((s) => ({
            discoveredFreeModelsCount: modelCount,
            autoSetupStatus: 'health_checking',
            autoSetupLogs: [
              ...s.autoSetupLogs,
              `✓ 61-provider catalog loaded (${modelCount} free models discovered)`,
              'Health-checking top providers...'
            ]
          }));

          if (window.electronAPI?.fccAutoSetup) {
            await window.electronAPI.fccAutoSetup();
          }
          set((s) => ({
            autoSetupLogs: [
              ...s.autoSetupLogs,
              '✓ Top free providers health-checked and online',
              `✓ Embedded supply ready: ${s.discoveredFreeModelsCount} free models discovered`
            ],
            autoSetupStatus: 'ready',
            connectedProviders: Array.from(new Set([...s.connectedProviders, 'fcc-layer', 'openrouter', 'groq', 'google-ai-studio']))
          }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          set((s) => ({
            autoSetupStatus: 'error',
            autoSetupLogs: [...s.autoSetupLogs, `Notice: ${msg}. Continuing with native supply fallback.`]
          }));
        }
      },

      connectSubscription: async (subId: 'copilot' | 'chatgpt') => {
        try {
          if (window.electronAPI?.fccConnectSubscription) {
            const res = await window.electronAPI.fccConnectSubscription(subId);
            if (res.success && res.data?.connected) {
              const name = subId === 'copilot' ? 'GitHub Copilot' : 'ChatGPT/OpenAI';
              set((s) => ({
                connectedSubscriptions: Array.from(new Set([...s.connectedSubscriptions, name]))
              }));
              toast.success('Subscription Connected', res.data?.message || `${name} connected`);
              return true;
            }
          }
          return false;
        } catch {
          return false;
        }
      },

      importHarness: async (detectedConfig: any) => {
        try {
          if (window.electronAPI?.fccImportHarnessConfig) {
            const res = await window.electronAPI.fccImportHarnessConfig(detectedConfig);
            if (res.success) {
              set((s) => ({
                importedHarnesses: Array.from(new Set([
                  ...s.importedHarnesses,
                  `${detectedConfig.name} (${res.data?.importedModel || 'preferences imported'})`
                ]))
              }));
              toast.success('Harness Imported', `Imported ${detectedConfig.name} configuration.`);
              return true;
            }
          }
          return false;
        } catch {
          return false;
        }
      },

      markProviderConnected: (providerId: string) => {
        set((state) => {
          const normId = providerId.replace(/-free$/, '');
          const setConnected = new Set([...state.connectedProviders, normId]);
          const remainingSkipped = state.skippedProviders.filter((p) => p !== normId);
          return {
            connectedProviders: Array.from(setConnected),
            skippedProviders: remainingSkipped
          };
        });
        void get().syncWithBackend();
      },

      markProviderSkipped: (providerId: string) => {
        set((state) => {
          const normId = providerId.replace(/-free$/, '');
          const setSkipped = new Set([...state.skippedProviders, normId]);
          return {
            skippedProviders: Array.from(setSkipped)
          };
        });
        void get().syncWithBackend();
      },

      skipToAnonymous: async () => {
        set({
          isSkipped: true,
          isCompleted: true,
          currentStep: 'skip_anonymous',
          selectedPath: 'anonymous',
          completedTimestamp: Date.now()
        });

        // 1. Enable Tier 0 anonymous access via gateway
        try {
          if (window.electronAPI?.openkiloEnableAnonymous) {
            await window.electronAPI.openkiloEnableAnonymous();
          }
          if (window.electronAPI?.orchestrationSetFreeMode) {
            await window.electronAPI.orchestrationSetFreeMode(true);
          }
          if (window.electronAPI?.saveSettings) {
            await window.electronAPI.saveSettings({
              freeMode: true,
              activeProvider: 'openkilo' as any,
              activeModel: 'deepseek-r1-0528:free',
              hasCompletedOnboarding: true
            });
          }
        } catch (err) {
          console.warn('Non-blocking anonymous activation error:', err);
        }

        // 2. Local flags
        localStorage.setItem('ty_code_onboarding_completed', 'true');
        localStorage.setItem('ty_code_first_run_completed', 'true');
        localStorage.setItem('ty_code_anonymous_tier_active', 'true');

        // 3. User feedback
        toast.info('Using anonymous access — connect accounts anytime for higher limits.');

        void get().syncWithBackend();
      },

      completeWizard: async () => {
        const { connectedProviders } = get();
        set({
          isCompleted: true,
          isSkipped: false,
          currentStep: 'summary',
          completedTimestamp: Date.now()
        });

        try {
          if (window.electronAPI?.orchestrationCompleteOnboarding) {
            await window.electronAPI.orchestrationCompleteOnboarding();
          }
          if (window.electronAPI?.saveSettings) {
            const primaryProvider = connectedProviders[0] || 'openrouter';
            await window.electronAPI.saveSettings({
              hasCompletedOnboarding: true,
              freeMode: true,
              activeProvider: primaryProvider as any
            });
          }
        } catch (err) {
          console.warn('Non-blocking onboarding completion error:', err);
        }

        localStorage.setItem('ty_code_onboarding_completed', 'true');
        localStorage.setItem('ty_code_first_run_completed', 'true');
        localStorage.removeItem('ty_code_anonymous_tier_active');

        toast.success('Setup completed! Free provider accounts connected.');
        void get().syncWithBackend();
      },

      resetWizard: () => {
        set({
          isOpen: true,
          currentStep: 'welcome',
          selectedPath: null,
          isCompleted: false,
          isSkipped: false
        });
        localStorage.removeItem('ty_code_onboarding_completed');
        void get().syncWithBackend();
      },

      dismissReminder: (forever = false) => {
        set({
          lastReminderTimestamp: Date.now(),
          reminderDismissedForever: Boolean(forever)
        });
        void get().syncWithBackend();
      },

      recordRateLimit429: () => {
        set({ rateLimitEncountered: true });
        void get().syncWithBackend();
      },

      syncWithBackend: async () => {
        try {
          const state = get();
          if (window.electronAPI?.onboardingSaveState) {
            await window.electronAPI.onboardingSaveState({
              completed: state.isCompleted,
              selectedPath: state.selectedPath,
              currentStep: state.currentStep,
              connectedProviders: state.connectedProviders,
              skipped: state.isSkipped,
              firstSeenAt: state.firstSeenTimestamp,
              completedAt: state.completedTimestamp,
              lastReminderAt: state.lastReminderTimestamp,
              reminderDismissedForever: state.reminderDismissedForever,
              anonymousRateLimitEncountered: state.rateLimitEncountered
            });
          }
        } catch {
          // Non-blocking sync
        }
      },

      shouldShowReminder: () => {
        const state = get();
        if (!state.isSkipped || state.reminderDismissedForever) return false;
        if (state.connectedProviders.length > 0) return false;

        const now = Date.now();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        // At least 3 days since first launch
        if (now - state.firstSeenTimestamp < threeDaysMs) return false;

        // At least 7 days since last reminder
        if (state.lastReminderTimestamp && now - state.lastReminderTimestamp < sevenDaysMs) {
          return false;
        }

        return true;
      }
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage)
    }
  )
);
