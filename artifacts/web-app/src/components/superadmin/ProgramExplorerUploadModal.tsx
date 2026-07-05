import { useState } from 'react';
import { runPhase1Ocr, runPhase2Questions } from '@/lib/localOcrPipeline';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (questions: any[], sourceFileName: string) => void;
}

export default function ProgramExplorerUploadModal({ open, onClose, onSuccess }: Props) {
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');

  if (!open) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setUploadFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setUploadFiles(Array.from(e.target.files));
    }
  };

  const handleCreate = async () => {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setUploadProgress('Starting OCR...');
    
    try {
      const texts: string[] = [];
      for (const f of uploadFiles) {
        if (f.name.endsWith('.txt')) {
          texts.push(await f.text());
        } else {
          setUploadProgress(`Extracting text from ${f.name}...`);
          const res = await runPhase1Ocr(f, f.name.replace(/\.[^.]+$/, ''));
          texts.push(res.rawText);
        }
      }
      
      const combinedText = texts.join('\n\n');
      if (!combinedText.trim()) {
        throw new Error('No text could be extracted from the files.');
      }
      
      setUploadProgress('Analyzing questions with AI...');
      const p2 = await runPhase2Questions(combinedText);
      const allQuestions = (p2.topics || []).flatMap(t => t.questions || []);
      if (allQuestions.length === 0) {
        throw new Error('No questions could be extracted from the text.');
      }
      
      onSuccess(allQuestions, uploadFiles[0].name);
      setUploadFiles([]);
      onClose();
    } catch (err) {
      alert('Upload failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div 
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 24,
          width: '100%',
          maxWidth: 600,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 10, background: '#1e293b' }}>
          <div style={{ fontSize: 18 }}>📄</div>
          <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>Upload Worksheet</div>
          <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 24, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)',
              borderRadius: 10, padding: '14px 16px', fontSize: 13, color: '#c4b5fd', lineHeight: 1.5
            }}>
              <strong>File Importer</strong><br/>
              Upload your PDF worksheets or take photos of exercises. We'll automatically extract the questions and place them into the current folder.
            </div>

            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${dragActive ? '#8b5cf6' : '#334155'}`,
                background: dragActive ? 'rgba(139,92,246,0.05)' : '#0b1220',
                borderRadius: 16, padding: '40px 20px', textAlign: 'center',
                transition: 'all 0.2s', position: 'relative'
              }}
            >
              <input
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg,image/webp,.txt"
                onChange={handleFileChange}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              />
              <div style={{ fontSize: 32, marginBottom: 12 }}>{dragActive ? '📥' : '📄'}</div>
              <div style={{ fontSize: 14, fontWeight: 'bold', color: 'white', marginBottom: 4 }}>
                Drag & Drop files here or click to browse
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Supports .pdf, .png, .jpg, .txt
              </div>
            </div>

            {uploadFiles.length > 0 && (
              <div style={{ background: '#0b1220', border: '1px solid #1f2a44', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div style={{ fontSize: 24 }}>📑</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 'bold', color: 'white' }}>{uploadFiles.length} file(s) selected</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{uploadFiles.map(f => f.name).join(', ')}</div>
                  </div>
                  <button className="ll-btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setUploadFiles([])}>Clear</button>
                </div>

                <button
                  className="ll-btn"
                  disabled={uploading}
                  onClick={handleCreate}
                  style={{
                    width: '100%', padding: '12px', fontSize: 14, fontWeight: 'bold',
                    background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', border: 'none', color: 'white'
                  }}
                >
                  {uploading ? (uploadProgress || 'Processing...') : 'Create Worksheet'}
                </button>
                {uploading && uploadProgress && (
                  <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 8, lineHeight: 1.5, textAlign: 'center' }}>
                    {uploadProgress}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
