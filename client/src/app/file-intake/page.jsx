'use client';

import React, { useRef, useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import { FileText, UploadCloud, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

export default function FileIntakePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const router = useRouter();
  const [isDragging, setIsDragging] = useState(false);
  
  // UI states for validation simulation feedback
  const [uploadState, setUploadState] = useState(''); // 'reviewing', 'error', 'success'
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const handleCheckStructure = async () => {
    setIsChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch('/api/check-structure', { method: 'POST' });
      const data = await res.json();
      setCheckResult({ healthy: data.healthy, issues: data.issues });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    } catch(err) {
      console.error(err);
    } finally {
      setIsChecking(false);
    }
  };

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: () => fetch('/api/files').then(res => res.json()),
    refetchInterval: 2000
  });

  const uploadMutation = useMutation({
    mutationFn: async (fileList) => {
      setUploadState('uploading');
      
      for (let i = 0; i < fileList.length; i++) {
        const formData = new FormData();
        formData.append('file', fileList[i]);
        
        try {
          await fetch('/api/upload', {
            method: 'POST',
            body: formData
          });
        } catch (e) {}
      }
      
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setUploadState('success');
      setTimeout(() => setUploadState(''), 2000);
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reject-corrupt', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setCheckResult(prev => prev ? {...prev, issues: 0} : null);
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

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Healthy': return <span className={`${styles.badge} ${styles.approved}`}>Healthy</span>;
      case 'Unchecked': return <span className={`${styles.badge} ${styles.review}`}>Unchecked</span>;
      case 'Corrupt': return <span className={styles.badge} style={{backgroundColor: 'var(--danger-light)', color: 'var(--danger)'}}>Corrupt</span>;
      case 'Broken': return <span className={styles.badge} style={{backgroundColor: 'var(--danger-light)', color: 'var(--danger)'}}>Broken Structure</span>;
      case 'Clean': return <span className={`${styles.badge} ${styles.approved}`}>Clean</span>;
      default: return <span className={styles.badge}>{status}</span>;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <div>
          <h1 className={styles.title}>Batch Onboard</h1>
        </div>
        <button 
          onClick={handleCheckStructure}
          disabled={isChecking}
          style={{
            backgroundColor: 'var(--primary)', color: '#fff', border: 'none', padding: '8px 16px', 
            borderRadius: '8px', cursor: isChecking ? 'not-allowed' : 'pointer', opacity: isChecking ? 0.7 : 1,
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'
          }}
        >
          {isChecking && <RefreshCw size={16} className="animate-spin" />}
          {isChecking ? 'Checking...' : 'Check Batch Health'}
        </button>
      </div>

      {checkResult && (
        <div style={{
          marginBottom: 'var(--space-6)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
          backgroundColor: checkResult.issues > 0 ? 'var(--danger-light)' : 'var(--success-light)',
          color: checkResult.issues > 0 ? 'var(--danger-dark)' : 'var(--success-dark)',
          fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {checkResult.issues > 0 ? <AlertTriangle size={20} /> : <span style={{fontSize: '20px'}}>✓</span>}
            <span>Structure validation complete! {checkResult.healthy} files are healthy and {checkResult.issues} file(s) have structural issues.</span>
          </div>
          <div style={{display: 'flex', gap: '16px', alignItems: 'center'}}>
            {checkResult.issues > 0 && (
              <button 
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                style={{
                  backgroundColor: 'var(--danger)', color: 'white', border: 'none', padding: '6px 16px',
                  borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600
                }}
              >
                {rejectMutation.isPending ? 'Sending...' : 'Send back to broker?'}
              </button>
            )}
            <button 
              onClick={() => setCheckResult(null)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', 
                color: 'inherit', display: 'flex', alignItems: 'center', padding: '4px',
                opacity: 0.8, transition: 'opacity 0.2s'
              }}
              title="Acknowledge and dismiss"
              onMouseOver={(e) => e.currentTarget.style.opacity = 1}
              onMouseOut={(e) => e.currentTarget.style.opacity = 0.8}
            >
              <Check size={24} />
            </button>
          </div>
        </div>
      )}

      {uploadState === 'error' && (
        <Annotation title="Alert" what="handles invalid input" why="Business logic barrier" how="Ensures structural trash files never pollute downstream systems.">
          <div style={{backgroundColor: 'var(--danger-light)', border: '1px solid var(--danger)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-6)', fontWeight: 600}}>
            <AlertTriangle size={20} />
            File structure issue detected. Broker has been notified.
          </div>
        </Annotation>
      )}



      {uploadState === 'reviewing' && (
         <div style={{backgroundColor: 'var(--primary-light)', border: '1px solid var(--primary)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-6)', fontWeight: 600}}>
           <RefreshCw size={20} className="animate-spin" />
           Reviewing file structure...
         </div>
      )}

      <Annotation
        title="Upload"
        what="start of workflow"
        why="Ingestion point"
        how="Accepts raw EDI package feeds securely."
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
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            style={{ display: 'none' }} 
            accept=".csv, .xlsx, .xls, .edi"
            multiple
          />
          {uploadState === 'reviewing' ? (
            <RefreshCw size={48} className="animate-spin" color="var(--primary)" style={{marginBottom: 'var(--space-4)'}} />
          ) : (
            <UploadCloud size={48} color="var(--primary)" style={{marginBottom: 'var(--space-4)'}} />
          )}
          <h3 style={{fontWeight: 600, fontSize: '1.2rem', marginBottom: 'var(--space-2)'}}>Upload .EDI files</h3>
          <p style={{color: 'var(--text-muted)'}}>Drag & drop files here or click anywhere in this box to browse</p>
        </div>
      </Annotation>

      <Annotation
        title="Validation decision"
        what="controls system flow"
        why="Prevents downstream failures"
        how="Evaluates payload integrity dynamically."
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Uploads</h2>
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan="2" style={{textAlign: 'center', padding: 'var(--space-6)'}}>Loading processed files...</td></tr>}
              {!isLoading && files.length === 0 && <tr><td colSpan="2" style={{textAlign: 'center', padding: 'var(--space-6)'}}>No files uploaded yet. Drag and drop sample .EDI files above.</td></tr>}
              {files.map(file => (
                <tr key={file.id}>
                  <td>
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500}}>
                      <FileText size={16} className={styles.kpiIcon} style={{padding: '2px', background: 'transparent'}}/>
                      {file.fileName.endsWith('.edi') ? file.fileName : `${file.fileName.split('.')[0] || file.fileName}.edi`}
                    </div>
                  </td>
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
