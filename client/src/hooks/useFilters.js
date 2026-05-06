/**
 * useFilters Hook
 * Manages filter state with URL persistence
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export function useFilters(defaultFilters = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(defaultFilters);
  
  // Initialize filters from URL params
  useEffect(() => {
    const urlFilters = {};
    searchParams.forEach((value, key) => {
      urlFilters[key] = value;
    });
    
    if (Object.keys(urlFilters).length > 0) {
      setFilters(prev => ({ ...prev, ...urlFilters }));
    }
  }, [searchParams]);
  
  // Update filter and URL
  const updateFilter = useCallback((key, value) => {
    setFilters(prev => {
      const updated = { ...prev, [key]: value };
      
      // Update URL
      const params = new URLSearchParams();
      Object.entries(updated).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, v);
        }
      });
      
      const queryString = params.toString();
      router.push(queryString ? `?${queryString}` : '');
      
      return updated;
    });
  }, [router]);
  
  // Update multiple filters at once
  const updateFilters = useCallback((newFilters) => {
    setFilters(prev => {
      const updated = { ...prev, ...newFilters };
      
      // Update URL
      const params = new URLSearchParams();
      Object.entries(updated).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, v);
        }
      });
      
      const queryString = params.toString();
      router.push(queryString ? `?${queryString}` : '');
      
      return updated;
    });
  }, [router]);
  
  // Clear all filters
  const clearFilters = useCallback(() => {
    setFilters(defaultFilters);
    router.push('');
  }, [defaultFilters, router]);
  
  // Clear specific filter
  const clearFilter = useCallback((key) => {
    setFilters(prev => {
      const updated = { ...prev };
      delete updated[key];
      
      // Update URL
      const params = new URLSearchParams();
      Object.entries(updated).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, v);
        }
      });
      
      const queryString = params.toString();
      router.push(queryString ? `?${queryString}` : '');
      
      return updated;
    });
  }, [router]);
  
  return {
    filters,
    updateFilter,
    updateFilters,
    clearFilter,
    clearFilters,
  };
}
