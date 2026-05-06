/**
 * PaginationControls Component
 * Displays pagination controls
 */

'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './PaginationControls.module.css';

export default function PaginationControls({
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  itemsPerPage = 20,
  totalItems = 0,
}) {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  
  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };
  
  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };
  
  const handlePageInput = (e) => {
    const page = parseInt(e.target.value, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };
  
  return (
    <div className={styles.container}>
      <div className={styles.info}>
        {totalItems > 0 ? (
          <p className={styles.text}>
            Showing <strong>{startItem}</strong> to <strong>{endItem}</strong> of{' '}
            <strong>{totalItems}</strong> items
          </p>
        ) : (
          <p className={styles.text}>No items to display</p>
        )}
      </div>
      
      <div className={styles.controls}>
        <button
          onClick={handlePrevious}
          disabled={currentPage === 1}
          className={styles.button}
          title="Previous page"
        >
          <ChevronLeft size={18} />
          Previous
        </button>
        
        <div className={styles.pageInput}>
          <label htmlFor="page-input" className={styles.label}>
            Page
          </label>
          <input
            id="page-input"
            type="number"
            min="1"
            max={totalPages}
            value={currentPage}
            onChange={handlePageInput}
            className={styles.input}
          />
          <span className={styles.total}>of {totalPages}</span>
        </div>
        
        <button
          onClick={handleNext}
          disabled={currentPage === totalPages}
          className={styles.button}
          title="Next page"
        >
          Next
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
