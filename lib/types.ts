export type OrderStatus =
  | "pending"
  | "paid"
  | "preparing"
  | "delivering"
  | "delivered"
  | "cancelled";

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
}

export interface Order {
  id: string;
  user_id: string;
  address_id: string;
  status: OrderStatus;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  delivery_slot: string;
  mp_preference_id: string | null;
  mp_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
}

export type OrderItemWithProduct = OrderItem & {
  products: Pick<Product, "name" | "unit" | "image_url"> | null;
};

export type OrderWithItems = Order & {
  order_items: OrderItemWithProduct[];
  addresses: Pick<Address, "label" | "street" | "colonia" | "city"> | null;
};
