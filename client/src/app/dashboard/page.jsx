'use client';

import React from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  Tooltip as RechartsTooltip, Legend, LabelList,
} from 'recharts';
import { Files, Users, AlertTriangle, CheckCircle, Activity, ShieldCheck, TrendingUp, Clock, DollarSign } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Colour palette — one distinct colour per member status
// ---------------------------------------------------------------------------
const STATUS_COLORS = {
  'Enrolled (OEP)':          '#22c55e',
  'Enrolled (SEP)':          '#16a34a',
  'In Review':               '#3b82f6',
  'In Batch':                '#8b5cf6',
  'Ready':                   '#06b6d4',
  'Pending Validation':      '#6366f1',
  'Awaiting Clarification':  '#f59e0b',
  'Processing Failed':       '#ef4444',
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
// Priority badge component
// ---------------------------------------------------------------------------
const PriorityBadge = ({ priority }) => {
  const colors = {
    HIGH: { bg: '#fee2e2', text: '#dc2626' },
    MEDIUM: { bg: '#fef3c7', text: '#d97706' },
    LOW: { bg: '#dbeafe', text: '#2563eb' },
  };
  const color = colors[priority] || colors.LOW;
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: 600,
      backgroundColor: color.bg,
      color: color.text,
    }}>
      {priority}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Status badge component
// ---------------------------------------------------------------------------
const StatusBadge = ({ status }) => {
  const colors = {
    AWAITING_SPECIALIST: { bg: '#fef3c7', text: '#d97706' },
    IN_PROGRESS: { bg: '#dbeafe', text: '#2563eb' },
    COMPLETED: { bg: '#dcfce7', text: '#16a34a' },
    FAILED: { bg: '#fee2e2', text: '#dc2626' },
  };
  const color = colors[status] || colors.AWAITING_SPECIALIST;
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: 600,
      backgroundColor: color.bg,
      color: color.text,
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then(res => res.json()),
    refetchInterval: 2000,
  });

  const { data: renewalAlerts, isLoading: renewalLoading } = useQuery({
    queryKey: ['renewalAlerts'],
    queryFn: () => fetch('/api/renewals/alerts').then(res => res.json()).catch(() => ({ alerts: [] })),
    refetchInterval: 5000,
  });

  const { data: retroCases, isLoading: retroLoading } = useQuery({
    queryKey: ['retroCases'],
    queryFn: () => fetch('/api/retro').then(res => res.json()).catch(() => ({ cases: [] })),
    refetchInterval: 5000,
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
    { label: 'Members Identified',   value: kpis.membersIdentified,   color: '#6366f1' },
    { label: 'Pending Validation',   value: kpis.pendingCount,        color: '#8b5cf6' },
    { label: 'Ready for Enrollment', value: kpis.readyCount,          color: '#06b6d4' },
    { label: 'Enrolled',             value: kpis.enrolledCount,       color: '#22c55e' },
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
            <div className={styles.kpiValue}>{kpis.awaitingClarification}</div>
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
            <div className={styles.kpiValue}>{kpis.enrolledCount}</div>
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

      {/* Renewal Alerts Section */}
      <Annotation
        title="Premium Change Alerts"
        what="Real-time list of renewal 834 premium change alerts requiring specialist review."
        why="Allows specialists to quickly identify and act on significant premium changes."
        how="Sorted by priority (HIGH first), showing member name, delta, and current status."
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <TrendingUp size={18} style={{ marginRight: 8, display: 'inline' }} />
              Premium Change Alerts
            </h2>
            <Link href="/renewals" style={{ color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 500, textDecoration: 'none' }}>
              View All →
            </Link>
          </div>
          <div style={{ padding: 'var(--space-4) var(--space-5)', flex: 1 }}>
            {renewalLoading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading alerts...</p>
            ) : renewalAlerts?.alerts && renewalAlerts.alerts.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {renewalAlerts.alerts.slice(0, 5).map((alert) => (
                  <div key={alert.case_id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--bg-root)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 4 }}>
                        {alert.member_name}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        <DollarSign size={14} style={{ display: 'inline', marginRight: 4 }} />
                        Delta: ${Math.abs(alert.premium_delta).toFixed(2)} {alert.premium_delta > 0 ? '↑' : '↓'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      <PriorityBadge priority={alert.priority} />
                      <StatusBadge status={alert.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No premium change alerts yet.</p>
            )}
          </div>
        </div>
      </Annotation>

      {/* Retro Enrollment Cases Section */}
      <Annotation
        title="Retroactive Enrollment Cases"
        what="Real-time list of retroactive enrollment cases in progress with workflow status."
        why="Allows specialists to track retroactive enrollments and monitor 48-hour deadlines."
        how="Sorted by deadline, showing member name, effective date, current step, and deadline status."
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <Clock size={18} style={{ marginRight: 8, display: 'inline' }} />
              Retroactive Enrollment Cases
            </h2>
            <Link href="/retro-enrollments" style={{ color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 500, textDecoration: 'none' }}>
              View All →
            </Link>
          </div>
          <div style={{ padding: 'var(--space-4) var(--space-5)', flex: 1 }}>
            {retroLoading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading cases...</p>
            ) : retroCases?.cases && retroCases.cases.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {retroCases.cases.slice(0, 5).map((caseItem) => {
                  const deadline = new Date(caseItem.deadline);
                  const now = new Date();
                  const hoursRemaining = Math.round((deadline - now) / (1000 * 60 * 60));
                  const isUrgent = hoursRemaining < 12 && hoursRemaining > 0;
                  
                  return (
                    <div key={caseItem.case_id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 'var(--space-3)',
                      backgroundColor: isUrgent ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-root)',
                      borderRadius: 'var(--radius-md)',
                      border: isUrgent ? '1px solid #fca5a5' : '1px solid var(--border)',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 4 }}>
                          {caseItem.member_name}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          <span>Effective: {caseItem.retro_effective_date}</span>
                          <span style={{ margin: '0 8px' }}>•</span>
                          <span>Step: {caseItem.current_step.replace(/_/g, ' ')}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <div style={{
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          color: isUrgent ? '#dc2626' : 'var(--text-muted)',
                          backgroundColor: isUrgent ? '#fee2e2' : 'var(--bg-root)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                        }}>
                          {hoursRemaining > 0 ? `${hoursRemaining}h left` : 'Expired'}
                        </div>
                        <StatusBadge status={caseItem.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No retroactive enrollment cases yet.</p>
            )}
          </div>
        </div>
      </Annotation>
    </div>
  );
}
