// CONTROLLER — addresses: list + save + delete for the caller's addresses,
// with cache invalidation so every screen sees changes immediately.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import {
  deleteAddress,
  fetchAddresses,
  saveAddress,
  type AddressInput,
} from "@/models/addressModel";

/** The caller's addresses, default first. */
export function useAddresses() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["addresses", session?.user.id],
    enabled: !!session,
    queryFn: fetchAddresses,
  });
}

/** Creates or updates an address (keeps a single default). */
export function useSaveAddress() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: (address: AddressInput) =>
      saveAddress(session!.user.id, address),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["addresses"] }),
  });
}

/** Deletes an address; past orders keep their own address snapshot. */
export function useDeleteAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAddress,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["addresses"] }),
  });
}
