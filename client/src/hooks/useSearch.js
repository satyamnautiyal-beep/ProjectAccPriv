/**
 * useSearch Hook
 * Manages search state with debouncing
 */

import { useState, useCallback, useEffect } from 'react';

export function useSearch(debounceMs = 300) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, debounceMs);
    
    return () => clearTimeout(timer);
  }, [searchQuery, debounceMs]);
  
  // Update search query
  const updateSearch = useCallback((query) => {
    setSearchQuery(query);
  }, []);
  
  // Clear search
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedQuery('');
  }, []);
  
  // Filter items by search query
  const filterItems = useCallback((items, searchFields = []) => {
    if (!debouncedQuery || searchFields.length === 0) {
      return items;
    }
    
    const query = debouncedQuery.toLowerCase();
    return items.filter(item => {
      return searchFields.some(field => {
        const value = item[field];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(query);
      });
    });
  }, [debouncedQuery]);
  
  return {
    searchQuery,
    debouncedQuery,
    updateSearch,
    clearSearch,
    filterItems,
    isSearching: searchQuery !== debouncedQuery,
  };
}
