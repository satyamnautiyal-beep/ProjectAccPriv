'use client';

import React, { useState } from 'react';
import { User, Mail, Phone, MapPin, Edit3, MessageSquare, History, FileText } from 'lucide-react';
import styles from './members.module.css';
import Annotation from '../../components/Annotation';

export default function MemberProfile() {
  const [activeTab, setActiveTab] = useState('history');

  return (
    <div className={styles.container}>
      <Annotation
        title="Member Header"
        what="A persistent identity banner highlighting the member's core status."
        why="Provides immediate context (name, status) before scrolling into detailed tabs."
        how="Using a large, bold typographic hierarchy and distinct status badges."
      >
        <div className={styles.profileHeader}>
          <div className={styles.identity}>
            <div className={styles.avatar}>RC</div>
            <div>
              <div className={styles.name}>Robert Chen</div>
              <div className={styles.meta}>
                <span>ID: MEM-90412</span>
                <span className={styles.badge}>Active Coverage</span>
              </div>
            </div>
          </div>
          <div className={styles.actions}>
            <button className={styles.btnAction}><MessageSquare size={16}/> Message</button>
            <button className={styles.btnAction}><Edit3 size={16}/> Edit Profile</button>
          </div>
        </div>
      </Annotation>

      <div className={styles.gridSystem}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <User size={18} /> Contact Information
          </div>
          <div className={styles.panelContent}>
            <div className={styles.infoList}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}><Mail size={12} style={{display:'inline', marginRight:4}} /> Email Address</span>
                <span className={styles.infoValue}>robert.chen@example.com</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}><Phone size={12} style={{display:'inline', marginRight:4}} /> Phone Number</span>
                <span className={styles.infoValue}>(555) 432-8765</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}><MapPin size={12} style={{display:'inline', marginRight:4}} /> Mailing Address</span>
                <span className={styles.infoValue}>449 Tech View Dr.<br/>Apt 204<br/>San Jose, CA 95132</span>
              </div>
            </div>
          </div>
        </div>

        <Annotation
          title="Tabbed Detail View"
          what="A comprehensive area organizing complex relational data (history, documents, dependents)."
          why="Prevents endless scrolling by segmenting information into logical buckets."
          how="Local React state handles strict toggling between content panels."
        >
          <div className={styles.panel}>
            <div className={styles.tabList}>
              <div className={`${styles.tab} ${activeTab === 'history' ? styles.active : ''}`} onClick={() => setActiveTab('history')}>
                Interaction History
              </div>
              <div className={`${styles.tab} ${activeTab === 'documents' ? styles.active : ''}`} onClick={() => setActiveTab('documents')}>
                Documents
              </div>
              <div className={`${styles.tab} ${activeTab === 'dependents' ? styles.active : ''}`} onClick={() => setActiveTab('dependents')}>
                Dependents (2)
              </div>
            </div>
            
            <div className={styles.panelContent}>
              {activeTab === 'history' && (
                <div className={styles.timeline}>
                  <div className={styles.timelineItem}>
                    <div className={styles.timelineDot}><span style={{width:8, height:8, background:'var(--primary)', borderRadius:'50%'}}></span></div>
                    <div className={styles.timelineContent}>
                      <div className={styles.timelineTitle}>Enrollment Approved</div>
                      <div className={styles.timelineDesc}>Case worker Jane Doe approved the final application.</div>
                      <div className={styles.timelineDate}>Oct 24, 2026 at 2:45 PM</div>
                    </div>
                  </div>
                  <div className={styles.timelineItem}>
                    <div className={styles.timelineDot}><span style={{width:8, height:8, background:'var(--text-muted)', borderRadius:'50%'}}></span></div>
                    <div className={styles.timelineContent}>
                      <div className={styles.timelineTitle}>Document Verified [AI]</div>
                      <div className={styles.timelineDesc}>System automatically verified W2 income validation.</div>
                      <div className={styles.timelineDate}>Oct 23, 2026 at 11:15 AM</div>
                    </div>
                  </div>
                  <div className={styles.timelineItem}>
                    <div className={styles.timelineDot}><span style={{width:8, height:8, background:'var(--text-muted)', borderRadius:'50%'}}></span></div>
                    <div className={styles.timelineContent}>
                      <div className={styles.timelineTitle}>Application Submitted</div>
                      <div className={styles.timelineDesc}>Initial enrollment intake processed online.</div>
                      <div className={styles.timelineDate}>Oct 23, 2026 at 9:00 AM</div>
                    </div>
                  </div>
                </div>
              )}
              {activeTab !== 'history' && (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Selected tab content for {activeTab}
                </div>
              )}
            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
