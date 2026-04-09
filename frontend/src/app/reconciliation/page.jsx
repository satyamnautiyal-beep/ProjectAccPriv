'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import styles from './reconciliation.module.css';
import Annotation from '../../components/Annotation';

const queueData = [
  { id: 'REC-01', name: 'Jonathan Davis', type: 'Duplicate Record', date: '2 hrs ago' },
  { id: 'REC-02', name: 'Alicia Keys', type: 'Address Mismatch', date: '5 hrs ago' },
  { id: 'REC-03', name: 'Marcus Aurelius', type: 'SSN Conflict', date: '1 day ago' },
];

export default function Reconciliation() {
  const [activeItem, setActiveItem] = useState(queueData[0].id);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Data Reconciliation</h1>
      </header>

      <div className={styles.workspace}>
        <Annotation
          title="Triage Queue"
          what="A focused list of records requiring manual intervention."
          why="Data conflicts block enrollment. A dedicated queue ensures these don't fall through the cracks."
          how="Using a split-pane layout so users can process the queue sequentially without page reloads."
        >
          <div className={styles.queuePanel}>
            <div className={styles.queueHeader}>
              Action Queue <span className={styles.queueCount}>3 pending</span>
            </div>
            <div className={styles.queueList}>
              {queueData.map(item => (
                <div 
                  key={item.id} 
                  className={`${styles.queueItem} ${activeItem === item.id ? styles.active : ''}`}
                  onClick={() => setActiveItem(item.id)}
                >
                  <div className={styles.itemTitle}>{item.name}</div>
                  <div className={styles.itemMeta}>{item.type} • {item.date}</div>
                </div>
              ))}
            </div>
          </div>
        </Annotation>

        <Annotation
          title="Side-by-Side Comparison"
          what="A visual diff tool for healthcare records."
          why="Finding discrepancies in large datasets is tedious and error-prone. Highlighting conflicts speeds up resolution."
          how="Highlighting conflicting fields with warning colors while keeping matching fields neutral."
        >
          <div className={styles.comparePanel}>
            <div className={styles.compareHeader}>
              <div className={styles.compareTitle}>Resolve Discrepancy</div>
              <div style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 500 }}>
                <AlertTriangle size={16} /> 1 Conflict Detected
              </div>
            </div>
            
            <div className={styles.compareContent}>
              <div className={styles.recordCol}>
                <div className={styles.recordHeader}>Incoming Application (Source)</div>
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabel}>Full Name</div>
                  <div className={styles.fieldValue}>Jonathan Davis</div>
                </div>
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabel}>Date of Birth</div>
                  <div className={`${styles.fieldValue} ${styles.conflict}`}>1985-04-12</div>
                </div>
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabel}>Home Address</div>
                  <div className={styles.fieldValue}>123 Main St, Springfield IL 62701</div>
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--border-focus)' }}>
                <ArrowRight size={24} />
              </div>

              <div className={styles.recordCol}>
                <div className={styles.recordHeader}>Existing System Record (Master)</div>
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabel}>Full Name</div>
                  <div className={styles.fieldValue}>Jonathan Davis</div>
                </div>
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabel}>Date of Birth</div>
                  <div className={`${styles.fieldValue} ${styles.conflict}`}>1985-04-21</div>
                </div>
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabel}>Home Address</div>
                  <div className={styles.fieldValue}>123 Main St, Springfield IL 62701</div>
                </div>
              </div>
            </div>
            
            <div className={styles.actionFooter}>
              <button className={styles.btnKeepSource}>Over-write with Incoming</button>
              <button className={styles.btnKeepSystem}>Keep Existing Record</button>
            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
