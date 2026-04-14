'use client';

import React from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { useQuery } from '@tanstack/react-query';

export default function EnrollmentMonitoringPage() {
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(res => res.json()),
    refetchInterval: 2000
  });

  const activeBatches = batches.filter(b => b.status === 'In Progress' || b.status === 'Completed');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Enrollment Monitoring</h1>
          <p className={styles.subtitle}>Track batches submitted to carriers.</p>
        </div>
      </div>

      <Annotation
        title="Progression Visualization"
        what="Tracking table showing percent completion for active enrollments."
        why="Provides leadership confidence by showing exactly where data is in the transition phase to the carrier."
        how="Uses progress bars instead of raw EDI logs for an intuitive UX."
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Active & Completed Submissions</h2>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>Submission Date</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan="4">Loading...</td></tr>}
              {!isLoading && activeBatches.length === 0 && <tr><td colSpan="4">No active or completed batches yet.</td></tr>}
              {activeBatches.map(row => (
                <tr key={row.id}>
                  <td style={{fontWeight: 600}}>{row.id}</td>
                  <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td style={{minWidth: '200px'}}>
                    <div style={{width: '100%', height: '8px', backgroundColor: 'var(--border)', borderRadius: 'var(--radius-full)', overflow: 'hidden'}}>
                      <div style={{width: `${row.progress}%`, height: '100%', transition: 'width 0.5s ease', backgroundColor: row.progress === 100 ? 'var(--success)' : 'var(--primary)'}}></div>
                    </div>
                    <div style={{fontSize: '0.75rem', marginTop: '4px', textAlign: 'right'}}>{row.progress}%</div>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${row.progress === 100 ? styles.approved : styles.review}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Annotation>
    </div>
  );
}
