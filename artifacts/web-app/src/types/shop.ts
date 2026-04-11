export type ShopCurrency = 'credits' | 'chrono_coins';

export type ShopSkuType = 'title';

export type ShopSkuDoc = {
  id: string;
  type: ShopSkuType;
  name: string;
  description?: string;
  price: { currency: ShopCurrency; amount: number };
  itemId: string; // for title, this is titleId
  active: boolean;
  updatedAt: string;
};

export type EmporiumConfigDoc = {
  id: 'global';
  currentSeasonId: string;
  featuredSkuIds: string[];
  updatedAt: string;
};

export type ShopPurchaseReceiptStatus = 'complete';

export type ShopPurchaseReceiptDoc = {
  id: string; // skuId for non-consumables
  skuId: string;
  skuType: ShopSkuType;
  itemId: string;
  price: { currency: ShopCurrency; amount: number };
  status: ShopPurchaseReceiptStatus;
  createdAt: string;
  updatedAt: string;
};
