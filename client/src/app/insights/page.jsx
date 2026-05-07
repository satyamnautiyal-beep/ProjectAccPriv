'use client';

import React, { useMemo } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import ins from './insights.module.css';
import { useQuery } from '@tanstack/react-query';
import useUIStore from '@/store/uiStore';
import {
  Package, CheckCircle2, Hourglass, RefreshCw,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_CFG = {
  ENROLLMENT:    { label: 'Enrollment',    color: '#2563eb', bg: 'rgba(59,130,246,0.1)' },
  RENEWAL:       { label: 'Renewal',       color: '#16a34a', bg: 'rgba(34,197,94,0.1)'  },
  RETRO_COVERAGE:{ label: 'Retro Coverage',color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
};

const getPCfg = (type) =>
  PIPELINE_CFG[(type || '').toUpperCase().replace(/[^A-Z_]/g, '_')] || PIPELINE_CFG.ENROLLMENT;

const fmtDateTime = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return ts; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Coloured pipeline type pill */
function PipelinePill({ type }) {
  const cfg = getPCfg(type);
  return (
    <span className={ins.pill} style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

/** Single KPI card */
function KpiCard({ icon, label, value, sub, accent }) {
  return (
    <div className={ins.kpiCard} style={{ borderTop: `3px solid ${accent || 'var(--primary)'}` }}>
      <div className={ins.kpiCardTop}>
        <span className={ins.kpiIcon} style={{ color: accent || 'var(--primary)', background: `${accent || 'var(--primary)'}18` }}>
          {icon}
        </span>
        <span className={ins.kpiLabel}>{label}</span>
      </div>
      <div className={ins.kpiValue}>{value}</div>
      {sub && <div className={ins.kpiSub}>{sub}</div>}
    </div>
  );
}

/** Empty state */
function EmptyState({ icon, title, sub }) {
  return (
    <div className={ins.emptyState}>
      {icon}
      <p className={ins.emptyTitle}>{title}</p>
      {sub && <p className={ins.emptySub}>{sub}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const { data: apiBatches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(r => r.json()),
    refetchInterval: 3000,
  });

  const { processedBatches = [] } = useUIStore();

  // ── Derived data ──────────────────────────────────────────────────────────

  // All completed batches — merge API + store, deduplicated, newest first
  const allCompleted = useMemo(() => {
    const map = new Map();
    processedBatches.forEach(b => map.set(b.batchId, b));
    apiBatches
      .filter(b => b.status === 'Completed')
      .forEach(b => {
        map.set(b.id, {
          batchId:        b.id,
          pipelineType:   b.pipelineType || b.pipeline_type || 'ENROLLMENT',
          membersCount:   b.membersCount  || 0,
          processedCount: b.processedCount ?? b.membersCount ?? 0,
          failedCount:    b.failedCount   || 0,
          completedAt:    b.completedAt   || b.createdAt || '',
          createdAt:      b.createdAt     || '',
        });
      });
    return [...map.values()].sort((a, b) =>
      (b.completedAt || b.createdAt || '').localeCompare(a.completedAt || a.createdAt || '')
    );
  }, [apiBatches, processedBatches]);

  // Pending / in-progress batches (LIFO)
  const pendingBatches = useMemo(() =>
    apiBatches
      .filter(b => b.status === 'Awaiting Approval' || b.status === 'In Progress')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [apiBatches]
  );

  // ── KPI values ────────────────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const completedToday = allCompleted.filter(b => (b.completedAt || b.createdAt || '').slice(0, 10) === today);
  const todayProcessed = completedToday.reduce((s, b) => s + (b.processedCount || 0), 0);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Release Insights</h1>
          <p className={styles.subtitle}>
            Processed batch history and release monitoring.
          </p>
        </div>
        <div className={ins.liveIndicator}>
          <span className={ins.liveDot} />
          Live
        </div>
      </div>

      {/* ── KPI Summary — 2 cards only ───────────────────────────────────── */}
      <Annotation
        title="Workflow KPIs"
        what="Core batch workflow metrics"
        why="Gives operations an instant read on processed and pending batches"
        how="Derived from live /api/batches and persisted processedBatches store"
      >
        <div className={ins.kpiGridTwoCol}>
          <KpiCard
            icon={<CheckCircle2 size={18} />}
            label="Members Processed Today"
            value={completedToday.length}
            sub={`${todayProcessed} members enrolled`}
            accent="#22c55e"
          />
          <KpiCard
            icon={<Hourglass size={18} />}
            label="Pending Release"
            value={pendingBatches.length}
            sub={pendingBatches.length > 0 ? 'Awaiting pipeline initiation' : 'Queue clear'}
            accent="#f59e0b"
          />
        </div>
      </Annotation>

      {/* ── Processed Batch History ──────────────────────────────────────── */}
      <Annotation
        title="Processed Batch Viewer"
        what="Primary historical view of all completed batches"
        why="Full audit trail of every pipeline run"
        how="Merged from live API + persisted store, sorted newest-first"
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <div className={ins.cardHeaderLeft}>
              <Package size={16} color="var(--primary)" />
              <h2 className={styles.cardTitle}>Processed Batch History</h2>
              {allCompleted.length > 0 && (
                <span className={ins.countBadge}>{allCompleted.length}</span>
              )}
            </div>
            {allCompleted.length > 0 && (
              <div className={ins.cardHeaderStats}>
                <span className={ins.statGreen}>
                  ✓ {allCompleted.reduce((s, b) => s + (b.processedCount || 0), 0)} processed
                </span>
                {allCompleted.reduce((s, b) => s + (b.failedCount || 0), 0) > 0 && (
                  <span className={ins.statRed}>
                    ✗ {allCompleted.reduce((s, b) => s + (b.failedCount || 0), 0)} failed
                  </span>
                )}
              </div>
            )}
          </div>

          {batchesLoading ? (
            <div className={ins.loadingRow}>
              <RefreshCw size={16} className={ins.spin} /> Loading batches…
            </div>
          ) : allCompleted.length === 0 ? (
            <EmptyState
              icon={<Package size={36} color="var(--border)" />}
              title="No processed batches yet"
              sub="Completed batches from Release Staging will appear here automatically."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Batch ID</th>
                    <th>Workflow</th>
                    <th>Members</th>
                    <th>Results</th>
                    <th>Upload Time</th>
                    <th>Completion Time</th>
                  </tr>
                </thead>
                <tbody>
                  {allCompleted.map(batch => (
                    <tr key={batch.batchId}>
                      <td>
                        <span className={ins.batchIdCell}>{batch.batchId}</span>
                      </td>
                      <td>
                        <PipelinePill type={batch.pipelineType} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{batch.membersCount}</td>
                      <td>
                        <span className={ins.statGreen}>✓ {batch.processedCount}</span>
                        {batch.failedCount > 0 && (
                          <span className={ins.statRed} style={{ marginLeft: 8 }}>
                            ✗ {batch.failedCount}
                          </span>
                        )}
                      </td>
                      <td className={ins.timeCell}>{fmtDateTime(batch.createdAt)}</td>
                      <td className={ins.timeCell}>{fmtDateTime(batch.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Annotation>

    </div>
  );
}
