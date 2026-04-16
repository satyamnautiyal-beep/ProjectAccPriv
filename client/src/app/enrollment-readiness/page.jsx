'use client';

import React, { useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { useQuery } from '@tanstack/react-query';

export default function EnrollmentReadinessPage() {
  const [filter, setFilter] = useState('All');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => fetch('/api/members').then(res => res.json()),
    refetchInterval: 2000
  });

  // Backend statuses are Ready, Awaiting Input, Under Review, Cannot Process
  // We alias them to Ready, Pending, and Blocked on the client for these views specifically.
  const ready = members.filter(m => m.status === 'Ready');
  const pending = members.filter(m => m.status === 'Needs Clarification' || m.status === 'Awaiting Input' || m.status === 'Under Review');
  const blocked = members.filter(m => m.status === 'Cannot Process');

  const getStatusBadge = (status) => {
    // UI Label Mapping bridging backend states into the 3 simple states requested
    let uiLabel = status;
    let badgeStyle = styles.badge;

    if (status === 'Ready') {
      uiLabel = 'Ready';
      badgeStyle = `${styles.badge} ${styles.approved}`;
    } else if (status === 'Needs Clarification' || status === 'Awaiting Input' || status === 'Under Review') {
      uiLabel = 'Pending';
      badgeStyle = `${styles.badge} ${styles.pending}`;
    } else if (status === 'Cannot Process') {
      uiLabel = 'On Hold';
      badgeStyle = styles.badge; // Add custom inline style below
    }

    return (
      <span className={badgeStyle} style={uiLabel === 'On Hold' ? {backgroundColor: 'var(--danger-light)', color: 'var(--danger)'} : {}}>
        {uiLabel}
      </span>
    );
  };

  const getFilteredList = () => {
    if (filter === 'Ready') return ready;
    if (filter === 'Pending') return pending;
    if (filter === 'Blocked') return blocked;
    return [...ready, ...pending, ...blocked];
  };

  const filteredMembers = getFilteredList();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Enrollment Readiness</h1>
        </div>
      </div>

      <Annotation
        title="Summary tiles"
        what="quick overview"
        why="placed at top for instant visibility"
        how="Counts exact system totals automatically eliminating manual tracker sheets."
      >
        <div className={styles.kpiGrid} style={{gridTemplateColumns: 'repeat(3, 1fr)'}}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span style={{fontSize: '1.2rem', fontWeight: 600}}>✅ Ready</span>
            </div>
            <div className={styles.kpiValue}>{ready.length}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span style={{fontSize: '1.2rem', fontWeight: 600}}>⏸️ Pending</span>
            </div>
            <div className={styles.kpiValue}>{pending.length}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span style={{fontSize: '1.2rem', fontWeight: 600}}>🚫 Blocked</span>
            </div>
            <div className={styles.kpiValue}>{blocked.length}</div>
          </div>
        </div>
      </Annotation>

      <Annotation
        title="Table"
        what="detailed breakdown"
        why="supports deeper review"
        how="Pulls all members dynamically, letting supervisors know exactly who is in the Ready pool for batches."
      >
        <div className={styles.sectionCard} style={{marginTop: 'var(--space-6)'}}>
          <div className={styles.cardHeader} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h2 className={styles.cardTitle}>Member Readiness Roster</h2>
            <div>
              <select 
                value={filter} 
                onChange={(e) => setFilter(e.target.value)}
                style={{padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)'}}
              >
                <option value="All">View All</option>
                <option value="Ready">Ready Only</option>
                <option value="Pending">Pending Only</option>
                <option value="Blocked">Blocked Only</option>
              </select>
            </div>
          </div>
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Member Name</th>
                  <Annotation
                    title="Status labels"
                    what="simplify decision-making"
                    why="reduce confusion"
                    how="Colors align globally to prevent misinterpreting blocks."
                  >
                    <th>Enrollment Status</th>
                  </Annotation>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan="2" style={{textAlign: 'center', padding: 'var(--space-6)'}}>Loading...</td></tr>}
                {!isLoading && filteredMembers.length === 0 && <tr><td colSpan="2" style={{textAlign: 'center', padding: 'var(--space-6)'}}>No members matching criteria.</td></tr>}
                {filteredMembers.slice(0, 150).map((member, i) => (
                  <tr key={`${member.id}-${i}`}>
                    <td style={{fontWeight: 500}}>{member.name}</td>
                    <td>{getStatusBadge(member.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Annotation>
    </div>
  );
}
