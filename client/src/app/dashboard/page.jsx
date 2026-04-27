'use client';

import React from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  Tooltip as RechartsTooltip, Legend, LabelList,
} from 'recharts';
import { Files, Users, AlertTriangle, CheckCircle, Activity, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Colour palette — one distinct colour per member status
// ---------------------------------------------------------------------------
const STATUS_COLORS = {
  'Enrolled (OEP)':          '#22c55e',   // green
  'Enrolled (SEP)':          '#16a34a',   // dark green
  'In Review':               '#3b82f6',   // blue
  'Pending':                 '#6366f1',   // indigo
  'Awaiting Clarification':  '#f59e0b',   // amber
  'Processing Failed':       '#ef4444',   // red
};

// ---------------------------------------------------------------------------
// Custom label rendered ON each pie slice — shows the count
// ---------------------------------------------------------------------------
const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, name }) => {
  if (value === 0) return null;
  const RADIAN = Math.PI / 180;
  // Position label in the middle of the slice arc
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x} y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontSize: '0.72rem', fontWeight: 700, pointerEvents: 'none' }}
    >
      {value}
    </text>
  );
};
const PieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: p } = payload[0];
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '10px 14px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      fontSize: '0.85rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: p.color, flexShrink: 0,
        }} />
        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{name}</span>
      </div>
      <div style={{ color: 'var(--text-muted)' }}>
        Count: <strong style={{ color: 'var(--text-main)' }}>{value}</strong>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Custom legend rendered below the chart
