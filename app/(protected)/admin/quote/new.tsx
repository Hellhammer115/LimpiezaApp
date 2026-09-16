// VIEW — admin: send a cotización to a registered customer. Recipient search
// (email/phone) + the shared QuoteEditor seeded from the cart. The admin's
// prices go to the server as-is; totals are recomputed there.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCreateQuoteForCustomer, useCustomerLookup } from "@/controllers/useAdminOrders";
import { useCart, useCartSubtotal } from "@/controllers/useCart";
import { deliveryFeeCents } from "@/models/delivery";
import type { CustomerMatch } from "@/models/types";
import { EmptyState } from "@/views/EmptyState";
import { PrimaryButton } from "@/views/PrimaryButton";
import { QuoteEditor, type QuoteDraft } from "@/views/QuoteEditor";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function AdminNewQuote() {
  const items = useCart((s) => s.items);
  const subtotal = useCartSubtotal();
  const create = useCreateQuoteForCustomer();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // Debounce the lookup 300ms behind the keystrokes (timer callback, not a
  // synchronous set-state in the effect).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const lookup = useCustomerLookup(debounced);

  const [customer, setCustomer] = useState<CustomerMatch | null>(null);

  // Draft seeded from the cart; the line id is the product id here.
  const [edits, setEdits] = useState<QuoteDraft | null>(null);
  const draft: QuoteDraft = edits ?? {
    items: items.map((i) => ({
      id: i.productId,
      name: i.name,
      catalog_price_cents: i.priceCents,
      quantity: i.quantity,
      unit_price_cents: i.priceCents,
    })),
    deliveryFeeCents: deliveryFeeCents(subtotal),
    discount: { type: "amount", cents: 0 },
    adminNote: "",
  };

  const send = () => {
    if (!customer) return;
    create.mutate({
      userId: customer.user_id,
      items: draft.items.map((i) => ({
        productId: i.id,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
      })),
      delivery_fee_cents: draft.deliveryFeeCents,
      discount: draft.discount,
      admin_note: draft.adminNote.trim() || null,
    });
  };

  if (items.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
        <ScreenHeader title="Cotizar a un cliente" />
        <EmptyState
          icon="bag-outline"
          title="El carrito está vacío"
          subtitle="Agrega productos al carrito primero"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <ScreenHeader title="Cotizar a un cliente" />
      <ScrollView contentContainerClassName="px-5 pb-6" keyboardShouldPersistTaps="handled">
        <Text className="mb-2 mt-2 font-quicksand-bold text-lg text-dark-100">Cliente</Text>
        {customer ? (
          <View className="flex-row items-center rounded-2xl bg-white p-4">
            <View className="flex-1">
              <Text className="font-quicksand-bold text-dark-100">
                {[customer.name, customer.last_name].filter(Boolean).join(" ") || customer.email}
              </Text>
              <Text className="font-quicksand-medium text-sm text-dark-100/60">{customer.email}</Text>
              {customer.phone ? (
                <Text className="font-quicksand-medium text-sm text-dark-100/60">{customer.phone}</Text>
              ) : null}
            </View>
            <Pressable onPress={() => setCustomer(null)} hitSlop={8}>
              <Text className="font-quicksand-bold text-sm text-primary">Cambiar</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Correo o teléfono del cliente"
              placeholderTextColor="rgba(16,36,31,0.35)"
              autoCapitalize="none"
              keyboardType="email-address"
              className="input mb-2"
            />
            {(lookup.data ?? []).map((c) => (
              <Pressable
                key={c.user_id}
                onPress={() => setCustomer(c)}
                className="mb-2 flex-row items-center rounded-2xl bg-white p-4"
              >
                <Ionicons name="person-circle-outline" size={28} color="#3E8368" />
                <View className="ml-3 flex-1">
                  <Text className="font-quicksand-bold text-dark-100">
                    {[c.name, c.last_name].filter(Boolean).join(" ") || c.email}
                  </Text>
                  <Text className="font-quicksand-medium text-sm text-dark-100/60">
                    {c.email}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </Text>
                </View>
              </Pressable>
            ))}
            {debounced.trim().length >= 3 && !lookup.isLoading && lookup.data?.length === 0 ? (
              <Text className="px-1 py-2 font-quicksand-medium text-sm text-dark-100/60">
                Sin resultados. Solo se puede cotizar a clientes registrados.
              </Text>
            ) : null}
          </>
        )}

        <View className="mt-6">
          <QuoteEditor draft={draft} onChange={setEdits} />
        </View>
      </ScrollView>

      <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
        <PrimaryButton
          title="Enviar cotización"
          onPress={send}
          loading={create.isPending}
          disabled={!customer || draft.items.length === 0}
        />
      </View>
    </SafeAreaView>
  );
}
