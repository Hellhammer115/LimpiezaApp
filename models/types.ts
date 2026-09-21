export type OrderStatus =
  | "quote_requested"
  | "quote_sent"
  | "pending"
  | "paid"
  | "preparing"
  | "delivering"
  | "delivered"
  | "cancelled";

/** Fulfillment steps an admin can advance a paid order through, in order. */
export type FulfillmentStatus = "preparing" | "delivering" | "delivered";

/** Pedidos-tab filter: cotizaciones (unpaid) vs pedidos (paid). */
export type OrderKind = "quotes" | "orders";

export interface Profile {
  user_id: string;
  name: string;
  last_name: string;
  phone: string | null;
  email: string;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Address {
  id: string;
  user_id: string;
  label: string;
  street: string;
  colonia: string;
  city: string;
  zip: string;
  notes: string | null;
  is_default: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price_cents: number;
  unit: string;
  image_url: string | null;
  stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Order {
  id: string;
  user_id: string;
  address_id: string | null;
  delivery_address: string;
  status: OrderStatus;
  subtotal_cents: number;
  discount_cents: number;
  /** Set when the admin entered the discount as a percentage. */
  discount_percent: number | null;
  delivery_fee_cents: number;
  total_cents: number;
  delivery_slot: string;
  /** Admin's note to the customer (or the rejection reason). */
  admin_note: string | null;
  /** Customer snapshot taken at request time. */
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  /** Non-null ⇔ this row is a pedido (payment confirmed by the webhook). */
  paid_at: string | null;
  quoted_at: string | null;
  quoted_by: string | null;
  mp_preference_id: string | null;
  mp_init_point: string | null;
  /** Set when the customer "deleted" this cancelled quote from their list. */
  hidden_by_customer_at: string | null;
  /** Set when an admin "deleted" this cancelled quote from the admin list. */
  hidden_by_admin_at: string | null;
  /** Admin who sent this quote; null for customer-requested ones. */
  created_by_admin: string | null;
  mp_payment_id: string | null;
  /** The version the customer last saw before an admin changed the sent quote. */
  previous_quote: QuoteSnapshot | null;
  /** When the current version replaced previous_quote. */
  quote_updated_at: string | null;
  /** When the customer accepted the update; paying needs it ≥ quote_updated_at. */
  quote_update_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  /** Snapshot at request time — survives product deactivation. */
  name: string;
  quantity: number;
  /** Admin-editable quoted price. */
  unit_price_cents: number;
  /** Catalog price when the quote was requested. */
  catalog_price_cents: number;
}

/** A past version of a quote, as stored by the quote_snapshot SQL function. */
export interface QuoteSnapshot {
  items: {
    id: string;
    product_id: string;
    name: string;
    quantity: number;
    unit_price_cents: number;
  }[];
  subtotal_cents: number;
  discount_cents: number;
  discount_percent: number | null;
  delivery_fee_cents: number;
  total_cents: number;
  admin_note: string | null;
  /** When this version was sent (or last updated). */
  quoted_at: string | null;
}

export type DiscountInput =
  | { type: "amount"; cents: number }
  | { type: "percent"; value: number };

/** Body of an admin quote edit (mirrors admin-orders PATCH). */
export interface QuoteEditInput {
  items: { id: string; quantity: number; unit_price_cents: number }[];
  delivery_fee_cents: number;
  discount: DiscountInput;
  admin_note: string | null;
}

export type OrderWithItems = Order & {
  order_items: OrderItem[];
};

/** Product with the editor's email resolved — returned only by admin-products. */
export type AdminProduct = Product & { updated_by_email: string | null };

/** Category with the editor's email resolved — returned only by admin-categories. */
export type AdminCategory = Category & { updated_by_email: string | null };

/** A registered customer as returned by the admin-users lookup. */
export interface CustomerMatch {
  user_id: string;
  name: string;
  last_name: string;
  email: string;
  phone: string | null;
}

/** Body of admin-orders `create` (mirrors its zod schema). */
export interface AdminCreateQuoteInput {
  userId: string;
  items: { productId: string; quantity: number; unit_price_cents: number }[];
  delivery_fee_cents: number;
  discount: DiscountInput;
  admin_note: string | null;
}
