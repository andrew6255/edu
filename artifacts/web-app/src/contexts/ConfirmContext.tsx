import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmContextType {
  confirm: (message: string, title?: string) => Promise<boolean>;
  alert: (message: string, title?: string) => Promise<void>;
  prompt: (message: string, initialValue?: string, title?: string) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<string | undefined>('Confirm');
  const [message, setMessage] = useState('');
  const [resolve, setResolve] = useState<(value: boolean) => void>(() => () => {});
  const [mode, setMode] = useState<'confirm' | 'alert' | 'prompt'>('confirm');
  const [inputValue, setInputValue] = useState('');
  const [resolveAlert, setResolveAlert] = useState<() => void>(() => () => {});
  const [resolvePrompt, setResolvePrompt] = useState<(value: string | null) => void>(() => () => {});

  const confirm = useCallback((message: string, title?: string) => {
    setMode('confirm');
    setMessage(message);
    setTitle(title || 'Are you sure?');
    setOpen(true);
    return new Promise<boolean>((res) => {
      setResolve(() => res);
    });
  }, []);

  const alert = useCallback((message: string, title?: string) => {
    setMode('alert'); setMessage(message); setTitle(title || 'Notice'); setOpen(true);
    return new Promise<void>(res => setResolveAlert(() => res));
  }, []);

  const prompt = useCallback((message: string, initialValue = '', title?: string) => {
    setMode('prompt'); setMessage(message); setTitle(title || 'Enter a value'); setInputValue(initialValue); setOpen(true);
    return new Promise<string | null>(res => setResolvePrompt(() => res));
  }, []);

  const handleCancel = () => {
    setOpen(false);
    if (mode === 'confirm') resolve(false);
    if (mode === 'prompt') resolvePrompt(null);
    if (mode === 'alert') resolveAlert();
  };

  const handleConfirm = () => {
    setOpen(false);
    if (mode === 'confirm') resolve(true);
    if (mode === 'prompt') resolvePrompt(inputValue);
    if (mode === 'alert') resolveAlert();
  };

  // Radix UI's onOpenChange fires when clicking outside
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setOpen(false);
      if (mode === 'confirm') resolve(false);
      if (mode === 'prompt') resolvePrompt(null);
      if (mode === 'alert') resolveAlert();
    } else {
      setOpen(true);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
            {mode === 'prompt' && <input autoFocus value={inputValue} onChange={event => setInputValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') handleConfirm(); }} style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: 'white', outline: 'none' }} />}
          </AlertDialogHeader>
          <AlertDialogFooter>
            {mode !== 'alert' && <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>}
            <AlertDialogAction onClick={handleConfirm} style={{ background: '#3b82f6', color: 'white' }}>{mode === 'alert' ? 'OK' : mode === 'prompt' ? 'Save' : 'Confirm'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
