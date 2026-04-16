'use client';

import React from 'react';
import { Check, Trash2, Filter } from 'lucide-react';
import styles from './tasks.module.css';
import Annotation from '../../components/Annotation';

const tasks = [
  { id: 1, title: 'Review Escalated Case CAS-8912', desc: 'Case flagged by AI for missing signature on page 4 of the Medicaid application.', time: '10 mins ago', category: 'Action Required', unread: true },
  { id: 2, title: 'Approve Time Off Request', desc: 'Sarah Johnson requested PTO for Nov 12 - Nov 15.', time: '2 hours ago', category: 'Admin', unread: true },
  { id: 3, title: 'Weekly Volume Report Generated', desc: 'Your scheduled report for October Week 3 is ready for download.', time: '1 day ago', category: 'System', unread: false },
  { id: 4, title: 'System Maintenance Notice', desc: 'Platform will be undergoing scheduled maintenance this Sunday 2AM-4AM EST.', time: '2 days ago', category: 'System', unread: false },
];

export default function TaskCenter() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Task Center</h1>
      </header>

      <div className={styles.layout}>
        <Annotation
          title="Filter Sidebar"
          what="Persistent categories acting as email-style folders for notifications."
          why="Prevents task overload by letting users compartmentalize their attention."
          how="Using standardized list items with distinct pill counters to signify unread volumes."
        >
          <div className={styles.filterSidebar}>
            <div className={styles.filterGroup}>
              <div className={styles.filterLabel}>Inbox</div>
              <div className={`${styles.filterItem} ${styles.active}`}>
                All Incoming <span className={styles.filterCount}>12</span>
              </div>
              <div className={styles.filterItem}>
                Action Required <span className={styles.filterCount}>3</span>
              </div>
              <div className={styles.filterItem}>
                System Alerts <span className={styles.filterCount}>9</span>
              </div>
            </div>
            
            <div className={styles.filterGroup}>
              <div className={styles.filterLabel}>Status</div>
              <div className={styles.filterItem}>Unread</div>
              <div className={styles.filterItem}>Completed</div>
              <div className={styles.filterItem}>Archived</div>
            </div>
          </div>
        </Annotation>

        <Annotation
          title="Task Feed"
          what="A detailed chronological list of tasks and notifications."
          why="Tasks act as the core driver of daily workflow. High detail reduces the need to click into tasks."
          how="Using bold/subdued background colors to differentiate read vs unread states instantly."
        >
          <div className={styles.taskList}>
            <div className={styles.listHeader}>
              <div style={{fontWeight: 600}}>All Incoming</div>
              <div className={styles.listActions}>
                <button style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)'}}><Check size={18} title="Mark all as read" /></button>
                <button style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)'}}><Filter size={18} /></button>
              </div>
            </div>
            
            <div className={styles.listContent}>
              {tasks.map(task => (
                <div key={task.id} className={`${styles.taskItem} ${task.unread ? styles.unread : ''}`}>
                  <div className={styles.taskCheckbox}>
                    <input type="checkbox" />
                  </div>
                  <div className={styles.taskDetails}>
                    <div className={styles.taskHeader}>
                      <span className={styles.taskTitle}>{task.title}</span>
                      <span className={styles.taskTime}>{task.time}</span>
                    </div>
                    <div className={styles.taskDesc}>{task.desc}</div>
                    <div className={styles.taskFooter}>
                      <span className={styles.badgeTag}>{task.category}</span>
                      <button style={{background:'none', border:'none', color:'var(--primary)', fontSize:'0.8rem', cursor:'pointer'}}>View Details</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
