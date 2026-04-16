'use client';

import React from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { CheckCircle, PauseCircle, Package, Users, Calendar } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

export default function ApprovalPage() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(res => res.json()),
    refetchInterval: 2000
  });

  const generateApprovalMutation = useMutation({
    mutationFn: async ({ id, action }) => {
      const res = await fetch('/api/approve-batch', {
        method: 'POST',
        body: JSON.stringify({ id, action }),
        headers: { 'Content-Type': 'application/json' }
      });
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      if (variables.action === 'approve') {
        router.push('/enrollment-monitoring');
      }
    }
  });

  const awaiting = batches.filter(b => b.status === 'Awaiting Approval');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Batch Approval</h1>
          <p className={styles.subtitle}>Admins review before enrollment is triggered</p>
        </div>
      </div>

      <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', alignItems: 'center'}}>
        {isLoading && <div style={{padding: 'var(--space-6)', textAlign: 'center'}}>Loading batches for approval...</div>}
        {!isLoading && awaiting.length === 0 && <div className={styles.sectionCard} style={{padding: 'var(--space-6)', textAlign: 'center', width: '100%', maxWidth: '800px'}}>No batches are awaiting approval right now.</div>}
        
        {awaiting.map(batch => (
          <Annotation
            key={batch.id}
            title="Summary card"
            what="key decision info"
            why="centered for focus"
            how="Filters out massive technical spreadsheets down to a single card allowing leadership to sign off safely."
          >
            <div className={styles.sectionCard} style={{maxWidth: '800px', width: '100vw'}}>
              <div className={styles.cardHeader} style={{backgroundColor: 'var(--primary-light)'}}>
                <h2 className={styles.cardTitle} style={{color: 'var(--primary)'}}>Pending Approval Sequence: {batch.id}</h2>
              </div>
              
              <div style={{padding: 'var(--space-8)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', borderBottom: '1px solid var(--border)'}}>
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '8px'}}>
                  <Users size={32} color="var(--primary)" />
                  <div style={{fontSize: '2.5rem', fontWeight: 700}}>{batch.membersCount}</div>
                  <div style={{fontSize: '1rem', color: 'var(--text-muted)'}}>Total Members</div>
                </div>
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '8px', justifyContent: 'center'}}>
                  <Package size={32} color="var(--primary)" />
                  <div style={{display: 'flex', flexDirection: 'column', padding: '0 16px', gap: '4px'}}>
                    {batch.types ? (
                      batch.types.split(', ').map((typeStr, i) => (
                        <div key={i} style={{fontSize: '1.1rem', fontWeight: 600}}>{typeStr}</div>
                      ))
                    ) : (
                      <div style={{fontSize: '1.25rem', fontWeight: 600}}>Mixed Segment</div>
                    )}
                  </div>
                  <div style={{fontSize: '1rem', color: 'var(--text-muted)'}}>Enrollment Types</div>
                </div>
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '8px', justifyContent: 'center'}}>
                  <Calendar size={32} color="var(--primary)" />
                  <div style={{fontSize: '1.25rem', fontWeight: 600}}>{new Date(batch.createdAt).toLocaleDateString()}</div>
                  <div style={{fontSize: '1rem', color: 'var(--text-muted)'}}>Effective Date</div>
                </div>
              </div>

              <div style={{padding: 'var(--space-5) var(--space-6)', display: 'flex', gap: 'var(--space-4)', justifyContent: 'flex-end', backgroundColor: 'var(--bg-root)'}}>
                <Annotation
                  title="Hold button"
                  what="allows pause"
                  why="secondary placement"
                  how="Keeps the batch safely cached in Awaiting state until issues are clarified."
                >
                  <button 
                    className={styles.primaryButton} 
                    style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text)', border: '1px solid var(--border)', padding: 'var(--space-3) var(--space-6)', fontSize: '1.1rem'}}
                    onClick={() => generateApprovalMutation.mutate({ id: batch.id, action: 'hold' })}
                    disabled={generateApprovalMutation.isPending}
                  >
                    <PauseCircle size={20} /> Hold Batch
                  </button>
                </Annotation>

                <Annotation
                  title="Approve button"
                  what="triggers enrollment"
                  why="visually dominant"
                  how="Visually distinct primary styling draws the final click once data is conceptually validated."
                >
                  <button 
                    className={styles.primaryButton} 
                    style={{padding: 'var(--space-3) var(--space-6)', fontSize: '1.1rem'}}
                    onClick={() => generateApprovalMutation.mutate({ id: batch.id, action: 'approve' })}
                    disabled={generateApprovalMutation.isPending}
                  >
                    <CheckCircle size={20} /> Approve Enrollment
                  </button>
                </Annotation>
              </div>
            </div>
          </Annotation>
        ))}
      </div>
    </div>
  );
}
