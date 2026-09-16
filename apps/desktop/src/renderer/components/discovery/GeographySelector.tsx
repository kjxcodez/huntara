import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  COUNTRIES,
  getStatesForCountry,
  getCitiesForState,
  type CountryOption,
  type StateOption
} from '../../lib/locations';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { cn } from '../../../shared/utils/cn';

export interface GeographySelectorProps {
  country: string;
  state: string;
  city: string;
  onCountryChange: (country: string) => void;
  onStateChange: (state: string) => void;
  onCityChange: (city: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  idPrefix?: string;
}

interface ComboboxItem {
  value: string;
  label: string;
  subtitle?: string;
  isCustom?: boolean;
}

interface SearchableComboboxProps {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  placeholder: string;
  emptyMessage: string;
  items: ComboboxItem[];
  disabled?: boolean;
  allowCustom?: boolean;
  customPromptPrefix?: string;
  onChange: (value: string) => void;
  searchPlaceholder?: string;
}

export function SearchableCombobox({
  id,
  label,
  required = false,
  value,
  placeholder,
  emptyMessage,
  items,
  disabled = false,
  allowCustom = false,
  customPromptPrefix = 'Use',
  onChange,
  searchPlaceholder = 'Search...'
}: SearchableComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;

    const matched = items.filter((item) => {
      const labelMatch = item.label.toLowerCase().includes(q);
      const valMatch = item.value.toLowerCase().includes(q);
      const subMatch = item.subtitle ? item.subtitle.toLowerCase().includes(q) : false;
      return labelMatch || valMatch || subMatch;
    });

    // If custom entries are allowed and the typed search is not an exact match to any existing item
    if (allowCustom && q.length > 0) {
      const hasExactMatch = items.some(
        (i) => i.value.toLowerCase() === q || i.label.toLowerCase() === q
      );
      if (!hasExactMatch) {
        const trimmed = search.trim();
        return [
          ...matched,
          {
            value: trimmed,
            label: `${customPromptPrefix} "${trimmed}"`,
            isCustom: true
          }
        ];
      }
    }

    return matched;
  }, [items, search, allowCustom, customPromptPrefix]);

  // Keep highlighted index in bounds
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredItems.length]);

  // Handle opening and positioning
  const handleOpen = useCallback(() => {
    if (disabled) return;

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = 260; // Estimated height of dropdown
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < dropdownHeight && spaceAbove > spaceBelow);
    }

    setSearch('');
    setHighlightedIndex(0);
    setIsOpen(true);
  }, [disabled]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setSearch('');
    triggerRef.current?.focus();
  }, []);

  // Auto-focus search input when opened
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 20);
    return () => {
      clearTimeout(timer);
    };
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
    };
  }, [isOpen]);

  // Ensure highlighted element is visible in scroll list
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const optionEl = listRef.current.querySelector(
      `[data-index="${highlightedIndex}"]`
    ) as HTMLElement | null;
    if (optionEl) {
      optionEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  // Handle keyboard navigation in search input
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (filteredItems.length ? (prev + 1) % filteredItems.length : 0));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        filteredItems.length ? (prev - 1 + filteredItems.length) % filteredItems.length : 0
      );
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems.length > 0 && highlightedIndex < filteredItems.length) {
        const selected = filteredItems[highlightedIndex];
        if (selected) {
          onChange(selected.value);
          handleClose();
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      // CRITICAL: Stop propagation so parent dialog/modal does NOT close
      e.stopPropagation();
      e.preventDefault();
      handleClose();
      return;
    }

    if (e.key === 'Tab') {
      // Allow tab to close dropdown and move to next control
      setIsOpen(false);
      setSearch('');
    }
  };

  // Handle keyboard events on trigger button
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      handleOpen();
    }
  };

  // Find display text for the trigger
  const displayLabel = useMemo(() => {
    if (!value) return '';
    const match = items.find((i) => i.value === value || i.label === value);
    if (match) return match.label;
    // Stale or unknown value fallback — safely display value as-is
    return value;
  }, [value, items]);

  const listboxId = `${id}-listbox`;

  return (
    <div ref={containerRef} className="space-y-1 relative w-full">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-semibold">
          {label} {required && <span className="text-danger">*</span>}
        </Label>
      </div>

      <div className="relative">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-label={label}
          aria-required={required}
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              handleClose();
            } else {
              handleOpen();
            }
          }}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            'w-full h-8 px-2.5 flex items-center justify-between text-left text-xs bg-card border border-border-subtle rounded-none transition-colors select-none outline-hidden focus:ring-1 focus:ring-primary focus:border-primary',
            disabled && 'opacity-50 cursor-not-allowed bg-muted/20',
            !disabled && 'hover:bg-surface-3/60 cursor-pointer',
            !displayLabel && 'text-muted-foreground',
            displayLabel && 'text-foreground'
          )}
        >
          <span className="truncate pr-1">{displayLabel || placeholder}</span>
          <div className="flex items-center gap-1 shrink-0 ml-1">
            {value && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Clear ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('');
                }}
                className="text-muted-foreground hover:text-foreground p-0.5"
              >
                <X className="w-3 h-3" />
              </span>
            )}
            <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
          </div>
        </button>

        {isOpen && (
          <div
            className={cn(
              'absolute z-50 left-0 w-full min-w-[220px] bg-card border border-border-subtle rounded-none shadow-xl p-1',
              openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
            )}
          >
            {/* Search Input Bar */}
            <div className="relative mb-1">
              <Search className="w-3 h-3 absolute left-2 top-2.5 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchInputRef}
                type="text"
                value={search}
                placeholder={searchPlaceholder}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="h-7 pl-7 pr-2 text-xs rounded-none bg-background border-border-subtle font-mono focus:ring-1 focus:ring-primary"
                role="searchbox"
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-activedescendant={
                  filteredItems.length > 0 && highlightedIndex < filteredItems.length
                    ? `${listboxId}-option-${highlightedIndex}`
                    : undefined
                }
              />
            </div>

            {/* Scrollable Items List */}
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-56 overflow-y-auto no-scrollbar divide-y divide-border-subtle/30"
            >
              {filteredItems.length === 0 ? (
                <div className="py-4 px-3 text-center text-xs text-muted-foreground">
                  {emptyMessage}
                </div>
              ) : (
                filteredItems.map((item, index) => {
                  const isSelected = item.value === value;
                  const isHighlighted = index === highlightedIndex;

                  return (
                    <div
                      key={`${item.value}-${index}`}
                      id={`${listboxId}-option-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(item.value);
                        handleClose();
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={cn(
                        'px-2 py-1.5 text-xs flex items-center justify-between cursor-pointer select-none transition-colors rounded-none',
                        isHighlighted && 'bg-surface-3 text-primary',
                        !isHighlighted && 'text-foreground hover:bg-surface-3/50',
                        isSelected && 'font-semibold',
                        item.isCustom && 'italic text-primary'
                      )}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{item.label}</span>
                        {item.subtitle && !item.isCustom && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * GeographySelector — Hierarchical, searchable, keyboard-accessible country → state → city selector.
 * Preserves existing local geographic database and Discovery configuration contract.
 */
export function GeographySelector({
  country,
  state,
  city,
  onCountryChange,
  onStateChange,
  onCityChange,
  disabled = false,
  required = true,
  className,
  idPrefix = 'geo'
}: GeographySelectorProps) {
  // 1. Authoritative 248 Countries
  const countryItems: ComboboxItem[] = useMemo(() => {
    return COUNTRIES.map((c: CountryOption) => ({
      value: c.name,
      label: `${c.name} (${c.code})`,
      subtitle: c.code
    }));
  }, []);

  // 2. States / Regions filtered by Country
  const stateItems: ComboboxItem[] = useMemo(() => {
    if (!country) return [];
    const states = getStatesForCountry(country);
    return states.map((s: StateOption) => ({
      value: s.name,
      label: s.code ? `${s.name} (${s.code})` : s.name,
      subtitle: s.code
    }));
  }, [country]);

  // 3. Populated Cities filtered by State
  const cityItems: ComboboxItem[] = useMemo(() => {
    if (!country || !state) return [];
    const cities = getCitiesForState(country, state);
    return cities.map((cName: string) => ({
      value: cName,
      label: cName
    }));
  }, [country, state]);

  // Cascading reset: country changes clear state and city
  const handleCountryChange = useCallback(
    (newCountry: string) => {
      onCountryChange(newCountry);
      if (newCountry !== country) {
        onStateChange('');
        onCityChange('');
      }
    },
    [country, onCountryChange, onStateChange, onCityChange]
  );

  // Cascading reset: state changes clear city
  const handleStateChange = useCallback(
    (newState: string) => {
      onStateChange(newState);
      if (newState !== state) {
        onCityChange('');
      }
    },
    [state, onStateChange, onCityChange]
  );

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-3 gap-2', className)}>
      {/* 1. Country Selector */}
      <SearchableCombobox
        id={`${idPrefix}-country`}
        label="Country"
        required={required}
        value={country}
        placeholder="e.g. United States"
        emptyMessage="No countries found"
        searchPlaceholder="Search country..."
        items={countryItems}
        disabled={disabled}
        onChange={handleCountryChange}
      />

      {/* 2. State / Region Selector */}
      <SearchableCombobox
        id={`${idPrefix}-state`}
        label="State / Region"
        required={required}
        value={state}
        placeholder={country ? 'e.g. Florida' : 'Select Country first'}
        emptyMessage="No states/regions found"
        searchPlaceholder="Search state / region..."
        items={stateItems}
        disabled={disabled || !country}
        allowCustom={true}
        customPromptPrefix="Use"
        onChange={handleStateChange}
      />

      {/* 3. City Selector */}
      <SearchableCombobox
        id={`${idPrefix}-city`}
        label="City"
        required={false}
        value={city}
        placeholder={state ? 'e.g. Miami' : 'Select State first'}
        emptyMessage="No populated cities listed"
        searchPlaceholder="Search city..."
        items={cityItems}
        disabled={disabled || !state}
        allowCustom={true}
        customPromptPrefix="Use"
        onChange={onCityChange}
      />
    </div>
  );
}

export default GeographySelector;