// ---------------------------------------------------------------------------
const PieLegend = ({ data }) => (
  <div style={{
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px 16px',
    justifyContent: 'center',
    padding: '0 8px',
    marginTop: 4,
  }}>
    {data.map((entry) => (
      <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: entry.color, flexShrink: 0,
        }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          {entry.name}
          <span style={{ marginLeft: 4, fontWeight: 700, color: 'var(--text-main)' }}>
            ({entry.value})
          </span>
        </span>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then(res => res.json()),
    refetchInterval: 2000,
  });

  if (isLoading || !data) {
    return <div className={styles.container}>Loading dashboard analytics...</div>;
  }

  const { kpis, pieData } = data;

  if (!kpis || !pieData) {
    return <div className={styles.container}>Loading dashboard analytics...</div>;
  }

  // ---- Funnel data ----
  const funnelData = [
    { label: 'Files Received',       value: kpis.filesToday,          color: '#3b82f6' },
    { label: 'Under Review',         value: kpis.membersIdentified,   color: '#6366f1' },
    { label: 'Needs Attention',      value: kpis.pendingCount,        color: '#f59e0b' },
    { label: 'Ready for Enrollment', value: kpis.readyCount,          color: '#22c55e' },
    { label: 'Enrolled',             value: kpis.completedBatches * 50, color: '#10b981' },
  ];
  const maxFunnelValue = Math.max(...funnelData.map(d => d.value), 1);

  // ---- Pie data — attach canonical colours and filter zero-value slices ----
  const enrichedPie = pieData.map(d => ({
    ...d,
    color: STATUS_COLORS[d.name] || d.color || '#94a3b8',
  }));

  const hasAnyData = enrichedPie.some(d => d.value > 0);

  // When all values are 0, show a single placeholder slice so the chart renders
  const chartData = hasAnyData
    ? enrichedPie.filter(d => d.value > 0)   // hide zero slices from chart
    : [{ name: 'No data yet', value: 1, color: '#e2e8f0' }];

  return (
    <div className={styles.container}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Leadership Overview</h1>
          <p className={styles.subtitle}>Overview of Agentic AI system health and business progress.</p>
        </div>
      </div>

      {/* KPI tiles */}
      <Annotation
        title="KPI Tiles"
        what="Six specific KPI cards for system health."
        why="Gives leadership a snapshot of files in and enrollments out without technical noise."
        how="Placed prominently at the top with recognizable icons."
      >
        <div className={styles.kpiGrid} style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Files Received Today</span>
              <Files className={styles.kpiIcon} size={20} />
            </div>
            <div className={styles.kpiValue}>{kpis.filesToday}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Members Identified</span>
              <Users className={styles.kpiIcon} size={20} />
            </div>
            <div className={styles.kpiValue}>{kpis.membersIdentified}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Members Ready for Enrollment</span>
              <CheckCircle className={styles.kpiIcon} size={20} style={{ color: 'var(--success)', background: 'var(--success-light)' }} />
            </div>
            <div className={styles.kpiValue}>{kpis.readyCount}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Members Awaiting Clarification</span>
              <AlertTriangle className={styles.kpiIcon} size={20} style={{ color: 'var(--warning)', background: 'var(--warning-light)' }} />
            </div>
            <div className={styles.kpiValue}>
              {kpis.awaitingClarification > 0 ? kpis.awaitingClarification : kpis.pendingCount}
            </div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Enrollments in Progress</span>
              <Activity className={styles.kpiIcon} size={20} style={{ color: 'var(--primary)', background: 'var(--primary-light)' }} />
            </div>
            <div className={styles.kpiValue}>{kpis.inProgressBatches}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Completed Enrollments</span>
              <ShieldCheck className={styles.kpiIcon} size={20} style={{ color: 'var(--success)', background: 'var(--success-light)' }} />
            </div>
            <div className={styles.kpiValue}>{kpis.completedBatches}</div>
          </div>
        </div>
      </Annotation>

      {/* Charts row */}
      <div className={styles.gridSystem}>

        {/* Processing Funnel */}
        <Annotation
          title="Processing Funnel"
          what="Visual drop-off distribution of files down to enrollment."
          why="Shows the exact flow of members in the pipeline from start to finish."
          how="Left-aligned horizontal bars grow proportionally to each stage's count."
        >
          <div className={styles.sectionCard} style={{ height: 350 }}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Processing Funnel</h2>
            </div>
            <div style={{
              padding: 'var(--space-5) var(--space-6)',
              display: 'flex', flexDirection: 'column',
              gap: 'var(--space-4)', flex: 1, justifyContent: 'center',
            }}>
              {funnelData.map((step, idx) => {
                const percent = Math.max(5, (step.value / maxFunnelValue) * 100);
                // Guarantee a visible funnel shape when data is all-zero
                const visualPercent = Math.max(10, 100 - idx * 15);
                const finalBarWidth = step.value === 0 ? visualPercent : percent;

                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {/* Label — fixed width, right-aligned */}
                    <div style={{
                      width: 160, fontSize: '0.83rem', fontWeight: 600,
                      color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0,
                    }}>
                      {step.label}
                    </div>

                    {/* Bar track — LEFT aligned */}
                    <div style={{ flex: 1, height: 22, display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{
                        backgroundColor: step.color,
                        height: '100%',
                        width: `${finalBarWidth}%`,
                        borderRadius: 'var(--radius-sm)',
                        transition: 'width 0.5s ease',
                        minWidth: 6,
                      }} />
                    </div>

                    {/* Value */}
                    <div style={{
                      width: 44, fontWeight: 700, fontSize: '0.88rem',
                      color: 'var(--text-main)', textAlign: 'right', flexShrink: 0,
                    }}>
                      {step.value}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Annotation>

        {/* Member Status Pie */}
        <Annotation
          title="Member Status Distribution"
          what="Donut chart showing live distribution across all member statuses."
          why="Gives leadership an instant colour-coded breakdown of pipeline health."
          how="Each slice maps to a distinct status with its own colour; hover for exact counts."
        >
          <div className={styles.sectionCard} style={{ height: 350 }}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Member Status</h2>
            </div>

            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: 'var(--space-3) var(--space-4) var(--space-4)',
              gap: 'var(--space-3)',
            }}>
              {/* Donut chart */}
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={88}
                      paddingAngle={chartData.length > 1 ? 3 : 0}
                      dataKey="value"
                      strokeWidth={2}
                      stroke="var(--bg-surface)"
                      label={hasAnyData ? renderPieLabel : null}
                      labelLine={false}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Custom legend */}
              {hasAnyData
                ? <PieLegend data={enrichedPie.filter(d => d.value > 0)} />
                : (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    No member data yet. Upload and process EDI files to see status distribution.
                  </p>
                )
              }
            </div>
          </div>
        </Annotation>

      </div>
    </div>
  );
}
