import React, { useState, useEffect, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import { useChatStore } from '../../state/chat-store';
import { SettingsSidebar, type SettingsCategoryId } from './SettingsSidebar';
import { AccountCategory } from './categories/AccountCategory';
import { GeneralCategory } from './categories/GeneralCategory';
import { AppearanceCategory } from './categories/AppearanceCategory';
import { ModelsCategory } from './categories/ModelsCategory';
import { CustomizationsCategory } from './categories/CustomizationsCategory';
import { BrowserCategory } from './categories/BrowserCategory';
import { TabCategory } from './categories/TabCategory';
import { EditorCategory } from './categories/EditorCategory';

export interface ModularSettingsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  initialCategory?: SettingsCategoryId;
  onOpenByokWizard?: () => void;
}

export const SettingsModal: React.FC<ModularSettingsModalProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  initialCategory = 'account',
  onOpenByokWizard
}) => {
  const { isSettingsOpen, toggleSettings } = useChatStore();
  const isOpen = propIsOpen !== undefined ? propIsOpen : isSettingsOpen;
  const handleClose = propOnClose || toggleSettings;

  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');

  // Handle Escape key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    },
    [isOpen, handleClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-4xl h-[720px] max-h-[90vh] bg-[#121316] border border-[#262833] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        style={{
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)'
        }}
      >
        {/* Modal Top Header */}
        <div className="h-14 px-5 border-b border-[#262833] bg-[#16181f] flex items-center justify-between flex-shrink-0 select-none">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-violet-500 shadow-sm shadow-violet-500/50" />
            <h1 id="settings-dialog-title" className="text-sm font-bold tracking-wide text-gray-100">
              Ty-Code Settings
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              id="close-settings-btn"
              onClick={handleClose}
              aria-label="Close settings"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-[#262833] transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Main Content Area (2-Column Layout) */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Navigation Sidebar */}
          <SettingsSidebar
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

          {/* Right Category Content Body */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#14151b]">
            <div className="max-w-2xl mx-auto">
              {activeCategory === 'account' && <AccountCategory />}
              {activeCategory === 'general' && <GeneralCategory />}
              {activeCategory === 'appearance' && <AppearanceCategory />}
              {activeCategory === 'models' && <ModelsCategory onOpenByokWizard={onOpenByokWizard} />}
              {activeCategory === 'customizations' && <CustomizationsCategory />}
              {activeCategory === 'browser' && <BrowserCategory />}
              {activeCategory === 'tab' && <TabCategory />}
              {activeCategory === 'editor' && <EditorCategory />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
