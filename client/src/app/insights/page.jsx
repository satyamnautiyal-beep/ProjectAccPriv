'use client';

import React from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, BarChart, Bar, LineChart, Line } from 'recharts';
import { useQuery } from '@tanstack/react-query';

export default function InsightsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then(res => res.json()),
    refetchInterval: 5000
  });

  const { kpis = {} } = data || {};

  // Formulate Rates dynamically
  const clarificationRate = kpis.membersIdentified ? Math.round((kpis.pendingCount / kpis.membersIdentified) * 100) : 0;
  const enrollmentCompletionRate = kpis.membersIdentified ? Math.round(((kpis.readyCount + (kpis.completedBatches * 50)) / kpis.membersIdentified) * 100) : 0;

  // Trend mocks
  const trendData = [
    { month: 'Jan', enrollments: 4000, clarifications: 240, efficiency: 85 },
    { month: 'Feb', enrollments: 3000, clarifications: 180, efficiency: 88 },
    { month: 'Mar', enrollments: 5500, clarifications: 300, efficiency: 91 },
    { 
      month: 'Current', 
      enrollments: kpis.inProgressBatches * 150 || 0, 
      clarifications: kpis.pendingCount || 0,
      efficiency: Math.min(100, Math.max(50, 100 - clarificationRate))
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>System Insights</h1>
          <p className={styles.subtitle}>Leadership analytics and operational intelligence.</p>
        </div>
      </div>

      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}><span>Avg Processing Time</span></div>
           <div className={styles.kpiValue}>1.2s</div>
           <div className={`${styles.kpiTrend} ${styles.positive}`}>↓ 0.4s vs last month</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}><span>Files Processed</span></div>
           <div className={styles.kpiValue}>{isLoading ? '...' : kpis.filesToday}</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}><span>Clarification Rate</span></div>
           <div className={styles.kpiValue}>{isLoading ? '...' : `${clarificationRate}%`}</div>
           <div className={`${styles.kpiTrend} ${styles.positive}`}>↓ 2% vs last month</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}><span>Enrollment Completion Rate</span></div>
           <div className={styles.kpiValue}>{isLoading ? '...' : `${Math.min(100, enrollmentCompletionRate)}%`}</div>
           <div className={`${styles.kpiTrend} ${styles.positive}`}>↑ 5% vs last month</div>
        </div>
      </div>

      <div className={styles.gridSystem} style={{marginTop: 'var(--space-6)', gridTemplateColumns: 'repeat(3, 1fr)'}}>
        <Annotation
          title="Enrollment Trend"
          what="Area chart tracking total enrollments."
          why="Helps leadership forecast processing volume over time."
          how="Soft areas indicate total volume seamlessly."
        >
          <div className={styles.sectionCard} style={{height: '350px'}}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Enrollment Trend</h2>
            </div>
            <div style={{flex: 1, padding: 'var(--space-4)', width: '100%', height: '300px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEnrollments" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)'}} />
                  <RechartsTooltip />
                  <Area type="monotone" dataKey="enrollments" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#colorEnrollments)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Annotation>

        <Annotation
          title="Clarification Trend"
          what="Bar chart representing AI exceptions."
          why="Visualizes system intelligence improvement."
          how="Tracks whether the AI is getting smarter and dropping manual review thresholds."
        >
          <div className={styles.sectionCard} style={{height: '350px'}}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Clarification Trend</h2>
            </div>
            <div style={{flex: 1, padding: 'var(--space-4)', width: '100%', height: '300px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)'}} />
                  <RechartsTooltip />
                  <Bar dataKey="clarifications" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Annotation>

        <Annotation
          title="Processing Efficiency"
           what="Line chart tracking the automation percentage."
          why="Highlights overall ROI of the Agentic AI platform."
          how="Demonstrates how many users flow through the system cleanly without touching human hands."
        >
          <div className={styles.sectionCard} style={{height: '350px'}}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Processing Efficiency (%)</h2>
            </div>
            <div style={{flex: 1, padding: 'var(--space-4)', width: '100%', height: '300px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)'}} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)'}} />
                  <RechartsTooltip />
                  <Line type="monotone" dataKey="efficiency" stroke="var(--success)" strokeWidth={3} dot={{r: 4, fill: 'var(--success)'}} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
