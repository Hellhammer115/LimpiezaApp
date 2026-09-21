import { Text, View } from "react-native";

import { formatMXN } from "@/utils/format";

interface Props {
  subtotal: number;
  discount: number;
  discountPercent?: number | null;
  deliveryFee: number;
  total: number;
}

/** VIEW — subtotal / descuento / envío / total block shared by every order screen. */
export function OrderTotals({ subtotal, discount, discountPercent, deliveryFee, total }: Props) {
  return (
    <View className="mt-2 border-t border-dark-100/5 pt-2">
      <Row label="Subtotal" value={formatMXN(subtotal)} />
      {discount > 0 ? (
        <Row
          label={discountPercent != null ? `Descuento (${discountPercent}%)` : "Descuento"}
          value={`−${formatMXN(discount)}`}
          accent
        />
      ) : null}
      <Row label="Envío" value={deliveryFee === 0 ? "Gratis" : formatMXN(deliveryFee)} />
      <View className="mt-1 flex-row justify-between">
        <Text className="font-quicksand-bold text-base text-dark-100">Total</Text>
        <Text className="font-quicksand-bold text-base text-dark-100">{formatMXN(total)}</Text>
      </View>
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View className="mt-1 flex-row justify-between">
      <Text className="font-quicksand-medium text-dark-100/60">{label}</Text>
      <Text className={`font-quicksand-semibold ${accent ? "text-primary" : "text-dark-100"}`}>
        {value}
      </Text>
    </View>
  );
}
