/**
 * SearchBar Component
 * Displays search input with debouncing
 */

'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import styles from './SearchBar.module.css';

export default function SearchBar({
  placeholder = 'Search...',
  value = '',
  onChange,
  onClear,
  debounceMs = 300,
}) {
  const handleChange = (e) => {
    onChange(e.target.value);
  };
  
  const handleClear = () => {
    onClear?.();
  };
  
  return (
    <div className={styles.container}>
      <Search size={18} className={styles.icon} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        className={styles.input}
      />
      {value && (
        <button
          onClick={handleClear}
          className={styles.clearButton}
          title="Clear search"
          type="button"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}
