'use client';

/**
 * Classifier Page
 *
 * Shows members that have passed structure + business validation.
 * Status: "Ready" → routed to Release Staging
 * Status: "Awaiting Clarification" → held here for resolution
 *
 * This is the decision gate between Integrity Workbench and Release Staging.
 */

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/components/shared.module.css';
import {
  ShieldCheck, AlertTriangle, Clock, ChevronRight,
  Zap, Filter, Search, X, ArrowRight, RefreshCw,
  FileText, Users, TrendingUp, RotateCcw, AlertCircle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLASSIFICATION_CONFIG = {
  OEP_ENROLLMENT:  { label: 'OEP Enrollment',  color: '#2563eb', bg: 'rgba(59,130,246,0.1)',  agent: 'EnrollmentRouterAgent' },
  SEP_ENROLLMENT:  { label: 'SEP Enrollment',  color: '#7c3aed', bg: 'rgba(124,58,237,0.1)', agent: 'EnrollmentRouterAgent' },
  RENEWAL:         { label: 'Renewal',          color: '#16a34a', bg: 'rgba(34,197,94,0.1)',  agent: 'RenewalProcessorAgent' },
  RETRO_COVERAGE:  { label: 'Retro Coverage',   color: '#a855f7', bg: 'rgba(168,85,247,0.1)', agent: 'RetroEnrollmentOrchestratorAgent' },
  UNKNOWN:         { label: 'Unclassified',     color: '#6b7280', bg: 'rgba(107,114,128,0.1)', agent: '—' },
};

const getClassConfig = (cls = '') => {
  const key = cls.toUpperCase().replace(/[^A-Z_]/g, '_');
  return CLASSIFICATION_CONFIG[key] || CLASSIFICATION_CONFIG.UNKNOWN;
};

const fmtDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
};

