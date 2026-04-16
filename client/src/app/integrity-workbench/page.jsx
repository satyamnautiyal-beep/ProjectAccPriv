'use client';

import React, { useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Clock, AlertCircle, ChevronRight, Play } from 'lucide-react';

export default function IntegrityWorkbenchPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('All');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => fetch('/api/members').then(res => res.json()),
    refetchInterval: 3000
  });

  const parseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/parse-members', { method: 'POST' });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      alert(`Successfully validated and processed members!`);
    }
  });

  const hasPendingValidation = members.some(m => m.status === 'Pending Business Validation');

  // Business Category Mapping (based on user requirements)
  const ready = members.filter(m => m.status === 'Ready');
  const triage = members.filter(m => m.status === 'Awaiting Clarification');
  const blocked = members.filter(m => m.status === 'Cannot Process' || (m.validation_issues && m.validation_issues.length > 5));

  const getStatusUI = (status) => {
    if (status === 'Ready' || status === 'Approved') {
      return { label: 'Ready', class: styles.approved, icon: <ShieldCheck size={14} />, color: 'var(--success)' };
    }
    if (status === 'In Batch') {
      return { 
        label: 'Batched', 
        class: styles.approved, 
        icon: <ShieldCheck size={14} />, 
        color: 'var(--success)',
        bg: 'var(--success-light)'
      };
    }
    if (status === 'Pending Business Validation' || status === 'Under Review' || status === 'Awaiting Clarification' || status === 'Pending') {
      return { label: 'In Triage', class: styles.pending, icon: <Clock size={14} />, color: 'var(--primary)' };
    }
    return { label: 'On Hold', class: '', icon: <AlertCircle size={14} />, color: 'var(--danger)', bg: 'var(--danger-light)' };
  };

  const getFilteredList = () => {
    // We filter out 'In Batch' members completely from this page (Readiness)
    // as they are already managed in the Batch Preparation phase.
    const activeMembers = members.filter(m => m.status !== 'In Batch');

    if (filter === 'Ready') return ready;
    if (filter === 'Triage') return triage;
    if (filter === 'Blocked') return blocked;
    return activeMembers;
  };

  const filteredMembers = getFilteredList();

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
        <div>
          <h1 className={styles.title}>Integrity Workbench</h1>
          <p className={styles.subtitle}>Consolidated overview of member validation and enrollment readiness.</p>
        </div>
        <button 
          className={styles.primaryButton} 
          onClick={() => parseMutation.mutate()}
          disabled={parseMutation.isPending || !hasPendingValidation}
          style={{display: 'flex', alignItems: 'center', gap: '8px', opacity: (parseMutation.isPending || !hasPendingValidation) ? 0.5 : 1}}
        >
          <Play size={16} /> {parseMutation.isPending ? 'Validating...' : 'Initiate Member Validations'}
        </button>
      </div>

      <div className={styles.kpiGrid} style={{gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px'}}>
        <div 
          className={styles.kpiCard} 
          onClick={() => setFilter(filter === 'Ready' ? 'All' : 'Ready')}
          style={{cursor: 'pointer', border: filter === 'Ready' ? '2px solid var(--success)' : '1px solid var(--border)'}}
        >
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
            <span style={{color: 'var(--success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'}}>
              <ShieldCheck size={20} /> Ready for Batch
            </span>
            <ChevronRight size={16} style={{opacity: 0.3}} />
          </div>
          <div className={styles.kpiValue}>{ready.length}</div>
          <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px'}}>Verified & Clean Data</div>
        </div>

        <div 
          className={styles.kpiCard}
          onClick={() => setFilter(filter === 'Triage' ? 'All' : 'Triage')}
          style={{cursor: 'pointer', border: filter === 'Triage' ? '2px solid var(--primary)' : '1px solid var(--border)'}}
        >
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
            <span style={{color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'}}>
              <Clock size={20} /> Triage Needed
            </span>
            <ChevronRight size={16} style={{opacity: 0.3}} />
          </div>
          <div className={styles.kpiValue}>{triage.length}</div>
          <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px'}}>Awaiting Clarification</div>
        </div>

        <div 
          className={styles.kpiCard}
          onClick={() => setFilter(filter === 'Blocked' ? 'All' : 'Blocked')}
          style={{cursor: 'pointer', border: filter === 'Blocked' ? '2px solid var(--danger)' : '1px solid var(--border)'}}
        >
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
            <span style={{color: 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'}}>
              <AlertCircle size={20} /> Critical Blocks
            </span>
            <ChevronRight size={16} style={{opacity: 0.3}} />
          </div>
          <div className={styles.kpiValue}>{blocked.length}</div>
          <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px'}}>Requires Attention</div>
        </div>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.cardHeader} style={{borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '16px'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h2 className={styles.cardTitle}>Global Subscriber Roster</h2>
            <div style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
              <span style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>{filteredMembers.length} records shown</span>
              <select 
                value={filter} 
                onChange={(e) => setFilter(e.target.value)}
                className={styles.select}
                style={{padding: '6px 12px', fontSize: '0.85rem'}}
              >
                <option value="All">All Members</option>
                <option value="Ready">Ready Only</option>
                <option value="Triage">Triage Needed</option>
                <option value="Blocked">Blocked Only</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{paddingLeft: '24px'}}>Subscriber & Family</th>
                <th>Plan Details</th>
                <th>Validation Logic</th>
                <th style={{paddingRight: '24px'}}>Readiness</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan="4" style={{textAlign: 'center', padding: '48px'}}>Loading records...</td></tr>}
              {!isLoading && filteredMembers.length === 0 && <tr><td colSpan="4" style={{textAlign: 'center', padding: '48px'}}>No records found matching this filter.</td></tr>}
              
              {filteredMembers.map((member) => {
                const latestDate = member.latest_update;
                const snapshot = member.history ? member.history[latestDate] : null;
                const info = snapshot?.member_info || {};
                const name = info.first_name ? `${info.first_name} ${info.last_name}` : 'Unknown';
                const depCount = snapshot?.dependents?.length || 0;
                const ui = getStatusUI(member.status);

                return (
                  <tr key={member.subscriber_id} style={{height: '80px'}}>
                    <td style={{paddingLeft: '24px'}}>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                        <div style={{fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem'}}>
                          {name}
                          {depCount > 0 && (
                            <span style={{marginLeft: '8px', fontSize: '0.65rem', padding: '2px 8px', borderRadius: '12px', backgroundColor: 'var(--bg-muted)', color: 'var(--text-muted)'}}>
                              +{depCount} Dep
                            </span>
                          )}
                        </div>
                        <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '8px'}}>
                          {member.subscriber_id}
                          {member.batch_id && (
                            <span style={{color: 'var(--primary)', backgroundColor: 'var(--primary-light)', padding: '0px 6px', borderRadius: '4px', fontSize: '0.65rem'}}>
                              {member.batch_id}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        <div style={{fontSize: '0.85rem', fontWeight: 500}}>{snapshot?.coverages?.[0]?.plan_code || 'N/A'}</div>
                        <div style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>{snapshot?.member_info?.insurer_name || 'Standard Plan'}</div>
                      </div>
                    </td>
                    <td>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                        {member.validation_issues && member.validation_issues.length > 0 ? (
                          <div style={{fontSize: '0.7rem', color: 'var(--danger)', fontWeight: 500}}>
                             {member.validation_issues[0]} 
                             {member.validation_issues.length > 1 && ` (+${member.validation_issues.length - 1} more)`}
                          </div>
                        ) : (
                          member.status === 'Ready' || member.status === 'Approved' || member.status === 'In Batch' ? (
                            <div style={{fontSize: '0.7rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px'}}>
                               <ShieldCheck size={12} /> Data Integrity Passed
                            </div>
                          ) : (
                            <div style={{fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px'}}>
                               <Clock size={12} /> Awaiting Business Scan
                            </div>
                          )
                        )}
                        {member.agent_analysis && (
                          <div style={{fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 500}}>
                            🤖 AI Verified • SEP {member.agent_analysis.period || 'Valid'}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{paddingRight: '24px'}}>
                      <span className={ui.class} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor: ui.bg || 'transparent',
                        color: ui.color
                      }}>
                        {ui.icon} {ui.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
