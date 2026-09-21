// MODEL — addresses: full CRUD over the caller's own delivery addresses.
// RLS restricts every operation to rows where user_id = auth.uid().
import type { Address } from "@/models/types";
import { supabase } from "@/services/supabase";

/** Returns the caller's addresses, default first, then oldest first. */
export async function fetchAddresses(): Promise<Address[]> {
  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return data;
}

export type AddressInput = Partial<Address> & {
  street: string;
  city: string;
  label: string;
};

/**
 * Creates or updates an address. When `is_default` is set, every other
 * address of the user is unset first so exactly one default exists.
 */
export async function saveAddress(
  userId: string,
  address: AddressInput
): Promise<void> {
  const { id, ...fields } = address;
  if (fields.is_default) {
    const { error } = await supabase
      .from("addresses")
      .update({ is_default: false })
      .eq("user_id", userId);
    if (error) throw error;
  }
  if (id) {
    const { error } = await supabase.from("addresses").update(fields).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("addresses")
      .insert({ ...fields, user_id: userId });
    if (error) throw error;
  }
}

/** Deletes one address. Past orders keep their own address snapshot. */
export async function deleteAddress(id: string): Promise<void> {
  const { error } = await supabase.from("addresses").delete().eq("id", id);
  if (error) throw error;
}
