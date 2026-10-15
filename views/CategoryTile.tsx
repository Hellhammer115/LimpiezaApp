import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";

import type { Category } from "@/models/types";

type IconName = ComponentProps<typeof Ionicons>["name"];

// Bright palette rotated by sort order (the DB doesn't store colors).
const TILE_COLORS = [
  "#FFD43B", // amarillo
  "#12C99B", // verde menta
  "#B5E61D", // lima
  "#FF7A59", // coral
  "#2EC4D6", // turquesa
  "#1B87C9", // azul marca
  "#FFB84D", // naranja
  "#2F5BD3", // azul
  "#F2C66D", // trigo
  "#A65DD8", // morado
];
// Light backgrounds get a dark icon; the rest get white.
const LIGHT_TILES = new Set(["#FFD43B", "#B5E61D", "#FFB84D", "#F2C66D"]);

/**
 * VIEW — Calii-style category tile: a colored square with a big icon (or the
 * category's photo, when an admin uploaded one) and the name centered
 * underneath. The parent sets the width; the square follows it.
 */
export function CategoryTile({
  category,
  className = "",
}: {
  category: Category;
  className?: string;
}) {
  const index = Math.abs(category.sort_order) % TILE_COLORS.length;
  const color = TILE_COLORS[index];
  const iconColor = LIGHT_TILES.has(color) ? "#0F2A3D" : "white";

  return (
    <Pressable
      onPress={() => router.push(`/category/${category.id}`)}
      className={className}
    >
      <View style={{ backgroundColor: color }} className="category-tile overflow-hidden">
        {category.image_url ? (
          // Admin-uploaded photo fills the tile; the icon is only the fallback.
          <Image
            source={{ uri: category.image_url }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <>
            {/* Soft decorative circle so flat tiles don't feel empty */}
            <View
              className="absolute -right-6 -top-6 size-20 rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.18)" }}
            />
            <Ionicons
              name={(category.icon || "pricetag-outline") as IconName}
              size={44}
              color={iconColor}
            />
          </>
        )}
      </View>
      <Text
        numberOfLines={2}
        className="mt-2 text-center font-quicksand-semibold text-sm leading-5 text-dark-100"
      >
        {category.name}
      </Text>
    </Pressable>
  );
}
