'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, Users, FileText, AlertCircle, Clock, TrendingUp, TrendingDown, CheckCircle2 } from 'lucide-react';
import styles from './dashboard.module.css';
import Annotation from '../../components/Annotation';

const kpis = [
  { title: 'Total Enrollments', value: '12,450', trend: '+14%', isPositive: true, icon: Users },
  { title: 'Pending Cases', value: '342', trend: '-5%', isPositive: true, icon: FileText },
  { title: 'Action Required', value: '28', trend: '+2', isPositive: false, icon: AlertCircle },
  { title: 'Avg Process Time', value: '2.4 days', trend: '-0.3 days', isPositive: true, icon: Clock },
];

const recentCases = [
  { id: 'CAS-8921', name: 'Robert Chen', type: 'New Enrollment', status: 'In Review', date: 'Oct 24, 2026' },
  { id: 'CAS-8920', name: 'Maria Garcia', type: 'Renewal', status: 'Pending Docs', date: 'Oct 24, 2026' },
  { id: 'CAS-8919', name: 'James Wilson', type: 'Appeal', status: 'Approved', date: 'Oct 23, 2026' },
  { id: 'CAS-8918', name: 'Sarah Johnson', type: 'New Enrollment', status: 'Action Required', date: 'Oct 23, 2026' },
];

const activities = [
  { icon: CheckCircle2, text: 'System automatically verified documents for CAS-8915.', time: '10 mins ago' },
  { icon: AlertCircle, text: 'Discrepancy found in renewal application for Thomas Wright.', time: '45 mins ago' },
  { icon: Users, text: 'Jane Doe assigned 5 new enrollment cases.', time: '2 hours ago' },
];

export default function Dashboard() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard overview</h1>
          <p className={styles.subtitle}>Welcome back, Jane. Here's what's happening today.</p>
        </div>
        <div className={styles.actions}>
          <Link href="/intake" className={styles.primaryButton}>
            <Plus size={18} />
            New Enrollment
          </Link>
        </div>
      </header>
      
      <Annotation
        title="Key Performance Indicators"
        what="Topline metrics displaying real-time enrollment health."
        why="Executives and managers need immediate visibility into bottlenecks and volume."
        how="Using large typography for numbers and distinct color-coded trend indicators (Red/Green) for immediate cognitive processing."
      >
        <div className={styles.kpiGrid}>
          {kpis.map((kpi, idx) => {
            const Icon = kpi.icon;
            return (
              <div key={idx} className={styles.kpiCard}>
                <div className={styles.kpiHeader}>
                  {kpi.title}
                  <div className={styles.kpiIcon}><Icon size={18} /></div>
                </div>
                <div className={styles.kpiValue}>{kpi.value}</div>
                <div className={`${styles.kpiTrend} ${kpi.isPositive ? styles.positive : styles.negative}`}>
                  {kpi.isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  <span>{kpi.trend} from last month</span>
                </div>
              </div>
            );
          })}
        </div>
      </Annotation>

      <div className={styles.gridSystem}>
        <Annotation
          title="Recent Cases Table"
          what="A structured data table showing the most recent case updates."
          why="Case workers spend most of their time monitoring case statuses. A clean table allows rapid scanning."
          how="Implementing minimalist borders and semantic status badges (e.g. Warning for 'Pending Docs')."
        >
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Recent Cases</h2>
              <Link href="/cases" className={styles.viewAll}>View all</Link>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Applicant</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentCases.map((c, i) => (
                  <tr key={i}>
                    <td><Link href={`/cases/${c.id}`} className={styles.viewAll}>{c.id}</Link></td>
                    <td>{c.name}</td>
                    <td>{c.type}</td>
                    <td>
                      <span className={`${styles.badge} ${
                        c.status === 'Approved' ? styles.approved : 
                        c.status === 'In Review' ? styles.review : 
                        styles.pending
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td>{c.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Annotation>

        <Annotation
          title="AI Activity Feed"
          what="A rolling log of system and user activities."
          why="Provides operational context and awareness of automated background tasks (like document verification)."
          how="Built as a vertical timeline using distinct iconography to separate human vs AI actions."
        >
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Activity Feed</h2>
              <Link href="/tasks" className={styles.viewAll}>View tasks</Link>
            </div>
            <ul className={styles.activityFeed}>
              {activities.map((act, i) => {
                const Icon = act.icon;
                return (
                  <li key={i} className={styles.activityItem}>
                    <div className={styles.activityIconWrapper}>
                      <Icon size={16} />
                    </div>
                    <div className={styles.activityContent}>
                      <span className={styles.activityText}>{act.text}</span>
                      <span className={styles.activityTime}>{act.time}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
