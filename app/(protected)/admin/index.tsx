// VIEW — admin home: one selector switches between the four admin panels.
// Productos and Categorías get a "+" that opens their create screens;
// Cotizaciones and Pedidos list every customer's rows (the Pedidos tab only
// shows the signed-in user's own).
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminCategoryList } from "@/views/AdminCategoryList";
import { AdminOrderList } from "@/views/AdminOrderList";
import { AdminProductList } from "@/views/AdminProductList";

type Section = "products" | "categories" | "quotes" | "orders";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "products", label: "Productos" },
  { key: "categories", label: "Categorías" },
  { key: "quotes", label: "Cotizaciones" },
  { key: "orders", label: "Pedidos" },
];

/** Where the "+" button goes; absent means the section has no create action. */
const CREATE_ROUTE: Partial<Record<Section, "/admin/product/new" | "/admin/categories/category/new">> = {
  products: "/admin/product/new",
  categories: "/admin/categories/category/new",
};

export default function AdminHome() {
  const [section, setSection] = useState<Section>("products");
  const createRoute = CREATE_ROUTE[section];
  const title = SECTIONS.find((s) => s.key === section)!.label;

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <Text className="font-quicksand-bold text-2xl text-dark-100">{title}</Text>
        {createRoute ? (
          <Pressable
            onPress={() => router.push(createRoute)}
            className="size-10 items-center justify-center rounded-full bg-primary"
          >
            <Ionicons name="add" size={22} color="white" />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-5 pb-3"
      >
        {SECTIONS.map((s) => {
          const active = s.key === section;
          return (
            <Pressable
              key={s.key}
              onPress={() => setSection(s.key)}
              className={active ? "chip-active" : "chip"}
            >
              <Text
                className={`font-quicksand-semibold text-sm ${active ? "text-white" : "text-dark-100"}`}
              >
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {section === "products" ? <AdminProductList /> : null}
      {section === "categories" ? <AdminCategoryList /> : null}
      {section === "quotes" ? <AdminOrderList kind="quotes" /> : null}
      {section === "orders" ? <AdminOrderList kind="orders" /> : null}
    </SafeAreaView>
  );
}
