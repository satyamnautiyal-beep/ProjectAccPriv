/**
 * FilterBar Component
 * Displays filter controls for alerts and cases
 */

'use client';

import React from 'react';
import { X } from 'lucide-react';
import styles from './FilterBar.module.css';

export default function FilterBar({
  filters = {},
  onFilterChange,
  filterOptions = {},
  onClearFilters,
}) {
  const hasActiveFilters = Object.values(filters).some(v => v && v !== '');
  
  return (
    <div className={styles.container}>
      <div className={styles.filters}>
        {Object.entries(filterOptions).map(([key, options]) => (
          <div key={key} className={styles.filterGroup}>
            <label htmlFor={`filter-${key}`} className={styles.label}>
              {options.label}
            </label>
            <select
              id={`filter-${key}`}
              value={filters[key] || ''}
              onChange={(e) => onFilterChange(key, e.target.value)}
              className={styles.select}
            >
              <option value="">All</option>
              {options.values?.map((value) => (
                <option key={value} value={value}>
                  {options.format ? options.format(value) : value}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      
      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className={styles.clearButton}
          title="Clear all filters"
        >
          <X size={16} />
          Clear Filters
        </button>
      )}
    </div>
  );
}
