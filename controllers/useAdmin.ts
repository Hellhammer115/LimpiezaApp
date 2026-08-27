// CONTROLLER — admin: gates the admin section and exposes full-catalog
// CRUD to admin views. Disabled entirely outside a real session (and
// always false in demo mode, which has no backend).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import {
  checkIsAdmin,
  createProduct,
  deleteProduct,
  listAllProducts,
  updateProduct,
  uploadProductImage,
  type ProductInput,
} from "@/models/adminModel";
import { DEMO_MODE } from "@/models/demoData";

/** True when the signed-in user is an admin (always false in demo mode). */
export function useIsAdmin() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["is-admin", userId],
    enabled: !DEMO_MODE && !!userId,
    queryFn: () => checkIsAdmin(userId!),
  });
}

/** All products (active + inactive), for the admin list/search screen. */
export function useAdminProducts(search?: string) {
  return useQuery({
    queryKey: ["admin-products", search ?? ""],
    queryFn: () => listAllProducts(search),
  });
}

/** Shared invalidation: admin screens AND the shopper-facing catalog both refresh. */
function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };
}

export function useCreateProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: ProductInput) => createProduct(input),
    onSuccess: invalidate,
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ProductInput> }) =>
      updateProduct(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: invalidate,
  });
}

export function useUploadProductImage() {
  return useMutation({
    mutationFn: ({ uri, width, height }: { uri: string; width: number; height: number }) =>
      uploadProductImage(uri, width, height),
  });
}