// ---------------------------------------------------------------------------
// Classification Badge
// ---------------------------------------------------------------------------
function ClassBadge({ classification }) {
  const cfg = getClassConfig(classification);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: '20px',
      fontSize: '0.75rem', fontWeight: 700,
      backgroundColor: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.color}22`,
    }}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }) {
  if (status === 'Ready') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: '20px',
        fontSize: '0.75rem', fontWeight: 600,
        backgroundColor: 'var(--success-light)', color: 'var(--success)',
      }}>
        <ShieldCheck size={12} /> Ready
      </span>
    );
  }
  if (status === 'Awaiting Clarification') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: '20px',
        fontSize: '0.75rem', fontWeight: 600,
        backgroundColor: 'var(--warning-light, #fef3c7)', color: 'var(--warning, #d97706)',
      }}>
        <AlertTriangle size={12} /> Awaiting Clarification
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '5px 12px', borderRadius: '20px',
      fontSize: '0.75rem', fontWeight: 600,
      backgroundColor: 'var(--primary-light)', color: 'var(--primary)',
    }}>
      <Clock size={12} /> {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function ClassifierPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('All');
  const [classFilter, setClassFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch all members, filter to those that have passed business validation
  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => fetch('/api/members').then(r => r.json()),
    refetchInterval: 3000,
  });

  // Classifier shows: Ready + Awaiting Clarification + Not Enough Info (post-business-validation)
  const classifierMembers = useMemo(() =>
    members.filter(m => m.status === 'Ready' || m.status === 'Awaiting Clarification' || m.status === 'Not Enough Info'),
    [members]
  );

  // Apply filters
  const filtered = useMemo(() => {
    let list = classifierMembers;
    if (statusFilter !== 'All') list = list.filter(m => m.status === statusFilter);
    if (classFilter !== 'All') list = list.filter(m => {
      const cfg = getClassConfig(m.classification || '');
      return cfg.label === classFilter;
    });
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(m => {
        const snap = m.history?.[m.latest_update];
        const info = snap?.member_info || {};
        const name = `${info.first_name || ''} ${info.last_name || ''}`.toLowerCase();
        return name.includes(q) || (m.subscriber_id || '').toLowerCase().includes(q);
      });
    }
    return list;
  }, [classifierMembers, statusFilter, classFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => ({
    total: classifierMembers.length,
    ready: classifierMembers.filter(m => m.status === 'Ready').length,
    clarification: classifierMembers.filter(m => m.status === 'Awaiting Clarification').length,
    notEnoughInfo: classifierMembers.filter(m => m.status === 'Not Enough Info').length,
    byClass: Object.fromEntries(
      Object.keys(CLASSIFICATION_CONFIG).map(k => [
        k,
        classifierMembers.filter(m => getClassConfig(m.classification || '').label === CLASSIFICATION_CONFIG[k].label).length
      ])
    ),
  }), [classifierMembers]);

  // Classify mutation — runs the classifier agent on Ready members
  const classifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/classify-members', { method: 'POST' });
      if (!res.ok) throw new Error('Classification failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      // Show success message
      alert(`Classification complete: ${data.classified} members classified`);
    },
    onError: (error) => {
      alert(`Classification failed: ${error.message}`);
    },
  });

  const uniqueClasses = [...new Set(
    classifierMembers.map(m => getClassConfig(m.classification || '').label)
  )].filter(Boolean);

  return (
    <div className={styles.container}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className={styles.title}>Classifier</h1>
          <p className={styles.subtitle}>
            Members that have passed structure and business validation. Ready records are routed to Release Staging.
          </p>
        </div>
        <button
          onClick={() => classifyMutation.mutate()}
          disabled={classifyMutation.isPending}
          style={{
            backgroundColor: 'var(--primary)', color: '#fff', border: 'none',
            padding: '8px 18px', borderRadius: '8px',
            cursor: classifyMutation.isPending ? 'not-allowed' : 'pointer',
            opacity: classifyMutation.isPending ? 0.7 : 1,
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem',
          }}
        >
          {classifyMutation.isPending
            ? <><RefreshCw size={16} className="animate-spin" /> Classifying…</>
            : <><Zap size={16} /> Run Classifier</>}
        </button>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Ready', value: stats.ready, icon: <ShieldCheck size={18} />, color: 'var(--success)' },
          { label: 'Awaiting Clarification', value: stats.clarification, icon: <AlertTriangle size={18} />, color: 'var(--warning, #d97706)' },
          { label: 'Not Enough Info', value: stats.notEnoughInfo, icon: <AlertCircle size={18} />, color: '#f59e0b' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className={styles.kpiCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ color, display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '0.82rem' }}>
                {icon} {label}
              </span>
            </div>
            <div className={styles.kpiValue}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Classification breakdown ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px',
        padding: '12px 16px', backgroundColor: 'var(--bg-root)',
        border: '1px solid var(--border)', borderRadius: '8px',
      }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', alignSelf: 'center', marginRight: '4px' }}>
          By Type
        </span>
        {Object.entries(CLASSIFICATION_CONFIG).filter(([k]) => k !== 'UNKNOWN').map(([key, cfg]) => {
          const count = stats.byClass[key] || 0;
          return (
            <button
              key={key}
              onClick={() => setClassFilter(classFilter === cfg.label ? 'All' : cfg.label)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                fontSize: '0.78rem', fontWeight: 600,
                backgroundColor: classFilter === cfg.label ? cfg.bg : 'var(--bg-surface)',
                color: classFilter === cfg.label ? cfg.color : 'var(--text-muted)',
                outline: classFilter === cfg.label ? `1px solid ${cfg.color}` : '1px solid var(--border)',
              }}
            >
              {cfg.label}
              <span style={{
                backgroundColor: classFilter === cfg.label ? cfg.color : 'var(--border)',
                color: classFilter === cfg.label ? '#fff' : 'var(--text-muted)',
                borderRadius: '10px', padding: '0 6px', fontSize: '0.7rem', fontWeight: 700,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters + Search ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
          <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search by name or subscriber ID…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px 8px 32px',
              border: '1px solid var(--border)', borderRadius: '8px',
              fontSize: '0.88rem', backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-main)', outline: 'none',
            }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {['All', 'Ready', 'Awaiting Clarification', 'Not Enough Info'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '7px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '0.82rem', fontWeight: statusFilter === s ? 600 : 400,
                backgroundColor: statusFilter === s ? 'var(--primary)' : 'var(--bg-surface)',
                color: statusFilter === s ? '#fff' : 'var(--text-muted)',
                outline: statusFilter === s ? 'none' : '1px solid var(--border)',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {(statusFilter !== 'All' || classFilter !== 'All' || searchQuery) && (
          <button
            onClick={() => { setStatusFilter('All'); setClassFilter('All'); setSearchQuery(''); }}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-muted)' }}
          >
            <RotateCcw size={13} /> Clear
          </button>
        )}
      </div>

      {/* ── Main Table ──────────────────────────────────────────────────── */}
      <div className={styles.sectionCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Classified Members</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Subscriber</th>
                <th>Classification</th>
                <th>Routing Target</th>
                <th>Coverage Start</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    Loading classified members…
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    {classifierMembers.length === 0
                      ? 'No classified members yet. Upload files and run business validation in the Integrity Workbench.'
                      : 'No records match your current filters.'}
                  </td>
                </tr>
              )}
              {filtered.map((member, idx) => {
                const snap = member.history?.[member.latest_update];
                const info = snap?.member_info || {};
                const name = info.first_name ? `${info.first_name} ${info.last_name}` : 'Unknown';
                const coverageStart = fmtDate(snap?.coverages?.[0]?.coverage_start_date);
                const cfg = getClassConfig(member.classification || '');
                
                // Show "Unclassified" if no classification yet, otherwise show the classification
                const displayClassification = member.classification ? cfg.label : 'Unclassified';
                const classificationColor = member.classification ? cfg.color : '#6b7280';
                const classificationBg = member.classification ? cfg.bg : 'rgba(107,114,128,0.1)';

                return (
                  <tr key={`${member.subscriber_id}-${idx}`}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
                        {member.subscriber_id}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '4px 10px', borderRadius: '20px',
                        fontSize: '0.75rem', fontWeight: 700,
                        backgroundColor: classificationBg, color: classificationColor,
                        border: `1px solid ${classificationColor}22`,
                      }}>
                        {displayClassification}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {member.classification ? cfg.agent : '—'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {coverageStart}
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
