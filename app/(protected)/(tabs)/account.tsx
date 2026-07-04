import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useProfile } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useCart } from "@/store/cart";

type IconName = ComponentProps<typeof Ionicons>["name"];

function AccountRow({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable onPress={onPress} className="info-row mb-3">
      <View className="info-row__icon">
        <Ionicons name={icon} size={20} color={destructive ? "#FF6B4A" : "#3E8368"} />
      </View>
      <Text
        className={`flex-1 font-quicksand-bold ${
          destructive ? "text-coral" : "text-dark-100"
        }`}
      >
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color="rgba(16,36,31,0.35)" />
    </Pressable>
  );
}

export default function Account() {
  const { data: profile } = useProfile();
  const clearCart = useCart((s) => s.clear);

  const signOut = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir",
        style: "destructive",
        onPress: async () => {
          clearCart();
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pb-8">
        <Text className="pt-4 font-quicksand-bold text-2xl text-dark-100">
          Mi cuenta
        </Text>

        <View className="mt-4 items-center rounded-2xl bg-white p-6">
          <View className="size-20 items-center justify-center rounded-full bg-foam">
            <Ionicons name="person" size={36} color="#3E8368" />
          </View>
          <Text className="mt-3 font-quicksand-bold text-lg text-dark-100">
            {profile ? `${profile.name} ${profile.last_name}`.trim() : "…"}
          </Text>
          <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
            {profile?.email ?? ""}
          </Text>
          {profile?.phone ? (
            <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
              {profile.phone}
            </Text>
          ) : null}
        </View>

        <View className="mt-6">
          <AccountRow
            icon="pencil-outline"
            label="Editar perfil"
            onPress={() => router.push("/account/profile")}
          />
          <AccountRow
            icon="location-outline"
            label="Mis direcciones"
            onPress={() => router.push("/account/addresses")}
          />
          <AccountRow
            icon="receipt-outline"
            label="Mis pedidos"
            onPress={() => router.push("/orders")}
          />
          <AccountRow
            icon="log-out-outline"
            label="Cerrar sesión"
            onPress={signOut}
            destructive
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
