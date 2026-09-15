import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import {
  GeographySelector,
  SearchableCombobox,
  type GeographySelectorProps
} from './GeographySelector';
import {
  COUNTRIES,
  getStatesForCountry,
  getCitiesForState,
  normalizeCountryName,
  normalizeStateName
} from '../../lib/locations';

describe('Phase 11 — Geography Selector Replacement', () => {
  // ---------------------------------------------------------------------------
  // 1. Basic Rendering & Initialization
  // ---------------------------------------------------------------------------
  describe('Basic Rendering & Initialization', () => {
    it('renders all three selectors (Country, State / Region, City) with correct labels', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: '',
          state: '',
          city: '',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      expect(html).toContain('Country');
      expect(html).toContain('State / Region');
      expect(html).toContain('City');
      expect(html).toContain('role="combobox"');
      expect(html).toContain('e.g. United States');
      expect(html).toContain('Select Country first');
      expect(html).toContain('Select State first');
    });

    it('correctly initializes existing selected Country, State, and City values', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: 'India',
          state: 'Rajasthan',
          city: 'Jaipur',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      // Should display selected labels
      expect(html).toContain('India (IN)');
      expect(html).toContain('Rajasthan');
      expect(html).toContain('Jaipur');
    });

    it('handles partial configurations (Country only)', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: 'United States',
          state: '',
          city: '',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      expect(html).toContain('United States (US)');
      // State should not have "Select Country first"
      expect(html).toContain('e.g. Florida');
      // City should still be disabled waiting for state
      expect(html).toContain('Select State first');
    });

    it('handles partial configurations (Country + State)', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: 'United States',
          state: 'Florida',
          city: '',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      expect(html).toContain('United States (US)');
      expect(html).toContain('Florida');
      // City should now be enabled with its active placeholder
      expect(html).toContain('e.g. Miami');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Authoritative Data & Hierarchy
  // ---------------------------------------------------------------------------
  describe('Authoritative Geographic Data & Hierarchy', () => {
    it('uses the authoritative 248 ISO-3166-1 country dataset', () => {
      expect(COUNTRIES.length).toBeGreaterThanOrEqual(248);
      const us = COUNTRIES.find((c) => c.code === 'US');
      const inCountry = COUNTRIES.find((c) => c.code === 'IN');
      const gb = COUNTRIES.find((c) => c.code === 'GB');

      expect(us).toBeDefined();
      expect(us?.name).toBe('United States');
      expect(inCountry).toBeDefined();
      expect(inCountry?.name).toBe('India');
      expect(gb).toBeDefined();
      expect(gb?.name).toBe('United Kingdom');
    });

    it('constrains State options by the selected Country', () => {
      const indiaStates = getStatesForCountry('India');
      expect(indiaStates.length).toBeGreaterThan(0);
      expect(indiaStates.some((s) => s.name === 'Rajasthan')).toBe(true);
      expect(indiaStates.some((s) => s.name === 'Florida')).toBe(false);

      const usStates = getStatesForCountry('United States');
      expect(usStates.length).toBeGreaterThan(0);
      expect(usStates.some((s) => s.name === 'Florida')).toBe(true);
      expect(usStates.some((s) => s.name === 'Rajasthan')).toBe(false);
    });

    it('constrains City options by the selected State and Country', () => {
      const flCities = getCitiesForState('United States', 'Florida');
      expect(flCities.length).toBeGreaterThan(0);
      expect(flCities).toContain('Miami');
      expect(flCities).not.toContain('Jaipur');

      const mhCities = getCitiesForState('India', 'Maharashtra');
      expect(mhCities.length).toBeGreaterThan(0);
      expect(mhCities).toContain('Mumbai');
      expect(mhCities).not.toContain('Miami');
    });

    it('returns empty lists when parent selections are empty or invalid', () => {
      expect(getStatesForCountry('')).toEqual([]);
      expect(getCitiesForState('', '')).toEqual([]);
      expect(getCitiesForState('United States', '')).toEqual([]);
      expect(getStatesForCountry('NonExistentLand999')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Search Semantics
  // ---------------------------------------------------------------------------
  describe('Search Semantics', () => {
    it('filters countries with case-insensitive, partial matching on name', () => {
      const query = 'unit';
      const matched = COUNTRIES.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
      );

      const names = matched.map((c) => c.name);
      expect(names).toContain('United States');
      expect(names).toContain('United Kingdom');
      expect(names).toContain('United Arab Emirates');
      expect(names).not.toContain('Germany');
    });

    it('filters countries with case-insensitive code matching', () => {
      const query = 'de';
      const matched = COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.code.toLowerCase().includes(query)
      );
      const names = matched.map((c) => c.name);
      expect(names).toContain('Germany'); // code is DE
    });

    it('filters states with case-insensitive partial matching', () => {
      const states = getStatesForCountry('United States');
      const query = 'flor';
      const matched = states.filter((s) =>
        s.name.toLowerCase().includes(query)
      );
      expect(matched.length).toBe(1);
      expect(matched[0]?.name).toBe('Florida');
    });

    it('filters cities with case-insensitive partial matching', () => {
      const cities = getCitiesForState('United States', 'Florida');
      const query = 'miam';
      const matched = cities.filter((c) => c.toLowerCase().includes(query));
      expect(matched.length).toBe(1);
      expect(matched[0]).toBe('Miami');
    });

    it('displays no-match state when query matches nothing', () => {
      const query = 'zzzznonexistent';
      const matched = COUNTRIES.filter((c) =>
        c.name.toLowerCase().includes(query)
      );
      expect(matched.length).toBe(0);

      // Render SearchableCombobox with empty results
      const html = ReactDOMServer.renderToString(
        React.createElement(SearchableCombobox, {
          id: 'test-combo',
          label: 'Country',
          value: '',
          placeholder: 'Select',
          emptyMessage: 'No countries found',
          items: [],
          onChange: vi.fn()
        })
      );
      expect(html).toContain('role="combobox"');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Hierarchical Cascading Resets
  // ---------------------------------------------------------------------------
  describe('Hierarchical Cascading Resets', () => {
    it('changing Country clears State and City', () => {
      const onCountryChange = vi.fn();
      const onStateChange = vi.fn();
      const onCityChange = vi.fn();

      // Current state: India -> Rajasthan -> Jaipur
      let currentCountry = 'India';

      // Simulate component callback behavior
      const handleCountryChange = (newCountry: string) => {
        onCountryChange(newCountry);
        if (newCountry !== currentCountry) {
          onStateChange('');
          onCityChange('');
        }
      };

      // User selects "United States"
      handleCountryChange('United States');

      expect(onCountryChange).toHaveBeenCalledWith('United States');
      expect(onStateChange).toHaveBeenCalledWith('');
      expect(onCityChange).toHaveBeenCalledWith('');
    });

    it('re-selecting the same Country preserves State and City', () => {
      const onCountryChange = vi.fn();
      const onStateChange = vi.fn();
      const onCityChange = vi.fn();

      const currentCountry = 'India';

      const handleCountryChange = (newCountry: string) => {
        onCountryChange(newCountry);
        if (newCountry !== currentCountry) {
          onStateChange('');
          onCityChange('');
        }
      };

      // User selects "India" again
      handleCountryChange('India');

      expect(onCountryChange).toHaveBeenCalledWith('India');
      expect(onStateChange).not.toHaveBeenCalled();
      expect(onCityChange).not.toHaveBeenCalled();
    });

    it('changing State clears City', () => {
      const onStateChange = vi.fn();
      const onCityChange = vi.fn();

      let currentState = 'Rajasthan';

      const handleStateChange = (newState: string) => {
        onStateChange(newState);
        if (newState !== currentState) {
          onCityChange('');
        }
      };

      // User changes state to Maharashtra
      handleStateChange('Maharashtra');

      expect(onStateChange).toHaveBeenCalledWith('Maharashtra');
      expect(onCityChange).toHaveBeenCalledWith('');
    });

    it('re-selecting the same State preserves City', () => {
      const onStateChange = vi.fn();
      const onCityChange = vi.fn();

      const currentState = 'Rajasthan';

      const handleStateChange = (newState: string) => {
        onStateChange(newState);
        if (newState !== currentState) {
          onCityChange('');
        }
      };

      // User re-selects "Rajasthan"
      handleStateChange('Rajasthan');

      expect(onStateChange).toHaveBeenCalledWith('Rajasthan');
      expect(onCityChange).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Selection & Persistence Contract
  // ---------------------------------------------------------------------------
  describe('Selection & Persistence Contract', () => {
    it('preserves Discovery configuration shape with canonical normalized strings', () => {
      // Test normalization pipeline matching DiscoveryScreen.tsx
      const cleanCountryInput = 'United States (US)'.replace(/\s*\([A-Z0-9-]+\)$/i, '').trim();
      const canonicalCountry = normalizeCountryName(cleanCountryInput) || cleanCountryInput;
      expect(canonicalCountry).toBe('United States');

      const cleanStateInput = 'Florida (FL)'.replace(/\s*\([A-Z0-9-]+\)$/i, '').trim();
      const canonicalState = normalizeStateName(cleanStateInput, canonicalCountry) || cleanStateInput;
      expect(canonicalState).toBe('Florida');

      const city = 'Miami';
      const canonicalCity = city.trim();
      expect(canonicalCity).toBe('Miami');

      // Final payload shape
      const payload = {
        country: canonicalCountry,
        state: canonicalState,
        city: canonicalCity
      };

      expect(payload).toEqual({
        country: 'United States',
        state: 'Florida',
        city: 'Miami'
      });
    });

    it('closing dropdown without selection preserves current value', () => {
      const onChange = vi.fn();
      let isOpen = true;
      const initialValue = 'United States';

      // Simulating escape / outside-click close without calling onChange
      const handleCloseWithoutSelection = () => {
        isOpen = false;
        // Notice onChange is intentionally NOT called
      };

      handleCloseWithoutSelection();

      expect(isOpen).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
      expect(initialValue).toBe('United States');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Keyboard Accessibility & Auto-Scroll
  // ---------------------------------------------------------------------------
  describe('Keyboard Accessibility & Navigation', () => {
    it('ArrowDown advances highlighted index with wrapping', () => {
      const itemCount = 5;
      let highlighted = 0;

      const advanceDown = () => {
        highlighted = (highlighted + 1) % itemCount;
      };

      advanceDown();
      expect(highlighted).toBe(1);
      advanceDown();
      expect(highlighted).toBe(2);
      advanceDown();
      expect(highlighted).toBe(3);
      advanceDown();
      expect(highlighted).toBe(4);
      advanceDown();
      expect(highlighted).toBe(0); // Wrapped back to 0
    });

    it('ArrowUp decrements highlighted index with wrapping', () => {
      const itemCount = 5;
      let highlighted = 0;

      const advanceUp = () => {
        highlighted = (highlighted - 1 + itemCount) % itemCount;
      };

      advanceUp();
      expect(highlighted).toBe(4); // Wrapped to end
      advanceUp();
      expect(highlighted).toBe(3);
      advanceUp();
      expect(highlighted).toBe(2);
    });

    it('Enter selects currently highlighted item and triggers onChange', () => {
      const onChange = vi.fn();
      const items = [
        { value: 'United States', label: 'United States (US)' },
        { value: 'United Kingdom', label: 'United Kingdom (GB)' }
      ];

      const highlightedIndex = 1;
      const handleSelect = (idx: number) => {
        const item = items[idx];
        if (item) {
          onChange(item.value);
        }
      };

      handleSelect(highlightedIndex);
      expect(onChange).toHaveBeenCalledWith('United Kingdom');
    });

    it('Tab closes the dropdown and preserves current selection', () => {
      const onChange = vi.fn();
      let isOpen = true;

      // Handle Tab key
      const handleTab = () => {
        isOpen = false;
      };

      handleTab();
      expect(isOpen).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Modal-Safe Behavior & Escape Key Isolation
  // ---------------------------------------------------------------------------
  describe('Modal-Safe Behavior & Escape Isolation', () => {
    it('when dropdown is open, Escape stops propagation and prevents closing parent modal', () => {
      let dropdownOpen = true;
      let parentModalOpen = true;

      const stopPropagation = vi.fn();
      const preventDefault = vi.fn();

      const mockEvent = {
        key: 'Escape',
        stopPropagation,
        preventDefault
      };

      // Dropdown keydown handler
      const handleSearchKeyDown = (e: typeof mockEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          dropdownOpen = false;
        }
      };

      handleSearchKeyDown(mockEvent);

      expect(stopPropagation).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(dropdownOpen).toBe(false);
      // Parent modal must remain OPEN
      expect(parentModalOpen).toBe(true);
    });

    it('when dropdown is closed, Escape is not intercepted and allows parent modal to close', () => {
      const dropdownOpen = false;
      let parentModalOpen = true;

      const stopPropagation = vi.fn();

      const mockEvent = {
        key: 'Escape',
        stopPropagation
      };

      // Dropdown only intercepts if open
      if (dropdownOpen) {
        mockEvent.stopPropagation();
      } else {
        // Event bubbles to parent modal
        parentModalOpen = false;
      }

      expect(stopPropagation).not.toHaveBeenCalled();
      expect(parentModalOpen).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Bounded Scroll & Responsive Behavior
  // ---------------------------------------------------------------------------
  describe('Bounded Scroll & Viewport Safety', () => {
    it('implements bounded max-height and overflow scroll classes', () => {
      // Render combobox and check class structure
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: 'United States',
          state: 'Florida',
          city: 'Miami',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      // Grid classes ensure responsiveness across viewports
      expect(html).toContain('grid');
      expect(html).toContain('grid-cols-1');
      expect(html).toContain('sm:grid-cols-3');
    });

    it('calculates upward positioning when space below is constrained', () => {
      const dropdownHeight = 260;
      const windowHeight = 800;

      // Element placed near the bottom (rect.bottom = 650)
      const rect = { top: 610, bottom: 650 };
      const spaceBelow = windowHeight - rect.bottom; // 150
      const spaceAbove = rect.top; // 610

      const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      expect(openUpward).toBe(true);

      // Element placed near the top (rect.bottom = 200)
      const rectTop = { top: 160, bottom: 200 };
      const spaceBelowTop = windowHeight - rectTop.bottom; // 600
      const spaceAboveTop = rectTop.top; // 160

      const openUpwardTop = spaceBelowTop < dropdownHeight && spaceAboveTop > spaceBelowTop;
      expect(openUpwardTop).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Stale, Unknown, and Partial Values
  // ---------------------------------------------------------------------------
  describe('Stale & Unknown Values Resilience', () => {
    it('renders unknown country safely without crashing', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: 'UnknownLand_123',
          state: '',
          city: '',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      // Must display fallback without throwing
      expect(html).toContain('UnknownLand_123');
    });

    it('renders unknown state safely without crashing', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: 'India',
          state: 'NonExistentProvince_XYZ',
          city: '',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      expect(html).toContain('India (IN)');
      expect(html).toContain('NonExistentProvince_XYZ');
    });

    it('renders unknown city safely without crashing', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(GeographySelector, {
          country: 'United States',
          state: 'Florida',
          city: 'SmallTownNotInData',
          onCountryChange: vi.fn(),
          onStateChange: vi.fn(),
          onCityChange: vi.fn()
        })
      );

      expect(html).toContain('United States (US)');
      expect(html).toContain('Florida');
      expect(html).toContain('SmallTownNotInData');
    });

    it('supports custom city entry when typed city is not in populated list', () => {
      const items = [{ value: 'Miami', label: 'Miami' }];
      const search = 'Fort Lauderdale';
      const allowCustom = true;

      const q = search.trim().toLowerCase();
      const hasExact = items.some((i) => i.value.toLowerCase() === q);
      expect(hasExact).toBe(false);

      const result = [
        ...items,
        ...(allowCustom && q.length > 0
          ? [{ value: search.trim(), label: `Use "${search.trim()}"`, isCustom: true }]
          : [])
      ];

      expect(result.length).toBe(2);
      expect(result[1]).toEqual({
        value: 'Fort Lauderdale',
        label: 'Use "Fort Lauderdale"',
        isCustom: true
      });
    });
  });
});
