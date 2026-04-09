'use client';

import React, { useState } from 'react';
import { Search, Filter, Mail, Phone, Calendar } from 'lucide-react';
import styles from './cases.module.css';
import Annotation from '../../components/Annotation';

const caseData = [
  { id: 'CAS-8921', name: 'Robert Chen', plan: 'Gold Plus', status: 'In Review', rawStatus: 'in_review', submitted: '2026-10-24' },
  { id: 'CAS-8920', name: 'Maria Garcia', plan: 'Silver Base', status: 'Pending Docs', rawStatus: 'pending_docs', submitted: '2026-10-24' },
  { id: 'CAS-8919', name: 'James Wilson', plan: 'Gold Plus', status: 'Approved', rawStatus: 'approved', submitted: '2026-10-23' },
  { id: 'CAS-8918', name: 'Sarah Johnson', plan: 'Bronze Lite', status: 'In Review', rawStatus: 'in_review', submitted: '2026-10-23' },
  { id: 'CAS-8917', name: 'Michael Brown', plan: 'Silver Base', status: 'Pending Docs', rawStatus: 'pending_docs', submitted: '2026-10-22' },
  { id: 'CAS-8916', name: 'Emily Davis', plan: 'Gold Plus', status: 'Approved', rawStatus: 'approved', submitted: '2026-10-21' },
  { id: 'CAS-8915', name: 'David Miller', plan: 'Bronze Lite', status: 'Approved', rawStatus: 'approved', submitted: '2026-10-20' },
];

export default function Cases() {
  const [activeCaseId, setActiveCaseId] = useState('CAS-8920');
  
  const activeCase = caseData.find(c => c.id === activeCaseId) || caseData[0];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Case Management</h1>
      </header>

      <div className={styles.controls}>
        <div className={styles.search}>
          <Search size={18} color="var(--text-muted)" />
          <input type="text" placeholder="Search by ID, name, or plan..." className={styles.searchInput} />
        </div>
        <button className={styles.filterButton}>
          <Filter size={18} />
          Filters
        </button>
      </div>

      <div className={styles.contentSplit}>
        <Annotation
          title="Data Grid"
          what="High-density data table supporting quick sorting and selection."
          why="Power users need to see many cases at once to prioritize their queue efficiently."
          how="Standardizing column widths and utilizing sticky headers for continuous scrolling."
        >
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Applicant Name</th>
                  <th>Plan Tier</th>
                  <th>Status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {caseData.map(c => (
                  <tr 
                    key={c.id} 
                    className={c.id === activeCaseId ? styles.active : ''}
                    onClick={() => setActiveCaseId(c.id)}
                  >
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td>{c.plan}</td>
                    <td><span className={`${styles.badge} ${styles[c.rawStatus]}`}>{c.status}</span></td>
                    <td>{c.submitted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Annotation>

        <Annotation
          title="Contextual Detail Panel"
          what="A side panel displaying deep context for the selected row."
          why="Prevents the user from context-switching or opening an entirely new page to see details."
          how="Updating instantly via client-side state without a server re-render."
        >
          <div className={styles.sidePanel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}>{activeCase.name}</div>
              <div className={styles.panelSubtitle}>{activeCase.id} • {activeCase.status}</div>
            </div>
            
            <div className={styles.panelContent}>
              <div className={styles.detailSection}>
                <div className={styles.detailLabel}>Applicant Information</div>
                <div className={styles.detailGrid}>
                  <div className={styles.detailItem}>
                    <span className={styles.itemKey}>Plan Selection</span>
                    <span className={styles.itemValue}>{activeCase.plan}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.itemKey}>Submission Date</span>
                    <span className={styles.itemValue}>{activeCase.submitted}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.itemKey}><Mail size={12} style={{display:'inline', marginRight:4}} /> Email</span>
                    <span className={styles.itemValue}>{activeCase.name.split(' ')[0].toLowerCase()}@example.com</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.itemKey}><Phone size={12} style={{display:'inline', marginRight:4}} /> Phone</span>
                    <span className={styles.itemValue}>(555) 123-4567</span>
                  </div>
                </div>
              </div>
              
              <div className={styles.detailSection}>
                <div className={styles.detailLabel}>Tasks & Alerts</div>
                {activeCase.rawStatus === 'pending_docs' ? (
                  <div style={{ padding: '12px', background: 'var(--danger-light)', color: 'var(--danger)', borderRadius: '6px', fontSize: '13px', border: '1px solid #fecaca' }}>
                    <strong>Missing Form 1095-A</strong><br/>
                    Dependent proof of coverage missing. Must be submitted by Oct 30.
                  </div>
                ) : (
                  <div style={{ padding: '12px', background: 'var(--success-light)', color: 'var(--success)', borderRadius: '6px', fontSize: '13px', border: '1px solid #bbf7d0' }}>
                    All required documentation verified. Ready for final processing.
                  </div>
                )}
              </div>
            </div>
            
            <div className={styles.actionButtons}>
              <button className={styles.secondaryButton}>Send Message</button>
              <button className={styles.primaryButton}>Update Status</button>
            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
