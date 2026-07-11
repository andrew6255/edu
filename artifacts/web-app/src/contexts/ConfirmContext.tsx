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

  const confirm = useCallback((message: string, title?: string) => {
    setMessage(message);
    setTitle(title || 'Are you sure?');
    setOpen(true);
    return new Promise<boolean>((res) => {
      setResolve(() => res);
    });
  }, []);

  const handleCancel = () => {
    setOpen(false);
    resolve(false);
  };

  const handleConfirm = () => {
    setOpen(false);
    resolve(true);
  };

  // Radix UI's onOpenChange fires when clicking outside
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setOpen(false);
      resolve(false);
    } else {
      setOpen(true);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} style={{ background: '#3b82f6', color: 'white' }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
