import { HOME_CATEGORIES, HOME_FILTERS, PROMO_SLIDES } from "@/constants";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useState } from "react";
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type IconName = ComponentProps<typeof Ionicons>["name"];

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PROMO_CARD_WIDTH = SCREEN_WIDTH - 40;
const PROMO_CARD_GAP = 12;

const FREE_DELIVERY_THRESHOLD = 350;
const CURRENT_SPEND = 120;
const PROGRESS = Math.min(CURRENT_SPEND / FREE_DELIVERY_THRESHOLD, 1);

const CART_COUNT = 3;

const ICON_MUTED = "rgba(16,36,31,0.35)";
const ICON_PRIMARY = "#3E8368";

const TABS = [
  { key: "inicio", label: "Inicio", icon: "home-outline" },
  { key: "buscar", label: "Buscar", icon: "search-outline" },
  { key: "pedidos", label: "Pedidos", icon: "receipt-outline" },
  { key: "cuenta", label: "Cuenta", icon: "person-outline" },
] as const;

export default function Home() {
  const [activeFilter, setActiveFilter] = useState(0);
  const [activePromo, setActivePromo] = useState(0);
  const [activeTab, setActiveTab] =
    useState<(typeof TABS)[number]["key"]>("inicio");

  const onPromoScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(
      e.nativeEvent.contentOffset.x / (PROMO_CARD_WIDTH + PROMO_CARD_GAP)
    );
    setActivePromo(index);
  };

  return (
    <SafeAreaView className="flex-1 bg-mist">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-6">
        {/* Header */}
        <View className="flex-row items-center gap-3 px-5 pt-4">
          <View className="searchbar flex-1 px-4 py-3">
            <Ionicons name="search" size={18} color={ICON_MUTED} />
            <TextInput
              placeholder="Buscar productos..."
              placeholderTextColor={ICON_MUTED}
              className="flex-1 font-quicksand-medium text-dark-100"
            />
          </View>
          <Pressable className="cart-btn">
            <Ionicons name="bag-outline" size={20} color="white" />
            <View className="cart-badge">
              <Text className="text-[10px] font-quicksand-bold text-white">
                {CART_COUNT}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-5"
          contentContainerClassName="px-5"
        >
          {HOME_FILTERS.map((filter, index) => {
            const active = index === activeFilter;
            return (
              <Pressable
                key={filter}
                onPress={() => setActiveFilter(index)}
                className={active ? "chip-active" : "chip"}
              >
                <Text
                  className={`font-quicksand-semibold text-sm ${
                    active ? "text-white" : "text-dark-100"
                  }`}
                >
                  {filter}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Promo carousel */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-5"
          contentContainerClassName="px-5"
          decelerationRate="fast"
          snapToInterval={PROMO_CARD_WIDTH + PROMO_CARD_GAP}
          snapToAlignment="start"
          onMomentumScrollEnd={onPromoScrollEnd}
        >
          {PROMO_SLIDES.map((slide, index) => (
            <View
              key={slide.id}
              style={{
                width: PROMO_CARD_WIDTH,
                marginRight: index === PROMO_SLIDES.length - 1 ? 0 : PROMO_CARD_GAP,
                backgroundColor: slide.color,
              }}
              className="overflow-hidden rounded-3xl p-6"
            >
              <View className="absolute -right-4 top-4 flex-row gap-2 opacity-20">
                <View className="size-16 rounded-full bg-white" />
                <View className="mt-6 size-10 rounded-full bg-white" />
              </View>

              <Text className="eyebrow text-white/80">{slide.eyebrow}</Text>
              <Text className="mt-2 w-3/4 font-quicksand-bold text-xl leading-6 text-white">
                {slide.title}
              </Text>
              <Text className="mt-4 font-quicksand-semibold text-white">
                {slide.cta} →
              </Text>
            </View>
          ))}
        </ScrollView>

        <View className="mt-3 flex-row justify-center gap-1.5">
          {PROMO_SLIDES.map((slide, index) => (
            <View
              key={slide.id}
              className={`h-1.5 rounded-full ${
                index === activePromo ? "w-5 bg-citrus" : "w-1.5 bg-dark-100/15"
              }`}
            />
          ))}
        </View>

        {/* Free delivery progress */}
        <View className="mx-5 mt-5 rounded-2xl bg-white p-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="font-quicksand-semibold text-xs text-dark-100/50">
              $0
            </Text>
            <Text className="font-quicksand-semibold text-xs text-dark-100/50">
              ${FREE_DELIVERY_THRESHOLD}
            </Text>
          </View>
          <View className="relative">
            <View className="h-2 overflow-hidden rounded-full bg-foam">
              <View
                className="h-full rounded-full bg-primary"
                style={{ width: `${PROGRESS * 100}%` }}
              />
            </View>
            <View
              className="absolute -top-1.5 size-5 items-center justify-center rounded-full bg-white shadow-sm shadow-black/20"
              style={{ left: `${PROGRESS * 100}%`, marginLeft: -10 }}
            >
              <Ionicons name="sparkles" size={11} color={ICON_PRIMARY} />
            </View>
          </View>
          <Text className="mt-4 font-quicksand-bold text-dark-100">
            ${(FREE_DELIVERY_THRESHOLD - CURRENT_SPEND).toFixed(2)} para envío gratis
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <Text className="font-quicksand-medium text-sm text-dark-100/60">
              Envío gratis desde ${FREE_DELIVERY_THRESHOLD} con LimpiezaApp+
            </Text>
            <Ionicons name="information-circle-outline" size={15} color={ICON_MUTED} />
          </View>
        </View>

        {/* Next delivery */}
        <Pressable className="info-row mx-5 mt-4">
          <View className="info-row__icon">
            <Ionicons name="time-outline" size={20} color={ICON_PRIMARY} />
          </View>
          <View className="flex-1">
            <Text className="font-quicksand-bold text-dark-100">
              Siguiente entrega disponible
            </Text>
            <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
              Hoy, 6pm – 8pm · Col. Centro
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={ICON_MUTED} />
        </Pressable>

        {/* Support */}
        <Pressable className="info-row mx-5 mt-3">
          <View className="info-row__icon">
            <Ionicons name="logo-whatsapp" size={20} color={ICON_PRIMARY} />
          </View>
          <View className="flex-1">
            <Text className="font-quicksand-bold text-dark-100">
              ¿Preguntas o comentarios?
            </Text>
            <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
              Te respondemos por WhatsApp en minutos
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={ICON_MUTED} />
        </Pressable>

        {/* Categories */}
        <Text className="mb-3 mt-7 px-5 font-quicksand-bold text-2xl text-dark-100">
          Categorías
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-5"
        >
          {HOME_CATEGORIES.map((category) => (
            <Pressable
              key={category.id}
              style={{ backgroundColor: category.color }}
              className="category-tile"
            >
              <Ionicons
                name={category.icon as IconName}
                size={22}
                color={category.textColor ?? "white"}
              />
              <Text
                style={{ color: category.textColor ?? "white" }}
                className="font-quicksand-semibold text-sm leading-4"
              >
                {category.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </ScrollView>

      {/* Tab bar */}
      <View className="tab-bar">
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          const iconName = (
            active ? tab.icon.replace("-outline", "") : tab.icon
          ) as IconName;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              className="items-center gap-1 py-1.5"
            >
              <Ionicons name={iconName} size={22} color={active ? ICON_PRIMARY : ICON_MUTED} />
              <Text
                className={`text-[11px] font-quicksand-semibold ${
                  active ? "text-primary" : "text-dark-100/40"
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
2