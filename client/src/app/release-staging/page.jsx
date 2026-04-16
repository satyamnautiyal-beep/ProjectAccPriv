'use client';

import React, { useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { Package, Calendar, Users, LayoutList, X, Send, ShieldCheck, AlertCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function ReleaseStagingPage() {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(res => res.json()),
    refetchInterval: 3000
  });

  const generateBatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/batches', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
    onError: (err) => alert("Cannot generate batch: There are no 'Ready' members currently awaiting a batch!")
  });

  const initiateBatchMutation = useMutation({
    mutationFn: async (batchId) => {
      const res = await fetch('/api/initiate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId })
      });
      return res.json();
    },
    onSuccess: () => {
      setShowModal(false);
      setActiveBatchId(null);
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      alert("Batch Enrollment Successfully Initiated! The AI Agents are now processing the records.");
    }
  });

  const getStatusBadge = (status) => {
    if (status === 'Awaiting Approval') return <span className={`${styles.badge} ${styles.pending}`}>Pending Release</span>;
    if (status === 'Completed') return <span className={`${styles.badge} ${styles.approved}`}>Enrolled</span>;
    return <span className={styles.badge}>{status}</span>;
  };

  const activeBatch = batches.find(b => b.id === activeBatchId);

  return (
    <div className={styles.container} style={{ position: 'relative' }}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Release Staging</h1>
          <p className={styles.subtitle}>Finalize reviewed records and release batches to the Agentic AI Refinery.</p>
        </div>
        <div className={styles.actions}>
          <button 
            className={styles.buttonPrimary} 
            onClick={() => generateBatchMutation.mutate()}
            disabled={generateBatchMutation.isPending}
            style={{display: 'flex', alignItems: 'center', gap: '8px'}}
          >
            <Package size={18} /> {generateBatchMutation.isPending ? 'Bundling...' : 'Generate New Batch'}
          </button>
        </div>
      </div>

      <div style={{
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
          gap: '24px',
          paddingRight: activeBatchId ? '400px' : '0',
          transition: 'padding-right 0.3s ease'
      }}>
        {isLoading && <div style={{gridColumn: '1/-1', textAlign: 'center', padding: '48px'}}>Loading current batches...</div>}
        {!isLoading && batches.length === 0 && (
          <div className={styles.sectionCard} style={{gridColumn: '1/-1', textAlign: 'center', padding: '64px'}}>
            <Package size={48} color="var(--border)" style={{marginBottom: '16px'}} />
            <div style={{fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-muted)'}}>No Pending Batches</div>
            <p style={{color: 'var(--text-muted)'}}>Click 'Generate New Batch' to bundle all members who passed Data Integrity scans.</p>
          </div>
        )}
        
        {batches.map(batch => (
          <div 
            key={batch.id} 
            className={styles.sectionCard} 
            style={{
              cursor: 'pointer', 
              border: activeBatchId === batch.id ? '2px solid var(--primary)' : '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              padding: '24px'
            }} 
            onClick={() => setActiveBatchId(batch.id)}
          >
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
              <div>
                <div style={{fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase'}}>{batch.id}</div>
                <div style={{fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary)'}}>{batch.membersCount}</div>
                <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>Members included</div>
              </div>
              {getStatusBadge(batch.status)}
            </div>
          </div>
        ))}
      </div>

      {/* Detail Panel */}
      <div style={{
          position: 'fixed',
          top: 0,
          right: activeBatchId ? 0 : '-400px',
          width: '400px',
          height: '100vh',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: '-8px 0 25px rgba(0,0,0,0.08)',
          transition: 'right 0.3s ease',
          zIndex: 100,
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column'
      }}>
        {activeBatch && (
          <>
            <div style={{padding: '24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <h3 style={{fontWeight: 700}}>Batch Verification</h3>
              <button onClick={() => setActiveBatchId(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}><X size={20} /></button>
            </div>
            
            <div style={{padding: '32px', flex: 1, display: 'flex', flexDirection: 'column', gap: '32px'}}>
              <div style={{backgroundColor: 'var(--bg-root)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border)'}}>
                 <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '8px'}}>Release Summary</div>
                 <div style={{fontSize: '1.2rem', fontWeight: 600}}>{activeBatch.membersCount} Certified Records</div>
                 <div style={{fontSize: '0.85rem', color: 'var(--text-muted)'}}>Final human-review scans completed.</div>
              </div>

              {activeBatch.status === 'Completed' ? (
                <div style={{textAlign: 'center', padding: '32px', border: '2px dashed var(--success)', borderRadius: '12px'}}>
                  <ShieldCheck size={48} color="var(--success)" style={{margin: '0 auto 16px'}} />
                  <div style={{fontWeight: 600, color: 'var(--success)'}}>Released for Enrollment</div>
                  <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>This batch is being handled by the agentic system.</div>
                </div>
              ) : (
                <button 
                  className={styles.buttonPrimary} 
                  style={{width: '100%', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px'}}
                  onClick={() => setShowModal(true)}
                >
                  <Send size={18} /> Initiate Enrollment
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)', padding: '40px', borderRadius: '16px', 
            maxWidth: '500px', width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column', gap: '24px'
          }}>
            <div style={{textAlign: 'center'}}>
              <AlertCircle size={48} color="var(--primary)" style={{margin: '0 auto 16px'}} />
              <h2 style={{fontWeight: 800, fontSize: '1.5rem'}}>Final Release Affirmation</h2>
            </div>
            
            <p style={{fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--text-primary)', backgroundColor: 'var(--bg-root)', padding: '20px', borderRadius: '8px', borderLeft: '4px solid var(--primary)'}}>
              "I agree that I have reviewed the facts and want to send this batch for enrollment. I certify that all data integrity warnings have been resolved or manually overridden."
            </p>

            <div style={{display: 'flex', gap: '16px', marginTop: '8px'}}>
              <button 
                onClick={() => setShowModal(false)}
                style={{flex: 1, padding: '14px', borderRadius: '8px', border: '1px solid var(--border)', fontWeight: 600}}
              >
                Back
              </button>
              <button 
                disabled={initiateBatchMutation.isPending}
                onClick={() => initiateBatchMutation.mutate(activeBatchId)}
                style={{flex: 1, padding: '14px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--primary)', color: 'white', fontWeight: 600}}
              >
                {initiateBatchMutation.isPending ? 'Processing...' : 'I Agree & Release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
