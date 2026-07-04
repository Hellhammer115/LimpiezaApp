import { useState } from "react";
import {
  Dimensions,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { PROMO_SLIDES } from "@/constants";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH - 40;
const CARD_GAP = 12;

/** VIEW — swipeable promo banner carousel with page dots (static content). */
export function PromoCarousel() {
  const [active, setActive] = useState(0);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(
      e.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP)
    );
    setActive(index);
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-5"
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
        onMomentumScrollEnd={onScrollEnd}
      >
        {PROMO_SLIDES.map((slide, index) => (
          <View
            key={slide.id}
            style={{
              width: CARD_WIDTH,
              marginRight: index === PROMO_SLIDES.length - 1 ? 0 : CARD_GAP,
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
              index === active ? "w-5 bg-citrus" : "w-1.5 bg-dark-100/15"
            }`}
          />
        ))}
      </View>
    </View>
  );
}
