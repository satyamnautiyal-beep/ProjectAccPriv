'use client';

import React, { useMemo, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import AlertCard from '@/components/AlertCard';
import FilterBar from '@/components/FilterBar';
import SearchBar from '@/components/SearchBar';
import PaginationControls from '@/components/PaginationControls';
import { useFilters } from '@/hooks/useFilters';
import { usePagination } from '@/hooks/usePagination';
import { useSearch } from '@/hooks/useSearch';
import { renewalAPI } from '@/lib/apiClient';
import styles from './renewals.module.css';

function RenewalsContent() {
  const router = useRouter();
  const { filters, updateFilter, clearFilters } = useFilters({});
  const { searchQuery, debouncedQuery, updateSearch, clearSearch, filterItems } = useSearch();

  // Fetch alerts
  const { data, isLoading, error } = useQuery({
    queryKey: ['renewalAlerts', filters, debouncedQuery],
    queryFn: () => renewalAPI.getAlerts(filters),
    refetchInterval: 5000,
  });

  const alerts = data?.alerts || [];

  // Filter by search
  const filteredAlerts = useMemo(
    () => filterItems(alerts, ['member_name', 'case_id']),
    [alerts, debouncedQuery]
  );

  // Pagination
  const { paginatedItems, currentPage, totalPages, goToPage } = usePagination(
    filteredAlerts,
    20
  );

  const handleAlertClick = (caseId) => {
    router.push(`/renewals/${caseId}`);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Premium Change Alerts</h1>
          <p className={styles.subtitle}>
            Review and manage renewal premium change alerts
          </p>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total Alerts</span>
            <span className={styles.statValue}>{alerts.length}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>High Priority</span>
            <span className={styles.statValue} style={{ color: '#dc2626' }}>
              {alerts.filter(a => a.priority === 'HIGH').length}
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
            priority: {
              label: 'Priority',
              values: ['HIGH', 'MEDIUM', 'LOW'],
            },
            status: {
              label: 'Status',
              values: ['AWAITING_SPECIALIST', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
              format: (v) => v.replace(/_/g, ' '),
            },
          }}
        />
      </div>

      {/* Alerts List */}
      {isLoading ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading alerts...</p>
        </div>
      ) : error ? (
        <div className={styles.error}>
          <p>Error loading alerts. Please try again.</p>
        </div>
      ) : paginatedItems.length === 0 ? (
        <div className={styles.empty}>
          <p>
            {alerts.length === 0
              ? 'No alerts found. Upload renewal files to get started.'
              : 'No alerts match your filters.'}
          </p>
        </div>
      ) : (
        <>
          <div className={styles.alertsList}>
            {paginatedItems.map((alert) => (
              <AlertCard
                key={alert.case_id}
                alert={alert}
                onClick={() => handleAlertClick(alert.case_id)}
                showDetails={true}
              />
            ))}
          </div>

          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={goToPage}
            itemsPerPage={20}
            totalItems={filteredAlerts.length}
          />
        </>
      )}
    </div>
  );
}

export default function RenewalsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RenewalsContent />
    </Suspense>
  );
}
