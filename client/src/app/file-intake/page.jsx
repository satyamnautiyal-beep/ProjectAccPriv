'use client';

import React, { useRef, useState } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import fi from './file-intake.module.css';
import {
  FileText, UploadCloud, RefreshCw, AlertTriangle, Check,
  X, ShieldAlert, ShieldCheck, Clock, Loader2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isPassed = (status = '') => {
  const s = status.toLowerCase();
  return s.includes('healthy') || s.includes('clean') || s.includes('parsed');
};

const isCorrupt = (status = '') => {
  const s = status.toLowerCase();
  return (
    s.includes('corrupt') || s.includes('broken') || s.includes('cannot') ||
    s.includes('parsing failed') || s.includes('structure error') || s.includes('invalid')
  );
};

const isNew = (file) => {
  if (!file.uploadedAt) return false;
  return Date.now() - new Date(file.uploadedAt).getTime() < 10 * 60 * 1000;
};

const sortFiles = (files = []) =>
  [...files].sort((a, b) => {
    const aCorrupt = isCorrupt(a.status) ? 0 : 1;
    const bCorrupt = isCorrupt(b.status) ? 0 : 1;
    if (aCorrupt !== bCorrupt) return aCorrupt - bCorrupt;
    return (isNew(a) ? 0 : 1) - (isNew(b) ? 0 : 1);
  });

/** Returns status badge config. Unverified = anything not yet checked. */
const getStatusMeta = (status = '') => {
  if (isPassed(status))
    return { label: 'Verified', cls: fi.statusReady, icon: <ShieldCheck size={12} /> };
  if (isCorrupt(status))
    return { label: 'Cannot be Processed', cls: fi.statusCorrupt, icon: <ShieldAlert size={12} /> };
  // Default — freshly uploaded or pending check
  return { label: 'Not Verified', cls: fi.statusDefault, icon: <Clock size={12} /> };
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function FileIntakePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const { data: rawFiles = [], isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: () => fetch('/api/files').then((r) => r.json()),
    refetchInterval: 2000,
  });

  // Passed files disappear from this view — they move to Integrity Workbench
  const files = sortFiles(rawFiles.filter((f) => !isPassed(f.status)));
  const corruptCount = files.filter((f) => isCorrupt(f.status)).length;

  const handleCheckStructure = async () => {
    setIsChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch('/api/check-structure', { method: 'POST' });
      const data = await res.json();
      setCheckResult({ healthy: data.healthy, issues: data.issues });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
    } catch (err) {
      console.error(err);
    } finally {
      setIsChecking(false);
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (fileList) => {
      setUploadState('uploading');
      for (let i = 0; i < fileList.length; i++) {
        const formData = new FormData();
        formData.append('file', fileList[i]);
        try { await fetch('/api/upload', { method: 'POST', body: formData }); } catch {}
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setUploadState('success');
      setTimeout(() => setUploadState(''), 2000);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reject-corrupt', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setCheckResult((prev) => (prev ? { ...prev, issues: 0 } : null));
    },
  });

  const handleFileUpload = (e) => {
    if (e.target.files?.length > 0) uploadMutation.mutate(e.target.files);
  };

  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length > 0) uploadMutation.mutate(e.dataTransfer.files);
  };

  const corruptFiles = files.filter((f) => isCorrupt(f.status));
  const pendingFiles = files.filter((f) => !isCorrupt(f.status));

  const renderRow = (file) => {
    const corrupt = isCorrupt(file.status);
    const { label, cls, icon } = getStatusMeta(file.status);

    return (
      <tr key={file.id} className={corrupt ? fi.fileRowCorrupt : ''}>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={14} color={corrupt ? 'var(--danger)' : 'var(--primary)'} style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>
              {file.fileName?.endsWith('.edi') ? file.fileName : `${file.fileName}.edi`}
            </span>
          </div>
        </td>
        <td>
          <span className={`${fi.statusBadge} ${cls}`}>
            {icon}
            {label}
          </span>
          {corrupt && (
            <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: 4 }}>
              {file.error || 'File cannot be parsed — return to broker'}
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Subscriber Onboard</h1>
          <p className={styles.subtitle}>
            Upload and validate EDI 834 files. Corrupted files are automatically surfaced for action.
          </p>
        </div>
        <button
          onClick={handleCheckStructure}
          disabled={isChecking}
          style={{
            backgroundColor: 'var(--primary)', color: '#fff', border: 'none',
            padding: '8px 18px', borderRadius: '8px',
            cursor: isChecking ? 'not-allowed' : 'pointer',
            opacity: isChecking ? 0.7 : 1,
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem',
          }}
        >
          {isChecking
            ? <><RefreshCw size={16} className="animate-spin" /> Checking…</>
            : <><RefreshCw size={16} /> Check Batch Health</>}
        </button>
      </div>

      {/* Check result banner */}
      {checkResult && (
        <div style={{
          padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
          backgroundColor: checkResult.issues > 0 ? 'var(--danger-light)' : 'var(--success-light)',
          color: checkResult.issues > 0 ? 'var(--danger-dark)' : 'var(--success-dark)',
          fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {checkResult.issues > 0 ? <AlertTriangle size={20} /> : <Check size={20} />}
            <span>Validation complete — {checkResult.healthy} healthy, {checkResult.issues} with issues.</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {checkResult.issues > 0 && (
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                style={{
                  backgroundColor: 'var(--danger)', color: 'white', border: 'none',
                  padding: '6px 14px', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '0.85rem', fontWeight: 600,
                }}
              >
                {rejectMutation.isPending ? 'Sending…' : 'Return to broker'}
              </button>
            )}
            <button onClick={() => setCheckResult(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Upload zone */}
      <Annotation
        title="File Upload"
        what="Entry point for EDI 834 batch files"
        why="Secure ingestion of raw enrollment data from brokers"
        how="Accepts .edi files via drag-and-drop or file picker; triggers immediate structural validation"
      >
        <div
          className={styles.sectionCard}
          style={{
            padding: 'var(--space-8)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            border: isDragging ? '2px dashed var(--primary)' : '2px dashed var(--border)',
            backgroundColor: isDragging ? 'var(--primary-light)' : 'var(--bg-root)',
            cursor: 'pointer', transition: 'all 0.2s ease',
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} accept=".csv,.xlsx,.xls,.edi" multiple />
          {uploadState === 'uploading'
            ? <RefreshCw size={44} className="animate-spin" color="var(--primary)" style={{ marginBottom: 'var(--space-4)' }} />
            : <UploadCloud size={44} color="var(--primary)" style={{ marginBottom: 'var(--space-4)' }} />}
          <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 'var(--space-2)' }}>
            {uploadState === 'uploading' ? 'Uploading…' : 'Upload .EDI files'}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Drag & drop files here, or click to browse</p>
        </div>
      </Annotation>

      {/* File table — simplified */}
      <Annotation
        title="Corrupted File Prioritization"
        what="Corrupted files automatically surfaced at the top of the list"
        why="Ensures case workers immediately see files that need urgent action before processing downstream"
        how="Frontend sorts by status — corrupt files rise to top, new uploads follow, rest below"
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Uploads</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {corruptCount > 0 && (
                <span className={`${fi.statusBadge} ${fi.statusCorrupt}`} style={{ fontSize: '0.72rem' }}>
                  <ShieldAlert size={11} />
                  {corruptCount} file{corruptCount > 1 ? 's' : ''} need action
                </span>
              )}
            </div>
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                    <Loader2 size={20} className={fi.spin} style={{ display: 'inline-block', marginRight: 8 }} />
                    Loading files…
                  </td>
                </tr>
              )}
              {!isLoading && files.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                    No pending files. All uploads have been verified and moved to the Integrity Workbench.
                  </td>
                </tr>
              )}

              {corruptFiles.length > 0 && (
                <>
                  <tr>
                    <td colSpan={2} style={{ padding: 0 }}>
                      <div className={`${fi.sectionDivider} ${fi.sectionDividerCorrupt}`}>
                        <span className={fi.sectionDividerDot} />
                        Requires Immediate Action — {corruptFiles.length} corrupted file{corruptFiles.length > 1 ? 's' : ''}
                      </div>
                    </td>
                  </tr>
                  {corruptFiles.map(renderRow)}
                </>
              )}

              {pendingFiles.length > 0 && (
                <>
                  {corruptFiles.length > 0 && (
                    <tr>
                      <td colSpan={2} style={{ padding: 0 }}>
                        <div className={fi.sectionDivider}>
                          <span className={fi.sectionDividerDot} />
                          Pending Verification
                        </div>
                      </td>
                    </tr>
                  )}
                  {pendingFiles.map(renderRow)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Annotation>
    </div>
  );
}
