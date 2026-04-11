import { db } from '@/lib/firebase';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  runTransaction,
  where,
  increment,
} from 'firebase/firestore';
import type { EmporiumConfigDoc, ShopPurchaseReceiptDoc, ShopSkuDoc, ShopCurrency } from '@/types/shop';

const DEFAULT_CONFIG: EmporiumConfigDoc = {
  id: 'global',
  currentSeasonId: 'qc_s1',
  featuredSkuIds: ['sku_title_chrono_agent', 'sku_title_workshop_elite'],
  updatedAt: new Date().toISOString(),
};

export async function getEmporiumConfig(): Promise<EmporiumConfigDoc | null> {
  const snap = await getDoc(doc(db, 'emporium_config', 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<EmporiumConfigDoc>;
  return {
    id: 'global',
    currentSeasonId: typeof (data as any).currentSeasonId === 'string' ? ((data as any).currentSeasonId as string) : 'qc_s1',
    featuredSkuIds: Array.isArray((data as any).featuredSkuIds) ? ((data as any).featuredSkuIds as string[]) : [],
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureEmporiumConfig(): Promise<EmporiumConfigDoc> {
  const existing = await getEmporiumConfig();
  if (existing) return existing;
  try {
    await setDoc(doc(db, 'emporium_config', 'global'), DEFAULT_CONFIG, { merge: true });
  } catch {
    // ignore permissions
  }
  return DEFAULT_CONFIG;
}

export async function getShopSku(skuId: string): Promise<ShopSkuDoc | null> {
  const snap = await getDoc(doc(db, 'shop_skus', skuId));
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return { id: skuId, ...(data as Omit<ShopSkuDoc, 'id'>) };
}

export async function ensureDefaultSkus(): Promise<void> {
  const now = new Date().toISOString();
  const defaults: ShopSkuDoc[] = [
    {
      id: 'sku_title_chrono_agent',
      type: 'title',
      name: 'Title: Chrono Agent',
      description: 'Official field designation for timeline repairs.',
      price: { currency: 'chrono_coins', amount: 250 },
      itemId: 'title_chrono_agent',
      active: true,
      updatedAt: now,
    },
    {
      id: 'sku_title_workshop_elite',
      type: 'title',
      name: 'Title: Workshop Elite',
      description: 'A rare mark earned in the Renaissance Workshop.',
      price: { currency: 'credits', amount: 40 },
      itemId: 'title_workshop_elite',
      active: true,
      updatedAt: now,
    },
  ];

  for (const sku of defaults) {
    try {
      await setDoc(doc(db, 'shop_skus', sku.id), {
        type: sku.type,
        name: sku.name,
        description: sku.description ?? null,
        price: sku.price,
        itemId: sku.itemId,
        active: sku.active,
        updatedAt: sku.updatedAt,
      } as any, { merge: true });
    } catch {
      // ignore if no permission to seed
    }
  }
}

export async function listActiveSkus(): Promise<ShopSkuDoc[]> {
  // If rules disallow list filters, this still requires list permission.
  const q0 = query(collection(db, 'shop_skus'), where('active', '==', true));
  const snaps = await getDocs(q0);
  return snaps.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ShopSkuDoc));
}

function invFieldForCurrency(c: ShopCurrency): 'credits' | 'chronoCoins' {
  return c === 'credits' ? 'credits' : 'chronoCoins';
}

export async function purchaseSku(uid: string, skuId: string): Promise<void> {
  const sku = await getShopSku(skuId);
  if (!sku) throw new Error('SKU not found');
  if (!sku.active) throw new Error('SKU inactive');

  const invRef = doc(db, 'users', uid, 'inventory', 'global');
  const receiptRef = doc(db, 'users', uid, 'shop_purchases', skuId);

  await runTransaction(db, async (tx) => {
    const now = new Date().toISOString();

    const existingReceipt = await tx.get(receiptRef);
    if (existingReceipt.exists()) {
      // Idempotent: receipt already recorded => do nothing.
      return;
    }

    const invSnap = await tx.get(invRef);
    if (!invSnap.exists()) throw new Error('Inventory missing');
    const inv = invSnap.data() as any;

    // Ownership check (server-enforced by transaction reads)
    if (sku.type === 'title') {
      const titles = Array.isArray(inv?.owned?.titles) ? (inv.owned.titles as string[]) : [];
      if (titles.includes(sku.itemId)) {
        // Record receipt anyway? We treat existing ownership as already purchased.
        const receipt: ShopPurchaseReceiptDoc = {
          id: skuId,
          skuId,
          skuType: sku.type,
          itemId: sku.itemId,
          price: sku.price,
          status: 'complete',
          createdAt: now,
          updatedAt: now,
        };
        tx.set(receiptRef, receipt);
        return;
      }
    }

    const field = invFieldForCurrency(sku.price.currency);
    const bal = typeof inv[field] === 'number' ? inv[field] : 0;
    if (bal < sku.price.amount) throw new Error('Not enough currency');

    // Spend currency
    tx.update(invRef, {
      [field]: increment(-sku.price.amount),
      updatedAt: now,
    });

    // Grant item
    if (sku.type === 'title') {
      tx.update(invRef, {
        'owned.titles': arrayUnion(sku.itemId),
        updatedAt: now,
      });
    }

    const receipt: ShopPurchaseReceiptDoc = {
      id: skuId,
      skuId,
      skuType: sku.type,
      itemId: sku.itemId,
      price: sku.price,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
    };
    tx.set(receiptRef, receipt);
  });
}
