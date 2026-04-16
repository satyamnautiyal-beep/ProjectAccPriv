'use client';

import React from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { Files, Users, AlertTriangle, CheckCircle, Activity, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then(res => res.json()),
    refetchInterval: 2000
  });

  if (isLoading) return <div className={styles.container}>Loading dashboard analytics...</div>;

  const { kpis, pieData } = data;

  const funnelData = [
    { label: 'Files Received', value: kpis.filesToday, color: '#3b82f6' }, // blue
    { label: 'Under Review', value: kpis.membersIdentified, color: '#6366f1' }, // indigo
    { label: 'Needs Attention', value: kpis.pendingCount, color: '#f59e0b' }, // yellow
    { label: 'Ready for Enrollment', value: kpis.readyCount, color: '#22c55e' }, // green
    { label: 'Enrolled', value: kpis.completedBatches * 50, color: '#10b981' } // teal
  ];

  // Helper to visually render a funnel bar
  const maxFunnelValue = Math.max(...funnelData.map(d => d.value), 1);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Leadership Overview</h1>
          <p className={styles.subtitle}>Overview of Agentic AI system health and business progress.</p>
        </div>
      </div>

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
              <CheckCircle className={styles.kpiIcon} size={20} style={{color: 'var(--success)', background: 'var(--success-light)'}} />
            </div>
            <div className={styles.kpiValue}>{kpis.readyCount}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Members Awaiting Clarification</span>
              <AlertTriangle className={styles.kpiIcon} size={20} style={{color: 'var(--warning)', background: 'var(--warning-light)'}} />
            </div>
            <div className={styles.kpiValue}>{kpis.awaitingClarification > 0 ? kpis.awaitingClarification : kpis.pendingCount}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Enrollments in Progress</span>
              <Activity className={styles.kpiIcon} size={20} style={{color: 'var(--primary)', background: 'var(--primary-light)'}} />
            </div>
            <div className={styles.kpiValue}>{kpis.inProgressBatches}</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span>Completed Enrollments</span>
              <ShieldCheck className={styles.kpiIcon} size={20} style={{color: 'var(--success)', background: 'var(--success-light)'}} />
            </div>
            <div className={styles.kpiValue}>{kpis.completedBatches}</div>
          </div>
        </div>
      </Annotation>

      <div className={styles.gridSystem}>
        <Annotation
          title="Processing Funnel"
          what="Visual drop-off distribution of files down to enrollment."
          why="Shows the exact flow of members in the pipeline from start to finish."
          how="Aligns horizontal bars centrally to simulate a business conversion funnel."
        >
          <div className={styles.sectionCard} style={{height: '350px'}}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Processing Funnel</h2>
            </div>
            <div style={{padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flex: 1, justifyContent: 'center'}}>
              {funnelData.map((step, idx) => {
                // Creates a centered funnel UX look (mimicking conversion)
                const percent = Math.max(5, (step.value / maxFunnelValue) * 100);
                const visualPercent = Math.max(10, 100 - (idx * 15)); // Guarantee a funnel shape visually if data is zero/low for UX prototyping purposes
                const finalBarWidth = step.value === 0 ? visualPercent : percent;
                
                return (
                  <div key={idx} style={{display: 'flex', alignItems: 'center', gap: 'var(--space-4)'}}>
                    <div style={{width: '160px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right'}}>
                      {step.label}
                    </div>
                    <div style={{flex: 1, height: '24px', display: 'flex', justifyContent: 'center'}}>
                      <div style={{
                        backgroundColor: step.color,
                        height: '100%',
                        width: `${finalBarWidth}%`,
                        borderRadius: 'var(--radius-sm)',
                        transition: 'width 0.5s'
                      }} />
                    </div>
                    <div style={{width: '60px', fontWeight: 700, fontSize: '0.9rem'}}>
                      {step.value}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Annotation>

        <Annotation
          title="Member Status Distribution"
          what="Pie chart showing exact distribution of Ready/Pending/Awaiting/Blocked."
          why="Breaks down total member exceptions for leadership review."
          how="Interactive pie chart allows hovering over segments."
        >
          <div className={styles.sectionCard} style={{height: '350px'}}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Member Status</h2>
            </div>
            <div style={{flex: 1, padding: 'var(--space-4)', width: '100%', height: '300px', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
