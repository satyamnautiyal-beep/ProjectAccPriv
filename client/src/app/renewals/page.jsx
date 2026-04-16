'use client';

import React from 'react';
import { AlertTriangle, Clock, ShieldCheck, Mail } from 'lucide-react';
import styles from './renewals.module.css';
import Annotation from '../../components/Annotation';

const renewalData = [
  { id: 'REN-102', name: 'Alfonso Rivera', plan: 'Gold Plus', deadline: '2026-10-31', daysLeft: 5, completion: 40 },
  { id: 'REN-103', name: 'Betty Smith', plan: 'Silver Base', deadline: '2026-11-02', daysLeft: 7, completion: 80 },
  { id: 'REN-104', name: 'Charles Mingus', plan: 'Bronze Lite', deadline: '2026-11-15', daysLeft: 20, completion: 15 },
  { id: 'REN-105', name: 'Diana Ross', plan: 'Gold Plus', deadline: '2026-11-20', daysLeft: 25, completion: 100 },
];

export default function Renewals() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Renewals & Updates</h1>
      </header>

      <Annotation
        title="Urgency Metrics"
        what="Topline cards summarizing immediate action items based on deadlines."
        why="Renewals are time-sensitive. Visualizing approaching deadlines prevents coverage lapses."
        how="Using universally understood warning colors (Yellow, Red) for escalating urgency."
      >
        <div className={styles.metricsGrid}>
          <div className={styles.metricCard}>
            <div className={styles.metricInfo}>
              <span className={styles.metricLabel}>Due &lt; 7 Days</span>
              <span className={styles.metricValue}>14</span>
            </div>
            <div className={`${styles.metricIcon} ${styles.danger}`}>
              <AlertTriangle size={24} />
            </div>
          </div>
          
          <div className={styles.metricCard}>
            <div className={styles.metricInfo}>
              <span className={styles.metricLabel}>Due &lt; 30 Days</span>
              <span className={styles.metricValue}>86</span>
            </div>
            <div className={`${styles.metricIcon} ${styles.warning}`}>
              <Clock size={24} />
            </div>
          </div>
          
          <div className={styles.metricCard}>
            <div className={styles.metricInfo}>
              <span className={styles.metricLabel}>Successfully Renewed</span>
              <span className={styles.metricValue}>1,204</span>
            </div>
            <div className={`${styles.metricIcon} ${styles.primary}`}>
              <ShieldCheck size={24} />
            </div>
          </div>
        </div>
      </Annotation>

      <Annotation
        title="Deadline Tracking Table"
        what="A list view of upcoming renewals with visual progress indicators."
        why="Workers need to know exactly how complete a renewal packet is without opening it."
        how="Injecting mini horizontal progress bars and color-coded text to indicate 'Days Left'."
      >
        <div className={styles.tableContainer}>
          <div className={styles.tableHeader}>
            <span className={styles.tableTitle}>Upcoming Deadlines</span>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Member</th>
                <th>Plan Tier</th>
                <th>Deadline</th>
                <th>Days Left</th>
                <th>Packet Completion</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {renewalData.map((row) => {
                const urgencyClass = row.daysLeft <= 7 ? styles.danger : row.daysLeft <= 14 ? styles.warning : styles.safe;
                
                return (
                  <tr key={row.id}>
                    <td>
                      <div><strong>{row.name}</strong></div>
                      <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>{row.id}</div>
                    </td>
                    <td>{row.plan}</td>
                    <td>{row.deadline}</td>
                    <td>
                      <span className={`${styles.daysLeft} ${urgencyClass}`}>
                        {row.daysLeft} days
                      </span>
                    </td>
                    <td>
                      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '2px'}}>
                        <span>{row.completion}%</span>
                        {row.completion === 100 && <span style={{color: 'var(--success)'}}>Ready</span>}
                      </div>
                      <div className={styles.progressBar}>
                        <div 
                          className={`${styles.progressFill} ${row.completion < 50 ? styles.danger : row.completion < 100 ? styles.warning : ''}`} 
                          style={{ width: `${row.completion}%` }}
                        ></div>
                      </div>
                    </td>
                    <td>
                      <button className={styles.actionButton}>
                        {row.completion === 100 ? 'Process' : 'Remind'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Annotation>
    </div>
  );
}
