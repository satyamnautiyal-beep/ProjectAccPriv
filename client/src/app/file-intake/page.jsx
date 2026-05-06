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

const getStatusMeta = (status = '') => {
  if (isPassed(status))
    return { label: 'Verified', cls: fi.statusReady, icon: <ShieldCheck size={12} /> };
  if (isCorrupt(status))
    return { label: 'Cannot be Processed', cls: fi.statusCorrupt, icon: <ShieldAlert size={12} /> };
  return { label: 'Not Verified', cls: fi.statusDefault, icon: <Clock size={12} /> };
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function FileIntakePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [isDragging, setIsDragging] = useState(false);
  // '' | 'uploading' | 'validating' | 'success'
  const [uploadState, setUploadState] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [isManualChecking, setIsManualChecking] = useState(false);

  // ── Live file list — only files still pending (not yet parsed through) ──
  const { data: rawFiles = [], isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: () => fetch('/api/files').then((r) => r.json()),
    refetchInterval: 2000,
  });

  const files = sortFiles(rawFiles.filter((f) => !isPassed(f.status)));
  const corruptFiles = files.filter((f) => isCorrupt(f.status));
  const pendingFiles = files.filter((f) => !isCorrupt(f.status));
  const corruptCount = corruptFiles.length;

  // ── Structure check — parses healthy files into MongoDB as Pending Business Validation ──
  const runStructureCheck = async () => {
    try {
      const res = await fetch('/api/check-structure', { method: 'POST' });
      const data = await res.json();
      setCheckResult({ healthy: data.healthy, issues: data.issues });
      // Invalidate all downstream queries so Integrity Workbench lights up immediately
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      return data;
    } catch (err) {
      console.error('Structure check error:', err);
      return null;
    }
  };

  // ── Upload → immediately auto-run structure check ────────────────────────
  const uploadMutation = useMutation({
    mutationFn: async (fileList) => {
      setUploadState('uploading');
      setCheckResult(null);
      for (let i = 0; i < fileList.length; i++) {
        const formData = new FormData();
        formData.append('file', fileList[i]);
        try { await fetch('/api/upload', { method: 'POST', body: formData }); } catch {}
      }
      return true;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      // Auto-run structure validation — parses healthy files into MongoDB
      setUploadState('validating');
      await runStructureCheck();
      setUploadState('success');
      setTimeout(() => setUploadState(''), 4000);
    },
  });

  // ── Manual re-check (for files already sitting in the queue) ────────────
  const handleManualCheck = async () => {
    setIsManualChecking(true);
    setCheckResult(null);
    await runStructureCheck();
    setIsManualChecking(false);
  };

  // ── Reject corrupt files ────────────────────────────────────────────────
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

  const isProcessing = uploadState === 'uploading' || uploadState === 'validating';

  const uploadLabel =
    uploadState === 'uploading' ? 'Uploading files...' :
    uploadState === 'validating' ? 'Running structure validation...' :
    uploadState === 'success' ? 'Done — members queued for business validation' :
    'Upload EDI 834 files';

  const uploadSubtext =
    uploadState === 'validating' ? 'Parsing EDI structure and storing members in database...' :
    uploadState === 'success' && checkResult?.healthy > 0 ? 'Head to Integrity Workbench to run business validation' :
    'Structure validation runs automatically — no manual step needed';

  const uploadSubtextColor =
    uploadState === 'success' && checkResult?.healthy > 0 ? 'var(--success)' : 'var(--text-muted)';

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
          <span className={`${fi.statusBadge} ${cls}`}>{icon}{label}</span>
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

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Subscriber Onboarding</h1>
          <p className={styles.subtitle}>
            Upload EDI 834 files. Valid files are automatically parsed and queued for business validation.
          </p>
        </div>
        <button
          onClick={handleManualCheck}
          disabled={isManualChecking || isProcessing}
          style={{
            backgroundColor: 'var(--primary)', color: '#fff', border: 'none',
            padding: '8px 18px', borderRadius: '8px',
            cursor: (isManualChecking || isProcessing) ? 'not-allowed' : 'pointer',
            opacity: (isManualChecking || isProcessing) ? 0.7 : 1,
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem',
          }}
        >
          {isManualChecking
            ? <><RefreshCw size={16} className="animate-spin" /> Checking...</>
            : <><RefreshCw size={16} /> Re-check Files</>}
        </button>
      </div>

      {/* ── Result banner ───────────────────────────────────────────────── */}
      {checkResult && (
        <div style={{
          padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', marginBottom: '16px',
          backgroundColor: checkResult.issues > 0 ? 'var(--danger-light)' : 'var(--success-light)',
          color: checkResult.issues > 0 ? 'var(--danger-dark)' : 'var(--success-dark)',
          fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {checkResult.issues > 0 ? <AlertTriangle size={20} /> : <Check size={20} />}
            <span>
              {checkResult.healthy > 0
                ? `${checkResult.healthy} file${checkResult.healthy > 1 ? 's' : ''} parsed and queued for business validation.`
                : ''}
              {checkResult.issues > 0
                ? ` ${checkResult.issues} file${checkResult.issues > 1 ? 's' : ''} could not be processed.`
                : ''}
              {checkResult.healthy === 0 && checkResult.issues === 0
                ? 'No new files to process.'
                : ''}
            </span>
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
                {rejectMutation.isPending ? 'Sending...' : 'Return to broker'}
              </button>
            )}
            <button
              onClick={() => setCheckResult(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ── Upload zone ─────────────────────────────────────────────────── */}
      <Annotation
        title="File Upload"
        what="Entry point for EDI 834 batch files"
        why="Secure ingestion of raw enrollment data from brokers"
        how="Accepts .edi files via drag-and-drop or file picker. Structure validation runs automatically on upload — healthy files are parsed and stored as Pending Business Validation in MongoDB."
      >
        <div
          className={styles.sectionCard}
          style={{
            padding: 'var(--space-8)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            border: isDragging ? '2px dashed var(--primary)' : '2px dashed var(--border)',
            backgroundColor: isDragging
              ? 'var(--primary-light)'
              : isProcessing
              ? 'rgba(59,130,246,0.03)'
              : 'var(--bg-root)',
            cursor: isProcessing ? 'default' : 'pointer',
            transition: 'all 0.2s ease', minHeight: '200px',
            pointerEvents: isProcessing ? 'none' : 'auto',
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !isProcessing && fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            accept=".edi"
            multiple
          />

          {isProcessing
            ? <RefreshCw size={44} className="animate-spin" color="var(--primary)" style={{ marginBottom: 'var(--space-4)' }} />
            : uploadState === 'success'
            ? <Check size={44} color="var(--success)" style={{ marginBottom: 'var(--space-4)' }} />
            : <UploadCloud size={44} color="var(--primary)" style={{ marginBottom: 'var(--space-4)' }} />}

          <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 'var(--space-2)' }}>
            {uploadLabel}
          </h3>
          <p style={{ color: uploadSubtextColor, fontSize: '0.85rem', textAlign: 'center' }}>
            {uploadSubtext}
          </p>
          {!isProcessing && uploadState !== 'success' && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '8px' }}>
              Drag & drop or click to browse
            </p>
          )}
        </div>
      </Annotation>

      {/* ── Files requiring action (corrupt / unchecked only) ───────────── */}
      {(files.length > 0 || isLoading) && (
        <Annotation
          title="Corrupted File Prioritization"
          what="Files that failed structure validation — surfaced for immediate action"
          why="Ensures case workers see files that need to be returned to the broker before they block downstream processing"
          how="Corrupt files stay in the queue; healthy files are automatically removed after parsing"
        >
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Files Requiring Action</h2>
              {corruptCount > 0 && (
                <span className={`${fi.statusBadge} ${fi.statusCorrupt}`} style={{ fontSize: '0.72rem' }}>
                  <ShieldAlert size={11} />
                  {corruptCount} file{corruptCount > 1 ? 's' : ''} cannot be processed
                </span>
              )}
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
                      Loading files...
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
      )}
    </div>
  );
}
