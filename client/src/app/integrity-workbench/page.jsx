'use client';

import React, { useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import iw from './integrity-workbench.module.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, Clock, AlertCircle, ChevronRight, Play,
  X, Users, Loader2, AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
};

const GenderPill = ({ gender }) => {
  if (!gender) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const g = gender.toUpperCase();
  const label = g === 'M' ? 'Male' : g === 'F' ? 'Female' : gender;
  const style = g === 'M'
    ? { background: 'rgba(59,130,246,0.1)', color: '#2563eb' }
    : g === 'F'
    ? { background: 'rgba(236,72,153,0.1)', color: '#db2777' }
    : { background: 'var(--bg-root)', color: 'var(--text-muted)', border: '1px solid var(--border)' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, ...style }}>
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Dependents Panel
// ---------------------------------------------------------------------------
function DependentsPanel({ member, onClose }) {
  const latestDate = member.latest_update;
  const snapshot = member.history ? member.history[latestDate] : null;
  const info = snapshot?.member_info || {};
  const dependents = snapshot?.dependents || [];
  const subscriberName = [info.first_name, info.last_name].filter(Boolean).join(' ') || member.subscriber_id;

  return (
    <>
      <div className={iw.panelOverlay} onClick={onClose} aria-hidden="true" />
      <aside className={iw.panel} role="dialog" aria-label="Dependents panel">
        {/* Header */}
        <div className={iw.panelHeader}>
          <div className={iw.panelHeaderLeft}>
            <div className={iw.panelTitle}>
              <Users size={18} color="var(--primary)" />
              {subscriberName}
            </div>
            <div className={iw.panelSubtitle}>{member.subscriber_id}</div>
          </div>
          <button className={iw.panelCloseBtn} onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>

        {/* Subscriber info strip */}
        <div className={iw.subscriberStrip}>
          <div className={iw.subscriberField}>
            <span className={iw.subscriberFieldLabel}>Plan Code</span>
            <span className={iw.subscriberFieldValue}>{snapshot?.coverages?.[0]?.plan_code || '—'}</span>
          </div>
          <div className={iw.subscriberField}>
            <span className={iw.subscriberFieldLabel}>Payer</span>
            <span className={iw.subscriberFieldValue}>{info.insurer_name || info.employer_name || '—'}</span>
          </div>
          <div className={iw.subscriberField}>
            <span className={iw.subscriberFieldLabel}>Coverage Start</span>
            <span className={iw.subscriberFieldValue}>{fmtDate(snapshot?.coverages?.[0]?.coverage_start_date)}</span>
          </div>
          <div className={iw.subscriberField}>
            <span className={iw.subscriberFieldLabel}>DOB</span>
            <span className={iw.subscriberFieldValue}>{fmtDate(info.dob)}</span>
          </div>
          <div className={iw.subscriberField}>
            <span className={iw.subscriberFieldLabel}>Gender</span>
            <span className={iw.subscriberFieldValue}><GenderPill gender={info.gender} /></span>
          </div>
        </div>

        {/* Dependents body */}
        <div className={iw.panelBody}>
          {dependents.length === 0 ? (
            <div className={iw.emptyState}>
              <Users size={32} color="var(--border)" />
              <span>No dependents on record for this subscriber.</span>
            </div>
          ) : (
            <div className={iw.dependentsSection}>
              <div className={iw.dependentsSectionTitle}>
                <span>Dependents</span>
                <span className={iw.dependentsCount}>{dependents.length}</span>
              </div>
              <table className={iw.dependentsTable}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Date of Birth</th>
                    <th>Age</th>
                    <th>Gender</th>
                  </tr>
                </thead>
                <tbody>
                  {dependents.map((dep, idx) => {
                    const di = dep.member_info || {};
                    const name = [di.first_name, di.last_name].filter(Boolean).join(' ') || `Dependent ${idx + 1}`;
                    const age = di.dob
                      ? Math.floor((Date.now() - new Date(di.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                      : null;
                    return (
                      <tr key={idx}>
                        <td style={{ fontWeight: 500 }}>{name}</td>
                        <td>{fmtDate(di.dob)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{age != null ? `${age} yrs` : '—'}</td>
                        <td><GenderPill gender={di.gender} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Status cell — Awaiting Scan / Ready / Clarification Needed (with tooltip)
// ---------------------------------------------------------------------------
function StatusCell({ member }) {
  const [hovered, setHovered] = useState(false);
  const rawIssues = member.validation_issues || [];
  const status = member.status || '';

  // Normalise issues — can be strings or {message, severity} objects
  const issues = rawIssues.map(i =>
    typeof i === 'string' ? i : (i?.message || JSON.stringify(i))
  );

  const isReady = status === 'Ready';
  const hasClarification = issues.length > 0 || status === 'Awaiting Clarification';

  if (isReady && !hasClarification) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 14px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600,
        backgroundColor: 'var(--success-light)', color: 'var(--success)',
      }}>
        <ShieldCheck size={13} /> Ready
      </span>
    );
  }

  if (hasClarification) {
    const first = issues[0];
    const rest = issues.length - 1;
    return (
      <div
        className={iw.statusClarification}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span className={iw.clarificationBadge}>
          <AlertTriangle size={12} />
          Clarification Needed
        </span>
        <span className={iw.clarificationIssue}>
          {first}{rest > 0 && <span className={iw.clarificationMore}> +{rest} issue{rest > 1 ? 's' : ''}</span>}
        </span>
        {hovered && rest > 0 && (
          <div className={iw.issuesTooltip}>
            {issues.slice(1).map((issue, i) => (
              <div key={i} className={iw.tooltipItem}>
                <AlertTriangle size={10} style={{ flexShrink: 0, marginTop: 1 }} />
                {issue}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Default — awaiting scan
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600,
      backgroundColor: 'var(--primary-light)', color: 'var(--primary)',
    }}>
      <Clock size={13} /> Awaiting Scan
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function IntegrityWorkbenchPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('All');
  const [selectedMember, setSelectedMember] = useState(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => fetch('/api/members').then(res => res.json()),
    refetchInterval: 3000,
  });

  const parseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/parse-members', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      alert('Successfully validated and processed members!');
    },
  });

  // Only members actively in the validation pipeline belong here.
  // Enrolled, Enrolled (SEP), In Review, In Batch etc. are downstream — exclude them.
  const WORKBENCH_STATUSES = ['Pending Business Validation', 'Ready', 'Awaiting Clarification'];
  const workbenchMembers = members.filter(m => WORKBENCH_STATUSES.includes(m.status));

  const hasPendingValidation = workbenchMembers.some(m => m.status === 'Pending Business Validation');

  const ready   = workbenchMembers.filter(m => m.status === 'Ready');
  const triage  = workbenchMembers.filter(m => m.status === 'Awaiting Clarification');
  const pending = workbenchMembers.filter(m => m.status === 'Pending Business Validation');

  const STATUS_ORDER = { 'Awaiting Clarification': 0, 'Ready': 1, 'Pending Business Validation': 2 };
  const sortByPriority = (list) =>
    [...list].sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));

  const getFilteredList = () => {
    if (filter === 'Ready')   return ready;
    if (filter === 'Triage')  return triage;
    if (filter === 'Pending') return pending;
    return sortByPriority(workbenchMembers);
  };

  const filteredMembers = getFilteredList();

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className={styles.title}>Integrity Workbench</h1>
          <p className={styles.subtitle}>Consolidated overview of member validation and enrollment readiness.</p>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => parseMutation.mutate()}
          disabled={parseMutation.isPending || !hasPendingValidation}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (parseMutation.isPending || !hasPendingValidation) ? 0.5 : 1 }}
        >
          <Play size={16} /> {parseMutation.isPending ? 'Validating...' : 'Initiate Member Validations'}
        </button>
      </div>

      {/* KPI cards */}
      <div className={styles.kpiGrid} style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px' }}>
        {[
          { key: 'Pending', count: pending.length, label: 'Awaiting Scan', sub: 'Pending Business Validation', icon: <Clock size={20} />, color: 'var(--primary)' },
          { key: 'Ready',   count: ready.length,   label: 'Ready',         sub: 'Verified & Clean Data',       icon: <ShieldCheck size={20} />, color: 'var(--success)' },
          { key: 'Triage',  count: triage.length,  label: 'Clarification Needed', sub: 'Awaiting Clarification', icon: <AlertCircle size={20} />, color: 'var(--danger)' },
        ].map(({ key, count, label, sub, icon, color }) => (
          <div
            key={key}
            className={styles.kpiCard}
            onClick={() => setFilter(filter === key ? 'All' : key)}
            style={{ cursor: 'pointer', border: filter === key ? `2px solid ${color}` : '1px solid var(--border)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>{icon} {label}</span>
              <ChevronRight size={16} style={{ opacity: 0.3 }} />
            </div>
            <div className={styles.kpiValue}>{count}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Roster table */}
      <div className={styles.sectionCard}>
        <div className={styles.cardHeader} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className={styles.cardTitle}>Global Subscriber Roster</h2>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{filteredMembers.length} records shown</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className={styles.select}
                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              >
                <option value="All">All</option>
                <option value="Pending">Awaiting Scan</option>
                <option value="Ready">Ready</option>
                <option value="Triage">Clarification Needed</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ paddingLeft: '24px' }}>Subscriber & Family</th>
                <th>Age</th>
                <th>Gender</th>
                <th>Coverage Start</th>
                <th style={{ paddingRight: '24px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan="5" style={{ textAlign: 'center', padding: '48px' }}>Loading records...</td></tr>}
              {!isLoading && filteredMembers.length === 0 && <tr><td colSpan="5" style={{ textAlign: 'center', padding: '48px' }}>No records found matching this filter.</td></tr>}

              {filteredMembers.map((member, rowIdx) => {
                const latestDate = member.latest_update;
                const snapshot = member.history ? member.history[latestDate] : null;
                const info = snapshot?.member_info || {};
                const name = info.first_name ? `${info.first_name} ${info.last_name}` : 'Unknown';
                const depCount = snapshot?.dependents?.length || 0;
                const age = info.dob
                  ? Math.floor((Date.now() - new Date(info.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                  : null;
                const coverageStart = fmtDate(snapshot?.coverages?.[0]?.coverage_start_date);

                return (
                  <tr key={`${member.subscriber_id}-${rowIdx}`} style={{ height: '72px' }}>
                    {/* Subscriber & Family */}
                    <td style={{ paddingLeft: '24px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {name}
                          {depCount > 0 && (
                            <button
                              className={iw.depBadge}
                              onClick={() => setSelectedMember(member)}
                              title="View dependents"
                            >
                              +{depCount} Dep
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {member.subscriber_id}
                          {member.batch_id && (
                            <span style={{ color: 'var(--primary)', backgroundColor: 'var(--primary-light)', padding: '0px 6px', borderRadius: '4px', fontSize: '0.65rem' }}>
                              {member.batch_id}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Age */}
                    <td style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>
                      {age != null ? `${age} yrs` : '—'}
                    </td>

                    {/* Gender */}
                    <td><GenderPill gender={info.gender} /></td>

                    {/* Coverage Start */}
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {coverageStart}
                    </td>

                    {/* Status */}
                    <td style={{ paddingRight: '24px' }}>
                      <StatusCell member={member} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dependents panel */}
      {selectedMember && (
        <DependentsPanel member={selectedMember} onClose={() => setSelectedMember(null)} />
      )}
    </div>
  );
}
