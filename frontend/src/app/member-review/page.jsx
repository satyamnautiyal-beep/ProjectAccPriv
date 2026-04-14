'use client';

import React, { useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { useQuery } from '@tanstack/react-query';

export default function MemberReviewPage() {
  const [filter, setFilter] = useState('All');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => fetch('/api/members').then(res => res.json()),
    refetchInterval: 2000
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Ready': 
        return <span className={`${styles.badge} ${styles.approved}`}><span style={{marginRight: '4px'}}>🟢</span> Ready</span>;
      case 'Awaiting Input': 
      case 'Needs Clarification': // fallback for old data
        return <span className={`${styles.badge} ${styles.pending}`}><span style={{marginRight: '4px'}}>🟡</span> Awaiting Input</span>;
      case 'Under Review': 
        return <span className={styles.badge} style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)'}}><span style={{marginRight: '4px'}}>⚪</span> Under Review</span>;
      case 'Cannot Process': 
        return <span className={styles.badge} style={{backgroundColor: 'var(--danger-light)', color: 'var(--danger)'}}><span style={{marginRight: '4px'}}>🔴</span> Cannot Process</span>;
      default: 
        return <span className={styles.badge}>{status}</span>;
    }
  };

  const getActionNeeded = (status) => {
    if (status === 'Needs Clarification' || status === 'Awaiting Input') {
      return <span style={{fontWeight: 500, color: 'var(--primary)', cursor: 'pointer', display: 'inline-block', borderBottom: '1px dashed var(--primary)'}}>Provide Info</span>;
    }
    if (status === 'Cannot Process') {
      return <span style={{fontWeight: 500, color: 'var(--danger)'}}>Reject / Route</span>;
    }
    if (status === 'Under Review') {
      return <span style={{color: 'var(--text-muted)'}}>Automated Check...</span>;
    }
    return <span style={{color: 'var(--text-muted)'}}>—</span>;
  };

  const filteredMembers = filter === 'All' 
    ? members 
    : members.filter(m => {
        // Handle alias mapping for old Needs Clarification data
        if (filter === 'Awaiting Input' && m.status === 'Needs Clarification') return true;
        return m.status === filter;
      });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Member Review</h1>
          <p className={styles.subtitle}>Extracted members categorized purely by business readiness state.</p>
        </div>
      </div>

      <Annotation
        title="Columns"
        what="structured data"
        why="improves scanning and speed"
        how="Restricts columns to only Name, Type, and Status to avoid overwhelming users with underlying X12 payload data."
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h2 className={styles.cardTitle}>Member Extraction Log</h2>
            <div>
              <select 
                value={filter} 
                onChange={(e) => setFilter(e.target.value)}
                style={{padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)'}}
              >
                <option value="All">All Statuses</option>
                <option value="Ready">Ready</option>
                <option value="Awaiting Input">Awaiting Input</option>
                <option value="Under Review">Under Review</option>
                <option value="Cannot Process">Cannot Process</option>
              </select>
            </div>
          </div>
          
          <Annotation
            title="Table"
            what="central data view"
            why="placed for focus and readability"
            how="Centers the most important triage actions directly into the viewport."
          >
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Member Name</th>
                    <th>Enrollment Type</th>
                    <th>Status</th>
                    <th>Action Needed</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && <tr><td colSpan="4" style={{textAlign: 'center', padding: 'var(--space-6)'}}>Loading extracted members...</td></tr>}
                  {!isLoading && filteredMembers.length === 0 && <tr><td colSpan="4" style={{textAlign: 'center', padding: 'var(--space-6)'}}>No members align with this status.</td></tr>}
                  
                  <Annotation
                    title="Status Badges"
                    what="simplify decision-making"
                    why="reduce complexity"
                    how="Translates complex errors into simple colored traffic-light orbs requiring no technical translation."
                  >
                    {filteredMembers.slice(0, 150).map(member => (
                      <tr key={member.id}>
                        <td>
                          <div style={{display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500}}>
                            {member.name}
                          </div>
                        </td>
                        <td>{member.enrollmentType || 'New Enrollment'}</td>
                        <td>{getStatusBadge(member.status)}</td>
                        <td>{getActionNeeded(member.status)}</td>
                      </tr>
                    ))}
                  </Annotation>
                </tbody>
              </table>
            </div>
          </Annotation>
        </div>
      </Annotation>
    </div>
  );
}
