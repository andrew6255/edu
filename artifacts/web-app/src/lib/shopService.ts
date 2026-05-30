import { getUserDoc, setUserDoc, updateUserDoc, getGlobalDoc, setGlobalDoc, queryGlobalDocs, resolveArrayUnion, resolveIncrement } from '@/lib/supabaseDocStore';
import type { EmporiumConfigDoc, ShopPurchaseReceiptDoc, ShopSkuDoc, ShopCurrency } from '@/types/shop';

const DEFAULT_CONFIG: EmporiumConfigDoc = {
  id: 'global',
  currentSeasonId: 'qc_s1',
  featuredSkuIds: ['sku_title_chrono_agent', 'sku_title_workshop_elite'],
  updatedAt: new Date().toISOString(),
};

export async function getEmporiumConfig(): Promise<EmporiumConfigDoc | null> {
  const raw = await getGlobalDoc('emporium_config', 'global');
  if (!raw) return null;
  const data = raw as Partial<EmporiumConfigDoc>;
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
    await setGlobalDoc('emporium_config', 'global', DEFAULT_CONFIG as any, true);
  } catch {
    // ignore permissions
  }
  return DEFAULT_CONFIG;
}

export async function getShopSku(skuId: string): Promise<ShopSkuDoc | null> {
  const raw = await getGlobalDoc('shop_skus', skuId);
  if (!raw) return null;
  return { id: skuId, ...(raw as any as Omit<ShopSkuDoc, 'id'>) };
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
      await setGlobalDoc('shop_skus', sku.id, {
        type: sku.type,
        name: sku.name,
        description: sku.description ?? null,
        price: sku.price,
        itemId: sku.itemId,
        active: sku.active,
        updatedAt: sku.updatedAt,
      }, true);
    } catch {
      // ignore if no permission to seed
    }
  }
}

export async function listActiveSkus(): Promise<ShopSkuDoc[]> {
  const rows = await queryGlobalDocs('shop_skus', [{ field: 'active', op: 'eq', value: 'true' }]);
  return rows.map((r) => ({ id: r.id, ...(r.data as any) } as ShopSkuDoc));
}

function invFieldForCurrency(c: ShopCurrency): 'credits' | 'chronoCoins' {
  return c === 'credits' ? 'credits' : 'chronoCoins';
}

export async function purchaseSku(uid: string, skuId: string): Promise<void> {
  const sku = await getShopSku(skuId);
  if (!sku) throw new Error('SKU not found');
  if (!sku.active) throw new Error('SKU inactive');

  const now = new Date().toISOString();

  // Idempotent: check receipt
  const existingReceipt = await getUserDoc(uid, 'shop_purchases', skuId);
  if (existingReceipt) return;

  const inv = await getUserDoc(uid, 'inventory', 'global');
  if (!inv) throw new Error('Inventory missing');

  // Ownership check
  if (sku.type === 'title') {
    const titles = Array.isArray((inv as any)?.owned?.titles) ? ((inv as any).owned.titles as string[]) : [];
    if (titles.includes(sku.itemId)) {
      const receipt: ShopPurchaseReceiptDoc = {
        id: skuId, skuId, skuType: sku.type, itemId: sku.itemId,
        price: sku.price, status: 'complete', createdAt: now, updatedAt: now,
      };
      await setUserDoc(uid, 'shop_purchases', skuId, receipt as any);
      return;
    }
  }

  const field = invFieldForCurrency(sku.price.currency);
  const bal = typeof (inv as any)[field] === 'number' ? (inv as any)[field] : 0;
  if (bal < sku.price.amount) throw new Error('Not enough currency');

  // Spend currency
  const newBal = bal - sku.price.amount;
  await updateUserDoc(uid, 'inventory', 'global', { [field]: newBal, updatedAt: now });

  // Grant item
  if (sku.type === 'title') {
    const titles = resolveArrayUnion(inv, 'owned.titles', sku.itemId);
    await updateUserDoc(uid, 'inventory', 'global', { 'owned.titles': titles, updatedAt: now });
  }

  const receipt: ShopPurchaseReceiptDoc = {
    id: skuId, skuId, skuType: sku.type, itemId: sku.itemId,
    price: sku.price, status: 'complete', createdAt: now, updatedAt: now,
  };
  await setUserDoc(uid, 'shop_purchases', skuId, receipt as any);
}
