'use client';

import React, { useMemo, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import CaseCard from '@/components/CaseCard';
import FilterBar from '@/components/FilterBar';
import SearchBar from '@/components/SearchBar';
import PaginationControls from '@/components/PaginationControls';
import { useFilters } from '@/hooks/useFilters';
import { usePagination } from '@/hooks/usePagination';
import { useSearch } from '@/hooks/useSearch';
import { retroAPI } from '@/lib/apiClient';
import styles from './retro.module.css';

const STEP_LABELS = {
  AUTH_VERIFY: 'Authorization Verify',
  POLICY_ACTIVATE: 'Policy Activate',
  APTC_CALCULATE: 'APTC Calculate',
  CSR_CONFIRM: 'CSR Confirm',
  BILLING_ADJUST: 'Billing Adjust',
};

function RetroEnrollmentsContent() {
  const router = useRouter();
  const { filters, updateFilter, clearFilters } = useFilters({});
  const { searchQuery, debouncedQuery, updateSearch, clearSearch, filterItems } = useSearch();

  // Fetch cases
  const { data, isLoading, error } = useQuery({
    queryKey: ['retroCases', filters, debouncedQuery],
    queryFn: () => retroAPI.getCases(filters),
    refetchInterval: 5000,
  });

  const cases = data?.cases || [];

  // Filter by search
  const filteredCases = useMemo(
    () => filterItems(cases, ['member_name', 'case_id']),
    [cases, debouncedQuery]
  );

  // Pagination
  const { paginatedItems, currentPage, totalPages, goToPage } = usePagination(
    filteredCases,
    20
  );

  const handleCaseClick = (caseId) => {
    router.push(`/retro-enrollments/${caseId}`);
  };

  // Calculate stats
  const stats = useMemo(() => {
    const now = new Date();
    return {
      total: cases.length,
      inProgress: cases.filter(c => c.status === 'IN_PROGRESS').length,
      completed: cases.filter(c => c.status === 'COMPLETED').length,
      urgent: cases.filter(c => {
        const deadline = new Date(c.deadline);
        const hoursRemaining = (deadline - now) / (1000 * 60 * 60);
        return hoursRemaining > 0 && hoursRemaining < 12;
      }).length,
    };
  }, [cases]);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Retroactive Enrollment Cases</h1>
          <p className={styles.subtitle}>
            Track retroactive enrollment cases with 48-hour confirmation deadline
          </p>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total Cases</span>
            <span className={styles.statValue}>{stats.total}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>In Progress</span>
            <span className={styles.statValue} style={{ color: '#3b82f6' }}>
              {stats.inProgress}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Urgent</span>
            <span className={styles.statValue} style={{ color: '#dc2626' }}>
              {stats.urgent}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Completed</span>
            <span className={styles.statValue} style={{ color: '#22c55e' }}>
              {stats.completed}
            </span>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className={styles.controls}>
        <SearchBar
          placeholder="Search by member name or case ID..."
          value={searchQuery}
          onChange={updateSearch}
          onClear={clearSearch}
        />

        <FilterBar
          filters={filters}
          onFilterChange={updateFilter}
          onClearFilters={clearFilters}
          filterOptions={{
            status: {
              label: 'Status',
              values: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
              format: (v) => v.replace(/_/g, ' '),
            },
            current_step: {
              label: 'Current Step',
              values: ['AUTH_VERIFY', 'POLICY_ACTIVATE', 'APTC_CALCULATE', 'CSR_CONFIRM', 'BILLING_ADJUST'],
              format: (v) => STEP_LABELS[v] || v,
            },
          }}
        />
      </div>

      {/* Cases List */}
      {isLoading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading cases...</p>
        </div>
      ) : error ? (
        <div className={styles.error}>
          <p>Error loading cases. Please try again.</p>
        </div>
      ) : paginatedItems.length === 0 ? (
        <div className={styles.empty}>
          <p>
            {cases.length === 0
              ? 'No retroactive enrollment cases yet.'
              : 'No cases match your filters.'}
          </p>
        </div>
      ) : (
        <>
          <div className={styles.casesList}>
            {paginatedItems.map((caseItem) => (
              <CaseCard
                key={caseItem.case_id}
                caseItem={caseItem}
                onClick={() => handleCaseClick(caseItem.case_id)}
                showDetails={true}
              />
            ))}
          </div>

          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={goToPage}
            itemsPerPage={20}
            totalItems={filteredCases.length}
          />
        </>
      )}
    </div>
  );
}

export default function RetroEnrollmentsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RetroEnrollmentsContent />
    </Suspense>
  );
}
