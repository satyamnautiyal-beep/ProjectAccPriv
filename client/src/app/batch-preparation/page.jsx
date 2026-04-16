'use client';

import React, { useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { Package, Calendar, Users, LayoutList, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function BatchPreparationPage() {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(res => res.json()),
    refetchInterval: 2000
  });

  const generateBatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/batches', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    },
    onError: (err) => alert("Cannot generate batch: There might not be any 'Ready' members left to batch!")
  });

  const getStatusBadge = (status) => {
    if (status === 'Awaiting Approval') return <span className={`${styles.badge} ${styles.pending}`}>{status}</span>;
    if (status === 'Ready' || status === 'In Progress' || status === 'Completed') return <span className={`${styles.badge} ${styles.approved}`}>{status}</span>;
    return <span className={styles.badge}>{status}</span>;
  };

  const activeBatch = batches.find(b => b.id === activeBatchId);

  return (
    <div className={styles.container} style={{ position: 'relative', overflow: 'hidden' }}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Batch Preparation</h1>
        </div>
        <div className={styles.actions}>
          <button 
            className={styles.primaryButton} 
            onClick={() => generateBatchMutation.mutate()}
            disabled={generateBatchMutation.isPending}
          >
            {generateBatchMutation.isPending ? 'Generating...' : 'Generate New Batch'}
          </button>
        </div>
      </div>

      <Annotation
        title="Batch cards"
        what="represent grouped members"
        why="improves scalability"
        how="Packs thousands of row-items into simple business objects for leaders to clear quickly."
      >
        {isLoading && <div style={{padding: 'var(--space-6)', textAlign: 'center'}}>Loading batches...</div>}
        {!isLoading && batches.length === 0 && <div className={styles.sectionCard} style={{padding: 'var(--space-5)', textAlign: 'center'}}>No batches created yet. Click Generate New Batch to pull from the Ready pool.</div>}
        
        <div style={{
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
          gap: 'var(--space-5)',
          paddingRight: activeBatchId ? '350px' : '0', // Shift grid to make room for side panel
          transition: 'padding-right 0.3s ease'
        }}>
          {batches.map(batch => (
            <div 
              key={batch.id} 
              className={styles.sectionCard} 
              style={{
                cursor: 'pointer', 
                transition: 'all 0.2s',
                transform: activeBatchId === batch.id ? 'scale(1.02)' : 'none',
                border: activeBatchId === batch.id ? '2px solid var(--primary)' : '1px solid var(--border)'
              }} 
              onClick={() => setActiveBatchId(batch.id)}
            >
              <div style={{padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                    <div style={{backgroundColor: 'var(--bg-root)', padding: '10px', borderRadius: 'var(--radius-md)'}}>
                      <Package size={20} color="var(--primary)" />
                    </div>
                    <div>
                      <h3 style={{fontWeight: 800, fontSize: '1.2rem'}}>{batch.id}</h3>
                    </div>
                  </div>
                  <div>
                    <Annotation
                      title="Status badge"
                      what="shows readiness"
                      why="supports decision making"
                      how="Instantly color codes outputs via business terms."
                    >
                      {getStatusBadge(batch.status)}
                    </Annotation>
                  </div>
                </div>
                
                <div style={{textAlign: 'center', margin: 'var(--space-3) 0'}}>
                  <div style={{fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary)', lineHeight: 1}}>{batch.membersCount}</div>
                  <div style={{fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px'}}>Members</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Annotation>

      {/* Side Panel Modal View */}
      <Annotation
        title="Side Panel"
        what="reveals deeper details"
        why="reduces clutter"
        how="Pushes details off the primary screen to keep the grid extremely light and fast to scan."
      >
        <div style={{
          position: 'fixed',
          top: 0,
          right: activeBatchId ? 0 : '-400px',
          width: '350px',
          height: '100vh',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: '-4px 0 15px rgba(0,0,0,0.1)',
          transition: 'right 0.3s ease',
          zIndex: 100,
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {activeBatch && (
            <>
              <div style={{padding: 'var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-root)'}}>
                <h3 style={{fontWeight: 700, fontSize: '1.2rem'}}>{activeBatch.id} Details</h3>
                <button onClick={() => setActiveBatchId(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}>
                  <X size={20} color="var(--text-muted)" />
                </button>
              </div>

              <div style={{padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                  <div style={{backgroundColor: 'var(--primary-light)', padding: '12px', borderRadius: '50%'}}>
                    <Users size={24} color="var(--primary)" />
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column'}}>
                    <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase'}}>Member Count</span>
                    <div style={{fontWeight: 700, fontSize: '1.1rem'}}>{activeBatch.membersCount} Total</div>
                  </div>
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                  <div style={{backgroundColor: 'var(--success-light)', padding: '12px', borderRadius: '50%'}}>
                    <LayoutList size={24} color="var(--success)" />
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column'}}>
                    <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase'}}>Enrollment Types</span>
                    {activeBatch.types ? (
                      activeBatch.types.split(', ').map((type, i) => (
                        <div key={i} style={{fontWeight: 600, fontSize: '0.9rem'}}>{type}</div>
                      ))
                    ) : (
                      <div style={{fontWeight: 600}}>Mixed Segment Enrollment</div>
                    )}
                  </div>
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                  <div style={{backgroundColor: 'var(--warning-light)', padding: '12px', borderRadius: '50%'}}>
                    <Calendar size={24} color="var(--warning)" />
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column'}}>
                    <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase'}}>Effective Dates</span>
                    <div style={{fontWeight: 700, fontSize: '1.1rem'}}>{new Date(activeBatch.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </Annotation>
    </div>
  );
}
