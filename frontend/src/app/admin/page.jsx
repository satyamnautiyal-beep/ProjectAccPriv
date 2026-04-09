'use client';

import React, { useState } from 'react';
import { Users, Shield, Server, Bell, Key, Database, MoreVertical } from 'lucide-react';
import styles from './admin.module.css';
import Annotation from '../../components/Annotation';

const usersData = [
  { id: 1, name: 'Jane Doe', email: 'jane.doe@example.com', role: 'Agent', initials: 'JD' },
  { id: 2, name: 'John Smith', email: 'john.smith@example.com', role: 'Supervisor', initials: 'JS' },
  { id: 3, name: 'System Admin', email: 'admin@example.com', role: 'Administrator', initials: 'SA' },
  { id: 4, name: 'AI Service Bot', email: 'bot@internal.ai', role: 'System', initials: 'AI' }
];

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState('users');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin Settings</h1>
          <p className={styles.subtitle}>Manage platform configuration, users, and security.</p>
        </div>
      </header>

      <div className={styles.settingsLayout}>
        <Annotation
          title="Settings Navigation"
          what="Vertical tab structure categorizing system configurations."
          why="Horizontal tabs fail to scale when settings categories grow (as they always do in enterprise)."
          how="Using clear iconography and active states tied to local component state."
        >
          <div className={styles.sidebar}>
            <div className={`${styles.navItem} ${activeTab === 'users' ? styles.active : ''}`} onClick={() => setActiveTab('users')}>
              <Users size={18} /> User Management
            </div>
            <div className={`${styles.navItem} ${activeTab === 'roles' ? styles.active : ''}`} onClick={() => setActiveTab('roles')}>
              <Shield size={18} /> Roles & Permissions
            </div>
            <div className={`${styles.navItem} ${activeTab === 'system' ? styles.active : ''}`} onClick={() => setActiveTab('system')}>
              <Server size={18} /> System Config
            </div>
            <div className={`${styles.navItem} ${activeTab === 'integration' ? styles.active : ''}`} onClick={() => setActiveTab('integration')}>
              <Database size={18} /> Integrations & APIs
            </div>
            <div className={`${styles.navItem} ${activeTab === 'security' ? styles.active : ''}`} onClick={() => setActiveTab('security')}>
              <Key size={18} /> Security Log
            </div>
          </div>
        </Annotation>

        <Annotation
          title="User Control Grid"
          what="A detailed table for managing system actors and authorization states."
          why="Supervisors need to rapidly provision or adjust roles for case workers."
          how="Incorporating inline select menus for immediate role adjustments."
        >
          <div className={styles.content}>
            <div className={styles.contentHeader}>
              <div className={styles.contentTitle}>User Directory</div>
              <button className={styles.btnPrimary}>+ Invite User</button>
            </div>
            
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {usersData.map(user => (
                    <tr key={user.id}>
                      <td>
                        <div className={styles.userInfo}>
                          <div className={styles.avatar}>{user.initials}</div>
                          <span style={{fontWeight: 500}}>{user.name}</span>
                        </div>
                      </td>
                      <td>{user.email}</td>
                      <td>
                        <select className={styles.roleSelect} defaultValue={user.role}>
                          <option>Agent</option>
                          <option>Supervisor</option>
                          <option>Administrator</option>
                          <option>System</option>
                        </select>
                      </td>
                      <td>
                        <span style={{color: 'var(--success)', fontWeight: 500, fontSize: '0.85rem'}}>Active</span>
                      </td>
                      <td style={{textAlign: 'right'}}>
                        <button style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)'}}>
                          <MoreVertical size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Annotation>
      </div>
    </div>
  );
}
