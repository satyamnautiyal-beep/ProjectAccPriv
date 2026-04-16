'use client';

import React from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { MessageSquare, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function ClarificationsPage() {
  const queryClient = useQueryClient();

  const { data: clarifications = [], isLoading } = useQuery({
    queryKey: ['clarifications'],
    queryFn: () => fetch('/api/clarifications').then(res => res.json()),
    refetchInterval: 2000
  });

  const resolveMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch('/api/clarifications', {
        method: 'PATCH',
        body: JSON.stringify({ id }),
        headers: { 'Content-Type': 'application/json' }
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clarifications'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    }
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Awaiting Response': return <span className={`${styles.badge} ${styles.pending}`}>{status}</span>; // yellow
      case 'Response Received': return <span className={`${styles.badge} ${styles.review}`} style={{backgroundColor: 'var(--primary-light)', color: 'var(--primary)'}}>{status}</span>; // explicit blue
      case 'Resolved': return <span className={`${styles.badge} ${styles.approved}`}>{status}</span>; // green
      default: return <span className={styles.badge}>{status}</span>;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Clarifications</h1>
        </div>
      </div>

      <Annotation
        title="Table"
        what="central tracking view"
        why="improves clarity"
        how="Provides a single unified screen to isolate all exceptions requiring action."
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Active Inquiries</h2>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Member Name</th>
                <th>
                  <Annotation
                    title="Issue type column"
                    what="highlights required action"
                    why="improves efficiency"
                    how="Lets admins immediately know what specific data is blocking enrollment."
                  >
                    Clarification Needed
                  </Annotation>
                </th>
                <th>
                  <Annotation
                    title="Status column"
                    what="shows progress"
                    why="helps decision-making"
                    how="Signals which items are blocked vs ready for resolution."
                  >
                    Status
                  </Annotation>
                </th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan="4" style={{textAlign: 'center', padding: 'var(--space-6)'}}>Loading clarifications...</td></tr>}
              {!isLoading && clarifications.length === 0 && <tr><td colSpan="4" style={{textAlign: 'center', padding: 'var(--space-6)'}}>No pending clarifications! System is clean.</td></tr>}
              {clarifications.map(item => (
                <tr key={item.id}>
                  <td style={{fontWeight: 500}}>{item.memberName}</td>
                  <td>{item.issueType}</td>
                  <td>{getStatusBadge(item.status)}</td>
                  <td>
                    {item.status !== 'Resolved' ? (
                      <button 
                        className={styles.viewAll} 
                        style={{display: 'flex', alignItems: 'center', gap: '4px', opacity: resolveMutation.isPending ? 0.5 : 1}}
                        onClick={() => resolveMutation.mutate(item.id)}
                        disabled={resolveMutation.isPending}
                      >
                        <MessageSquare size={14} /> {item.status === 'Awaiting Response' ? 'Simulate Response' : 'Mark Resolved'}
                      </button>
                    ) : (
                      <span style={{color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px'}}><Check size={14}/> Ready for Enrollment</span>
                    )}
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
