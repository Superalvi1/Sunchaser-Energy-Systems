/**
 * Property address input with optional Google Places autocomplete (feature-flagged).
 * Draft-only. No CRM save. Falls back to plain text when provider unavailable.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  fetchAddressSuggestions,
  isPlacesAutocompleteConfigured,
  resolvePlaceSuggestion,
  type PlaceSuggestion,
} from "../../lib/designStudioMapProviders";
import type { LocatePropertyResult } from "../../lib/designStudioMapProviders";

export interface PropertyAddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceResolved: (result: LocatePropertyResult) => void;
  placeholder?: string;
  className?: string;
}

export default function PropertyAddressAutocomplete({
  value,
  onChange,
  onPlaceResolved,
  placeholder = "Street, area, city",
  className = "",
}: PropertyAddressAutocompleteProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const placesEnabled = (() => {
    try {
      return isPlacesAutocompleteConfigured();
    } catch {
      return false;
    }
  })();

  const loadSuggestions = useCallback(
    (input: string) => {
      if (!placesEnabled) {
        setSuggestions([]);
        setSuggestError(null);
        return;
      }
      void fetchAddressSuggestions(input).then((result) => {
        if (!result.ok) {
          setSuggestions([]);
          setSuggestError(result.message);
          return;
        }
        setSuggestError(null);
        setSuggestions(result.value);
        setOpen(result.value.length > 0);
      });
    },
    [placesEnabled]
  );

  useEffect(() => {
    if (!placesEnabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadSuggestions(value), 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, placesEnabled, loadSuggestions]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pickSuggestion = (suggestion: PlaceSuggestion) => {
    setOpen(false);
    setSuggestions([]);
    onChange(suggestion.description);
    setResolving(true);
    void resolvePlaceSuggestion(suggestion.placeId).then((result) => {
      setResolving(false);
      onPlaceResolved(result);
    });
  };

  return (
    <div ref={rootRef} className={`relative ${className}`} data-testid="property-address-autocomplete">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete={placesEnabled ? "list" : "none"}
        aria-controls={placesEnabled ? listId : undefined}
        aria-expanded={placesEnabled && open}
        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white"
        data-testid="property-location-address-input"
      />
      {placesEnabled && open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 shadow-xl"
          data-testid="property-address-suggestions"
        >
          {suggestions.map((s) => (
            <li key={s.placeId} role="option">
              <button
                type="button"
                className="w-full px-2 py-1.5 text-left text-[11px] text-slate-200 hover:bg-slate-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSuggestion(s)}
              >
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      )}
      {resolving && (
        <p className="mt-1 text-[9px] text-slate-400" data-testid="property-address-resolving">
          Resolving place…
        </p>
      )}
      {suggestError && (
        <p className="mt-1 text-[10px] text-rose-400" data-testid="property-address-suggest-error" role="alert">
          {suggestError}
        </p>
      )}
      {!placesEnabled && (
        <p className="sr-only" data-testid="places-autocomplete-unavailable">
          Places autocomplete unavailable
        </p>
      )}
    </div>
  );
}
