import React from 'react';
import {
  type LucideIcon,
  User,
  Sliders,
  Palette,
  Cpu,
  Sparkles,
  Globe,
  Zap,
  FileCode,
  Shield,
  Search
} from 'lucide-react';

export type SettingsCategoryId =
  | 'account'
  | 'general'
  | 'appearance'
  | 'models'
  | 'customizations'
  | 'browser'
  | 'tab'
  | 'editor';

export interface CategoryItem {
  id: SettingsCategoryId;
  title: string;
  icon: LucideIcon;
  badge?: string;
  description: string;
}

export const SETTINGS_CATEGORIES: CategoryItem[] = [
  { id: 'account', title: 'Account', icon: User, description: 'Auth status, usage quota meter, sync' },
  { id: 'general', title: 'General', icon: Sliders, description: 'Updates, background execution, startup' },
  { id: 'appearance', title: 'Appearance', icon: Palette, description: 'Theme, chat width, density, typography' },
  { id: 'models', title: 'Models', icon: Cpu, badge: 'Router', description: 'Default model, thinking budget, temperature, BYOK' },
  { id: 'customizations', title: 'Customizations', icon: Sparkles, description: 'Skills, AGENTS.md rules, MCP servers' },
  { id: 'browser', title: 'Browser', icon: Globe, description: 'Headless mode, domain allowlist, recording' },
  { id: 'tab', title: 'Tab (Autocomplete)', icon: Zap, badge: 'AI', description: 'Inline ghost text, trigger delay, supercomplete' },
  { id: 'editor', title: 'Editor', icon: FileCode, description: 'Ligatures, minimap, format on save, code lenses' }
];

export interface SettingsSidebarProps {
  activeCategory: SettingsCategoryId;
  onSelectCategory: (id: SettingsCategoryId) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  activeCategory,
  onSelectCategory,
  searchQuery = '',
  onSearchChange
}) => {
  const filteredCategories = SETTINGS_CATEGORIES.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-64 flex-shrink-0 border-r border-[#262833] bg-[#121316] flex flex-col h-full select-none">
      {/* Search Header */}
      {onSearchChange && (
        <div className="p-3 border-b border-[#262833]">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search settings..."
              className="w-full bg-[#181a22] border border-[#2b2e3a] text-gray-200 placeholder-gray-500 text-xs rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Categories List */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        <div className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase text-gray-500">
          Preferences
        </div>

        {filteredCategories.map((category) => {
          const Icon = category.icon;
          const isActive = activeCategory === category.id;

          return (
            <button
              key={category.id}
              id={`settings-category-${category.id}`}
              type="button"
              onClick={() => onSelectCategory(category.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 text-left ${
                isActive
                  ? 'bg-violet-600/15 text-violet-300 border border-violet-500/30 shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1c24]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon
                  size={16}
                  className={isActive ? 'text-violet-400' : 'text-gray-500'}
                />
                <span className="truncate">{category.title}</span>
              </div>

              {category.badge && (
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-semibold rounded ${
                    isActive
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                      : 'bg-[#222530] text-gray-400 border border-[#353846]'
                  }`}
                >
                  {category.badge}
                </span>
              )}
            </button>
          );
        })}

        {filteredCategories.length === 0 && (
          <div className="p-4 text-center text-xs text-gray-500">
            No settings match &ldquo;{searchQuery}&rdquo;
          </div>
        )}
      </nav>

      {/* Bottom Footer Info */}
      <div className="p-3 border-t border-[#262833] text-[11px] text-gray-500 flex items-center justify-between">
        <span>Ty-Code Settings</span>
        <span className="font-mono text-[10px] text-gray-600">v1.0.0</span>
      </div>
    </div>
  );
};
