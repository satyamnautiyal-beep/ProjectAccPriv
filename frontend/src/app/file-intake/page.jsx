'use client';

import React, { useRef, useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { FileText, UploadCloud, RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function FileIntakePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: () => fetch('/api/files').then(res => res.json()),
    refetchInterval: 2000
  });

  const uploadMutation = useMutation({
    mutationFn: async (fileList) => {
      // Supports multiple file processing by mapping into concurrent POST handlers
      const promises = Array.from(fileList).map(file => {
        const formData = new FormData();
        formData.append('file', file);
        return fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });
      });
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    }
  });

  const handleFileUpload = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadMutation.mutate(e.target.files);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadMutation.mutate(e.dataTransfer.files);
    }
  };

  const getStatusBadge = (rawStatus) => {
    const statusMap = {
      'Parsing': 'Reviewing Member Data',
      'Blocking Issue': 'Needs Clarification',
      'Clean': 'Ready for Enrollment',
      'Invalid': 'Cannot be Processed'
    };
    
    // Abstract complexity by remapping
    const status = statusMap[rawStatus] || rawStatus;
    
    switch (status) {
      case 'Ready for Enrollment': return <span className={`${styles.badge} ${styles.approved}`}>{status}</span>;
      case 'Needs Clarification': return <span className={`${styles.badge} ${styles.pending}`}>{status}</span>;
      case 'Reviewing Member Data': return <span className={`${styles.badge} ${styles.review}`}>{status}</span>;
      case 'Cannot be Processed': return <span className={styles.badge} style={{backgroundColor: 'var(--danger-light)', color: 'var(--danger)'}}>{status}</span>;
      default: return <span className={styles.badge}>{status}</span>;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>File Intake</h1>
        </div>
      </div>

      <Annotation
        title="File Upload Area"
        what="enables file intake"
        why="placed at top for visibility"
        how="Allows admin to seamlessly drag single or multiple .EDI files."
      >
        <div 
          className={styles.sectionCard} 
          style={{
            padding: 'var(--space-8)', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            border: isDragging ? '2px dashed var(--primary)' : '2px dashed var(--border)',
            backgroundColor: isDragging ? 'var(--primary-light)' : 'var(--bg-root)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: 'var(--space-6)'
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            multiple
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            style={{ display: 'none' }} 
            accept=".csv, .xlsx, .xls, .edi"
          />
          {uploadMutation.isPending ? (
            <RefreshCw size={48} className="animate-spin" color="var(--primary)" style={{marginBottom: 'var(--space-4)'}} />
          ) : (
            <UploadCloud size={48} color="var(--primary)" style={{marginBottom: 'var(--space-4)'}} />
          )}
          <h3 style={{fontWeight: 600, fontSize: '1.2rem', marginBottom: 'var(--space-2)'}}>Upload .EDI files (single or multiple)</h3>
          <p style={{color: 'var(--text-muted)'}}>Drag & drop files here or click anywhere in this box to browse</p>
        </div>
      </Annotation>

      <Annotation
        title="File Table"
        what="shows processing results"
        why="central for focus"
        how="Status labels simplify backend complexity to improve understanding for leadership without exposing raw X12 failures."
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Uploads</h2>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Members Found</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan="3" style={{textAlign: 'center', padding: 'var(--space-6)'}}>Loading processed files...</td></tr>}
              {!isLoading && files.length === 0 && <tr><td colSpan="3" style={{textAlign: 'center', padding: 'var(--space-6)'}}>No files uploaded yet. Drag and drop sample .EDI files above.</td></tr>}
              {files.map(file => (
                <tr key={file.id}>
                  <td>
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500}}>
                      <FileText size={16} className={styles.kpiIcon} style={{padding: '2px', background: 'transparent'}}/>
                      {/* Forcing string rendering to .EDI extension as requested by business requirements context */}
                      {file.fileName.endsWith('.edi') ? file.fileName : `${file.fileName.split('.')[0] || file.fileName}.edi`}
                    </div>
                  </td>
                  <td>{file.membersCount}</td>
                  <td>{getStatusBadge(file.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Annotation>
    </div>
  );
}
